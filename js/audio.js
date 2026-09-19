import { STORAGE_KEYS } from "./data.js?v=20260920-pages-debug-a1";

const SETTINGS_VERSION = 2;
const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  muted: false,
  volume: 0.7,
  bgmMuted: false,
  bgmVolume: 0.45,
});
const AUDIO_STORAGE_KEY = STORAGE_KEYS?.audioSettings ?? "boxing-game-audio-settings";
const HIT_COOLDOWN_MS = 60;

const SFX = {
  uiConfirm: { frequency: 660, duration: 0.055, type: "sine", gain: 0.09 },
  uiBack: { frequency: 390, duration: 0.06, type: "sine", gain: 0.07 },
  training: { frequency: 520, duration: 0.075, type: "triangle", gain: 0.08 },
  bell: {
    frequency: 1046.5, duration: 1.45, type: "sine", gain: 0.2,
    partials: [
      { ratio: 1.48, gain: 0.55, duration: 0.9 },
      { ratio: 2.03, gain: 0.3, duration: 0.55 },
      { ratio: 2.67, gain: 0.18, duration: 0.28 },
      { ratio: 0.51, gain: 0.2, duration: 1.15 },
      { ratio: 3.2, gain: 0.22, duration: 0.025, type: "triangle" },
    ],
  },
  hit: { frequency: 150, duration: 0.05, type: "square", gain: 0.1 },
  ko: { frequency: 90, duration: 0.28, type: "sawtooth", gain: 0.11 },
  result: {
    frequency: 1046.5, duration: 0.95, type: "sine", gain: 0.16,
    strikeOffsets: [0, 0.2, 0.4, 0.6],
    partials: [
      { ratio: 1.48, gain: 0.55, duration: 0.65 },
      { ratio: 2.03, gain: 0.3, duration: 0.4 },
      { ratio: 2.67, gain: 0.18, duration: 0.22 },
      { ratio: 0.51, gain: 0.2, duration: 0.85 },
      { ratio: 3.2, gain: 0.22, duration: 0.025, type: "triangle" },
    ],
  },
  unlock: { frequency: 990, duration: 0.14, type: "sine", gain: 0.08 },
};

const BGM_TRACKS = {
  title: { tempo: 0.2, notes: [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 783.99, 1046.5], type: "square" },
  training: { tempo: 0.18, notes: [329.63, 392, 493.88, 392, 349.23, 440, 523.25, 440], type: "triangle" },
  battle: { tempo: 0.14, notes: [220, 220, 329.63, 293.66, 220, 440, 392, 329.63], type: "sawtooth" },
};

let settings = null;
let audioContext = null;
let audioUnavailable = false;
let lastHitAt = Number.NEGATIVE_INFINITY;
let requestedBgmId = null;
let playingBgmId = null;
let bgmTimer = null;
let bgmNodes = [];
const sfxNodes = new Set();
let audioUnlocked = false;
let pageHidden = false;
let windowBlurred = false;

let audioSources = { bgm: {}, se: {} };
let fileBgm = null;
const fileSfx = new Set();

function isAudioPageActive() {
  return !pageHidden && !windowBlurred && (typeof document === "undefined"
    || (!document.hidden && document.hasFocus?.() !== false));
}

function suspendPageAudio() {
  // Cancel scheduled sounds too, so returning to the game cannot replay old hits.
  stopBgmNodes();
  stopSfx();
  try { audioContext?.suspend?.()?.catch?.(() => {}); } catch { /* audio unavailable */ }
}

function resumePageAudio() {
  // A preview loaded in the background must not start music without interaction.
  if (audioUnlocked && isAudioPageActive()) unlockAudio();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspendPageAudio();
    else resumePageAudio();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("blur", () => { windowBlurred = true; suspendPageAudio(); });
  window.addEventListener("focus", () => { windowBlurred = false; resumePageAudio(); });
  window.addEventListener("pagehide", () => { pageHidden = true; suspendPageAudio(); });
  window.addEventListener("pageshow", () => { pageHidden = false; resumePageAudio(); });
}

function trackSfxNode(node) {
  sfxNodes.add(node);
  node.onended = () => { sfxNodes.delete(node); node.disconnect?.(); };
}

function isAudioFile(value) {
  return typeof value === "string" && /^assets\/.+\.(?:mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(value)
    && !/[<>"'`\\?#:\u0000-\u001f]/.test(value)
    && !value.split("/").some((part) => part === ".." || part === "." || !part);
}

export function configureAudioSources(value = {}) {
  audioSources = { bgm: { ...(value?.bgm ?? {}) }, se: { ...(value?.se ?? {}) } };
}

function startFileBgm(trackId) {
  const current = ensureSettings();
  if (current.muted || current.bgmMuted || current.bgmVolume <= 0 || typeof Audio !== "function") return false;
  try {
    const player = new Audio(trackId);
    fileBgm = player;
    player.loop = true;
    player.volume = current.bgmVolume;
    playingBgmId = trackId;
    const failed = () => {
      if (fileBgm !== player) return;
      player.pause();
      fileBgm = null;
      playingBgmId = null;
    };
    player.addEventListener("error", failed, { once: true });
    player.play()?.catch(failed);
    return true;
  } catch { fileBgm = null; playingBgmId = null; return false; }
}

function playFileSfx(src, volume) {
  if (typeof Audio !== "function") return false;
  try {
    if (fileSfx.size >= 8) {
      const oldest = fileSfx.values().next().value;
      oldest.pause(); fileSfx.delete(oldest);
    }
    const player = new Audio(src);
    player.volume = volume;
    fileSfx.add(player);
    const cleanup = () => { player.pause(); fileSfx.delete(player); };
    player.addEventListener("ended", cleanup, { once: true });
    player.addEventListener("error", cleanup, { once: true });
    player.play()?.catch(cleanup);
    return true;
  } catch { return false; }
}


function clampVolume(value) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.volume;
  return Math.min(1, Math.max(0, value));
}

function getStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function normalizeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
  if (value.version !== 1 && value.version !== SETTINGS_VERSION) return { ...DEFAULT_SETTINGS };
  return {
    version: SETTINGS_VERSION,
    muted: typeof value.muted === "boolean" ? value.muted : DEFAULT_SETTINGS.muted,
    volume: clampVolume(value.volume),
    bgmMuted: typeof value.bgmMuted === "boolean" ? value.bgmMuted : DEFAULT_SETTINGS.bgmMuted,
    bgmVolume: clampVolume(value.bgmVolume ?? DEFAULT_SETTINGS.bgmVolume),
  };
}

function ensureSettings() {
  if (settings) return settings;
  const storage = getStorage();
  if (!storage) return (settings = { ...DEFAULT_SETTINGS });
  try {
    const raw = storage.getItem(AUDIO_STORAGE_KEY);
    settings = raw === null ? { ...DEFAULT_SETTINGS } : normalizeSettings(JSON.parse(raw));
  } catch { settings = { ...DEFAULT_SETTINGS }; }
  return settings;
}

function persistSettings() {
  const storage = getStorage();
  if (!storage) return false;
  try { storage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings)); return true; } catch { return false; }
}

function getAudioContext() {
  if (audioUnavailable) return null;
  if (audioContext) return audioContext;
  try {
    const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (typeof AudioContextCtor !== "function") { audioUnavailable = true; return null; }
    audioContext = new AudioContextCtor();
    return audioContext;
  } catch { audioUnavailable = true; return null; }
}

export function getAudioSettings() { return { ...ensureSettings() }; }

export function setAudioSettings(partial = {}) {
  const current = ensureSettings();
  settings = {
    version: SETTINGS_VERSION,
    muted: typeof partial?.muted === "boolean" ? partial.muted : current.muted,
    volume: Object.hasOwn(partial ?? {}, "volume") ? clampVolume(partial.volume) : current.volume,
    bgmMuted: typeof partial?.bgmMuted === "boolean" ? partial.bgmMuted : current.bgmMuted,
    bgmVolume: Object.hasOwn(partial ?? {}, "bgmVolume") ? clampVolume(partial.bgmVolume) : current.bgmVolume,
  };
  persistSettings();
  for (const player of fileSfx) {
    player.volume = settings.volume;
    if (settings.muted || settings.volume <= 0) { player.pause(); fileSfx.delete(player); }
  }
  if (fileBgm) fileBgm.volume = settings.bgmVolume;
  if (settings.muted || settings.bgmMuted || settings.bgmVolume <= 0) stopBgmNodes();
  else startRequestedBgm();
  return { ...settings };
}

export function unlockAudio() {
  if (!isAudioPageActive()) return false;
  if (!audioUnlocked && globalThis.navigator?.userActivation?.hasBeenActive === false) return false;
  audioUnlocked = true;
  const context = getAudioContext();
  if (!context || typeof context.resume !== "function") return startRequestedBgm();
  try {
    const resumed = context.resume();
    if (resumed && typeof resumed.then === "function") {
      resumed.then(() => startRequestedBgm()).catch(() => {});
    } else {
      startRequestedBgm();
    }
    return true;
  } catch { return false; }
}

function stopBgmNodes() {
  if (fileBgm) { fileBgm.pause(); fileBgm = null; }
  if (bgmTimer !== null) { clearTimeout(bgmTimer); bgmTimer = null; }
  for (const node of bgmNodes) {
    try { node.stop(); node.disconnect?.(); } catch { /* already stopped */ }
  }
  bgmNodes = [];
  playingBgmId = null;
}

function scheduleBgmLoop(trackId) {
  if (!audioUnlocked || !isAudioPageActive()) return false;
  const context = getAudioContext();
  const track = BGM_TRACKS[trackId];
  const current = ensureSettings();
  if (!context || context.state === "suspended" || !track || current.muted || current.bgmMuted || current.bgmVolume <= 0) return false;
  try {
    const now = Number.isFinite(context.currentTime) ? context.currentTime : 0;
    const loopDuration = track.notes.length * track.tempo;
    bgmNodes = track.notes.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * track.tempo;
      oscillator.type = track.type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.035 * current.bgmVolume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + track.tempo * 0.9);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + track.tempo);
      return oscillator;
    });
    playingBgmId = trackId;
    bgmTimer = setTimeout(() => {
      bgmTimer = null; bgmNodes = [];
      if (requestedBgmId === trackId) scheduleBgmLoop(trackId);
    }, Math.max(1, Math.round(loopDuration * 1000)));
    return true;
  } catch { stopBgmNodes(); return false; }
}

function startRequestedBgm() {
  if (!audioUnlocked || !isAudioPageActive()) return false;
  if (!requestedBgmId || playingBgmId === requestedBgmId) return false;
  stopBgmNodes();
  return isAudioFile(requestedBgmId) ? startFileBgm(requestedBgmId) : scheduleBgmLoop(requestedBgmId);
}

export function playBgm(trackId, { builtin = false } = {}) {
  trackId = builtin ? trackId : audioSources.bgm[trackId] ?? trackId;
  if (trackId === "none") return stopBgm();
  if (!Object.hasOwn(BGM_TRACKS, trackId) && !isAudioFile(trackId)) return false;
  if (requestedBgmId === trackId && playingBgmId === trackId) return true;
  requestedBgmId = trackId;
  stopBgmNodes();
  startRequestedBgm();
  return true;
}

export function stopBgm() {
  requestedBgmId = null;
  stopBgmNodes();
  return true;
}

export function playSfx(id, { builtin = false } = {}) {
  if (!isAudioPageActive()) return false;
  const source = builtin ? id : audioSources.se[id] ?? id;
  const current = ensureSettings();
  if (source === "none" || current.muted || current.volume <= 0) return false;
  const nowMs = Date.now();
  if (id === "hit" && nowMs - lastHitAt < HIT_COOLDOWN_MS) return false;
  if (isAudioFile(source)) {
    const played = playFileSfx(source, current.volume);
    if (played && id === "hit") lastHitAt = nowMs;
    return played;
  }
  const sound = SFX[source];
  if (!sound) return false;
  const context = getAudioContext();
  if (!context || context.state === "suspended") return false;
  try {
    const start = Number.isFinite(context.currentTime) ? context.currentTime : 0;
    // Web Audioの時刻で打音を予約する。演出スキップや早送りでも打音の間隔を維持。
    for (const offset of sound.strikeOffsets ?? [0]) {
      const now = start + offset;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = sound.type;
      oscillator.frequency.setValueAtTime(sound.frequency, now);
      gain.gain.setValueAtTime(sound.gain * current.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.duration);
      oscillator.connect(gain); gain.connect(context.destination);
      trackSfxNode(oscillator);
      oscillator.start(now); oscillator.stop(now + sound.duration);
      // 倍音（partials）があれば同時に鳴らし、金属的な余韻を作る。ratioは基音に対する周波数比。
      for (const partial of sound.partials ?? []) {
        const partialOscillator = context.createOscillator();
        const partialGain = context.createGain();
        const partialDuration = partial.duration ?? sound.duration;
        partialOscillator.type = partial.type ?? sound.type;
        partialOscillator.frequency.setValueAtTime(sound.frequency * (partial.ratio ?? 1), now);
        partialGain.gain.setValueAtTime(sound.gain * (partial.gain ?? 1) * current.volume, now);
        partialGain.gain.exponentialRampToValueAtTime(0.0001, now + partialDuration);
        partialOscillator.connect(partialGain); partialGain.connect(context.destination);
        trackSfxNode(partialOscillator);
        partialOscillator.start(now); partialOscillator.stop(now + partialDuration);
      }
    }
    if (id === "hit") lastHitAt = nowMs;
    return true;
  } catch { return false; }
}

export function stopSfx() {
  for (const player of fileSfx) player.pause();
  fileSfx.clear();
  for (const node of sfxNodes) {
    try { node.stop(); node.disconnect?.(); } catch { /* already stopped */ }
  }
  sfxNodes.clear();
}
