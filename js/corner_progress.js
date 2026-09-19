export const CORNER_PROGRESS_STORAGE_KEY = "boxing-game-corner-progress";
export const CORNER_PROGRESS_VERSION = 2;
export const CORNER_PROGRESS_MAX_MARKS = 4;
export const CORNER_PROGRESS_THRESHOLD_STEP = 2;

const CORNER_STAT_IDS = Object.freeze(["pow", "spd", "sta", "tec"]);
const LEGACY_STAT_ORDER = Object.freeze(["pow", "spd", "sta", "tec"]);
const EMPTY_PROGRESS = Object.freeze({ winMarks: 0, koMarks: 0, winMarkers: [], koMarkers: [], winStats: [], koStats: [] });

function clampMark(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(CORNER_PROGRESS_MAX_MARKS, Math.max(0, Math.floor(numeric)));
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampStat(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.min(100, Math.max(0, numeric));
}

function normalizeMarkers(value, count) {
  if (!Array.isArray(value)) return [];
  const unique = [];
  for (const marker of value) {
    const stat = typeof marker === "string" ? marker : marker?.stat;
    if (CORNER_STAT_IDS.includes(stat) && !unique.some((entry) => entry.stat === stat)) {
      unique.push({ stat, value: clampStat(marker?.value) });
    }
    if (unique.length >= count) break;
  }
  return unique;
}

function legacyMarkers(stats, count) {
  return LEGACY_STAT_ORDER.slice(0, count).map((stat) => ({ stat, value: 50 }));
}

function normalizeEntry(value) {
  const winMarks = clampMark(value?.winMarks);
  const koMarks = clampMark(value?.koMarks);
  const winMarkers = normalizeMarkers(value?.winMarkers ?? value?.winStats, winMarks);
  const koMarkers = normalizeMarkers(value?.koMarkers ?? value?.koStats, koMarks);
  return {
    winMarks,
    koMarks,
    winMarkers,
    koMarkers,
    winStats: winMarkers.map((marker) => marker.stat),
    koStats: koMarkers.map((marker) => marker.stat),
  };
}

function createEmptyStore() {
  return { version: CORNER_PROGRESS_VERSION, progress: {} };
}

function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeProgress(value, { legacy = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const progress = {};
  for (const [heroineId, opponents] of Object.entries(value)) {
    const validHeroineId = normalizeId(heroineId);
    if (!validHeroineId || !opponents || typeof opponents !== "object" || Array.isArray(opponents)) continue;
    const normalizedOpponents = {};
    for (const [opponentId, entry] of Object.entries(opponents)) {
      const validOpponentId = normalizeId(opponentId);
      if (!validOpponentId) continue;
      const normalized = normalizeEntry(entry);
      if (legacy) {
        normalized.winMarkers = legacyMarkers(null, normalized.winMarks);
        normalized.koMarkers = legacyMarkers(null, normalized.koMarks);
        normalized.winStats = normalized.winMarkers.map((marker) => marker.stat);
        normalized.koStats = normalized.koMarkers.map((marker) => marker.stat);
      }
      normalizedOpponents[validOpponentId] = normalized;
    }
    if (Object.keys(normalizedOpponents).length) progress[validHeroineId] = normalizedOpponents;
  }
  return progress;
}

function normalizeStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !value.progress || typeof value.progress !== "object" || Array.isArray(value.progress)) {
    return createEmptyStore();
  }
  if (value.version === CORNER_PROGRESS_VERSION) {
    return { version: CORNER_PROGRESS_VERSION, progress: normalizeProgress(value.progress) };
  }
  if (value.version === 1) {
    return { version: CORNER_PROGRESS_VERSION, progress: normalizeProgress(value.progress, { legacy: true }) };
  }
  return createEmptyStore();
}

function persist(store) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(CORNER_PROGRESS_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function loadCornerProgress() {
  const storage = getStorage();
  if (!storage) return createEmptyStore();
  try {
    const raw = storage.getItem(CORNER_PROGRESS_STORAGE_KEY);
    if (raw === null) return createEmptyStore();
    const parsed = JSON.parse(raw);
    const store = normalizeStore(parsed);
    if (parsed?.version === 1) persist(store);
    return store;
  } catch {
    return createEmptyStore();
  }
}

export function getCornerProgress(heroineId, opponentId, store = loadCornerProgress()) {
  const validHeroineId = normalizeId(heroineId);
  const validOpponentId = normalizeId(opponentId);
  if (!validHeroineId || !validOpponentId) return { ...EMPTY_PROGRESS };
  return normalizeEntry(store?.progress?.[validHeroineId]?.[validOpponentId]);
}

function getWeakestUnmarkedStat(stats = {}, opponent = {}, markedStats = []) {
  const available = CORNER_STAT_IDS.filter((stat) => !markedStats.includes(stat));
  if (!available.length) return null;
  if (available.includes("sta") && (stats.sta ?? 0) < 40) return "sta";
  const weights = { pow: 0.3, tec: 0.3, spd: 0.25, sta: 0.15, ...(opponent.weights ?? {}) };
  return available.reduce((weakest, stat) => {
    const value = Math.max(0, 100 - (stats[stat] ?? 0)) * (weights[stat] ?? 0);
    return !weakest || value > weakest.value ? { stat, value } : weakest;
  }, null)?.stat ?? available[0];
}

export function recordCornerProgress(heroineId, opponentId, result, { stats, opponent } = {}) {
  const validHeroineId = normalizeId(heroineId);
  const validOpponentId = normalizeId(opponentId);
  const current = getCornerProgress(validHeroineId, validOpponentId);
  if (!validHeroineId || !validOpponentId || result === "ko") return current;

  const next = { ...current };
  // 引分・敗北は赤4本まで赤を増やし、以降は青を増やす。判定勝ちは赤の本数に関係なく青を増やす（2026-09-11 A案、DEC-055）。
  const isNonWin = result === "draw" || result === "lose";
  if (isNonWin && current.winMarks < CORNER_PROGRESS_MAX_MARKS) {
    next.winMarks += 1;
    const stat = getWeakestUnmarkedStat(stats, opponent, next.winStats);
    if (stat) {
      next.winMarkers = [...next.winMarkers, { stat, value: clampStat(stats?.[stat]) }];
      next.winStats = next.winMarkers.map((marker) => marker.stat);
    }
  } else if (result === "win" || isNonWin) {
    next.koMarks = clampMark(current.koMarks + 1);
    const stat = getWeakestUnmarkedStat(stats, opponent, next.koStats);
    if (stat) {
      next.koMarkers = [...next.koMarkers, { stat, value: clampStat(stats?.[stat]) }];
      next.koStats = next.koMarkers.map((marker) => marker.stat);
    }
  }

  if (next.winMarks === current.winMarks && next.koMarks === current.koMarks) return next;
  const store = loadCornerProgress();
  if (!store.progress[validHeroineId]) store.progress[validHeroineId] = {};
  store.progress[validHeroineId][validOpponentId] = next;
  persist(store);
  return next;
}

export function resetCornerProgress() {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(CORNER_PROGRESS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function getEffectiveCornerThresholds(baseThresholds = {}, progress = EMPTY_PROGRESS) {
  const draw = Number(baseThresholds.draw);
  const win = Number(baseThresholds.win);
  const ko = Number(baseThresholds.ko);
  const normalized = normalizeEntry(progress);
  const effectiveWin = Math.max(draw, win - normalized.winMarks * CORNER_PROGRESS_THRESHOLD_STEP);
  return {
    draw,
    win: effectiveWin,
    ko: Math.max(effectiveWin, ko - normalized.koMarks * CORNER_PROGRESS_THRESHOLD_STEP),
    ...(Number.isFinite(baseThresholds.koLoss) ? { koLoss: baseThresholds.koLoss } : {}),
  };
}
