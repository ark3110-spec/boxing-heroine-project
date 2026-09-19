import { STAGE_TEXTS } from "./texts.js?v=20260920-pages-debug-a1";
import { CONTENT } from "./content.js?v=20260920-pages-debug-a1";

const stage1Text = STAGE_TEXTS.stage1;

export function applyHeroineName(value, heroine) {
  if (typeof value !== "string") return value;
  const heroineFullName = heroine?.name ?? "";
  const heroineName = heroineFullName.trim().split(/\s+/).at(-1) ?? heroineFullName;
  return value
    .replaceAll("{heroineFullName}", heroineFullName)
    .replaceAll("{heroineName}", heroineName);
}

// ---- 育成モード共通：試合判定式 -------------------------------------------
// 育成値（pow/spd/tec/sta）から試合スコアを算出し、相手のしきい値と比較する。
// しきい値は各育成ステージの opponent に持たせる。
export function trainingMatchBaseScore(stats, weights = {}) {
  const scoreWeights = { pow: 0.3, tec: 0.3, spd: 0.25, sta: 0.15, ...weights };
  const base =
    stats.pow * scoreWeights.pow + stats.tec * scoreWeights.tec
    + stats.spd * scoreWeights.spd + stats.sta * scoreWeights.sta;
  const fade = stats.sta < 40 ? (40 - stats.sta) * 0.5 : 0;
  return base - fade;
}

export function trainingMatchScore(stats, weights = {}) {
  return trainingMatchBaseScore(stats, weights);
}

// キャンペーンの戦績とcontentの条件だけで隠し戦への挑戦資格を判定する。
export function canChallengeHiddenRound(campaign, config = CONTENT.campaign) {
  const unlock = config?.hiddenRound?.unlock;
  const results = campaign?.results ?? [];
  const latest = results.at(-1);
  if (!unlock || !(campaign?.fightCount < (config.schedule?.maxFights ?? 4))
    || latest?.roundId !== unlock.afterRound || latest?.result !== unlock.requireResult) return false;
  if (!unlock.requireAllRegularResults) return true;
  const rounds = config.rounds ?? [];
  return rounds.length > 0 && rounds.every((round) => results.some((entry) =>
    entry.roundId === round.id && entry.result === unlock.requireAllRegularResults));
}

export function getAcquiredMoves(heroine, stats, progress = {}) {
  const eventIds = (typeof progress === "function" ? progress() : progress)?.firedEventIds ?? [];
  const moves = Array.isArray(heroine?.moves) ? heroine.moves : [];
  return moves.filter((move) => (!move.acquiredAfterEvent || eventIds.includes(move.acquiredAfterEvent)) && Object.entries(move.acquiredWhen ?? {})
    .every(([stat, threshold]) => stats?.[stat] >= threshold));
}

function getScoreBonuses(heroine, stats, progress) {
  return getAcquiredMoves(heroine, stats, progress).reduce(
    (total, move) => ({
      scoreBonus: total.scoreBonus + (move.scoreBonus ?? 0),
      koBonus: total.koBonus + (move.koBonus ?? 0),
    }),
    { scoreBonus: 0, koBonus: 0 },
  );
}

export function getTrainingMatchForecast(stats, opponent = {}, heroine = {}, progress = {}) {
  const thresholds = opponent.thresholds ?? opponent;
  const { scoreBonus, koBonus } = getScoreBonuses(heroine, stats, progress);
  const baseScore = trainingMatchBaseScore(stats, opponent.weights) + scoreBonus;
  // Keep the forecast shape compatible with saved/UI consumers; both bounds are exact.
  const scoreMin = baseScore;
  const scoreMax = baseScore;
  const koScoreMin = scoreMin + koBonus;
  const koScoreMax = scoreMax + koBonus;
  let prediction = "loss-likely";
  if (opponent.alwaysKnockout) {
    prediction = baseScore >= thresholds.win ? "ko-likely" : "ko-loss";
  } else {
    if (koScoreMin >= thresholds.ko) prediction = "ko-likely";
    else if (scoreMin >= thresholds.win) prediction = "win-likely";
    else if (scoreMax >= thresholds.draw) prediction = "draw-possible";
    else if (Number.isFinite(thresholds.koLoss) && baseScore < thresholds.koLoss) prediction = "ko-loss";
  }
  return {
    baseScore,
    scoreMin,
    scoreMax,
    koScoreMin,
    koScoreMax,
    scoreBonus,
    koBonus,
    thresholds,
    prediction,
  };
}

// A stat-bar target answers: holding the other stats and event history fixed,
// what is the lowest whole-number value that actually yields this result?
// Use the same forecast as the result screen, including move gates, stamina
// fade, KO bonuses and KO-only opponents. Never change the opponent or save.
export function getTrainingStatTargets(stats, stat, opponent, heroine, progress = {}, max = 100) {
  if (!["pow", "spd", "sta", "tec"].includes(stat)) return null;
  const current = getTrainingMatchForecast(stats, opponent, heroine, progress).prediction;
  const wins = prediction => ["win-likely", "ko-likely"].includes(prediction);
  const targets = {
    win: { value: null, achieved: wins(current) },
    ko: { value: null, achieved: current === "ko-likely" },
  };
  for (let value = 0; value <= max; value++) {
    const prediction = getTrainingMatchForecast({ ...stats, [stat]: value }, opponent, heroine, progress).prediction;
    if (targets.win.value === null && wins(prediction)) targets.win.value = value;
    if (targets.ko.value === null && prediction === "ko-likely") targets.ko.value = value;
    if (targets.win.value !== null && targets.ko.value !== null) break;
  }
  return targets;
}

export function getTrainingMatchWeakness(stats, opponent = {}) {
  if ((stats.sta ?? 0) < 40) {
    return {
      stat: "sta",
      value: (40 - (stats.sta ?? 0)) * 0.5,
      reason: "stamina-fade",
    };
  }
  const weights = { pow: 0.3, tec: 0.3, spd: 0.25, sta: 0.15, ...(opponent.weights ?? {}) };
  return Object.keys(weights).reduce((weakest, stat) => {
    const value = Math.max(0, 100 - (stats[stat] ?? 0)) * weights[stat];
    return !weakest || value > weakest.value ? { stat, value, reason: "weighted-gap" } : weakest;
  }, null);
}

function resolveTrainingFinal(stats, endings, opponent, heroine, progress) {
  const { scoreBonus, koBonus } = getScoreBonuses(heroine, stats, progress);
  const score = trainingMatchScore(stats, opponent.weights) + scoreBonus;
  const thresholds = opponent.thresholds ?? opponent;
  if (opponent.alwaysKnockout) return score >= thresholds.win ? endings.ko : endings.knockoutLoss;
  if (score + koBonus >= thresholds.ko) return endings.ko;
  if (score >= thresholds.win) return endings.win;
  if (score >= thresholds.draw) return endings.draw;
  if (Number.isFinite(thresholds.koLoss) && score < thresholds.koLoss) return endings.knockoutLoss;
  return endings.lose;
}

// 試合結果画像は heroine 別データを正とし、未設定時だけ汎用画像へフォールバックする。
const TRAINING_ENDING_IMAGES = {
  ko: "assets/gallery/trueend.png",
  win: "assets/gallery/trueend.png",
  draw: "assets/gallery/sekihai.png",
  lose: "assets/gallery/sekihai.png",
  ...(CONTENT.campaign?.endingImages ?? {}),
};

// 育成ステージのテンプレート。数値（初期値・得意・相手）だけ受け取り、
// 名前やエンド文は content/heroines.json を正本とする。
function createTrainingStage({
  id,
  heroineId = id,
  specialtyCommandId,
  initialStats,
  opponent,
  turnLimit = 8,
  heroine,
  progress = {},
}) {
  const text = heroine ?? CONTENT.heroines[id];
  const endings = {};
  for (const key of ["ko", "win", "draw", "lose"]) {
    endings[key] = {
      id: key,
      title: text.endings[key].title,
      galleryId: `${id}-${key}`,
      image: CONTENT.campaign?.endingImagesByHeroine?.[heroineId]?.[key] ?? text.trainingImage ?? text.portrait ?? TRAINING_ENDING_IMAGES[key],
      description: applyHeroineName(
        opponent.resultTexts?.[key] ?? text.endings[key].description,
        text,
      ),
    };
  }

  endings.knockoutLoss = {
    ...endings.lose,
    title: CONTENT.campaign?.knockoutLossTitle ?? "KO負け",
    knockout: true,
  };

  return {
    id,
    mode: "training",
    name: `育成: ${text.name}`,
    characterName: text.name,
    turnLimit,
    commandIds: ["sandbag", "roadwork", "sparring", "recover"],
    restCommandId: "recover",
    exhaustionKey: "cond",
    uiText: CONTENT.campaign?.trainingUiText,
    training: {
      specialtyCommandId,
      specialtyMultiplier: 1.5,
      condKey: "cond",
      condPenaltyThreshold: 20,
      condPenaltyMultiplier: 0.5,
    },
    initialStats,
    statLimits: {
      pow: { min: 0, max: 100 },
      spd: { min: 0, max: 100 },
      sta: { min: 0, max: 100 },
      tec: { min: 0, max: 100 },
      cond: { min: 0, max: 100 },
    },
    opponent,
    endings,
    endingRules: {
      immediate: () => null,
      final: (stats, e) => resolveTrainingFinal(stats, e, opponent, text, progress),
    },
  };
}

const TRAINING_STAGES = [
  ...Object.entries(CONTENT.heroines ?? {}).map(([id, heroine]) => createTrainingStage({
    id,
    specialtyCommandId: heroine.specialtyCommandId,
    initialStats: heroine.initialStats,
    opponent: { name: "練習試合の相手", thresholds: { draw: 45, win: 58, ko: 72 } },
    heroine,
  })),
];

export function resolveCampaignOpponent(heroineId, round) {
  const base = CONTENT.opponents[round.opponentId] ?? {
    name: round.opponentId,
    portrait: "",
    thresholds: { draw: 45, win: 58, ko: 72 },
    preFight: [],
  };
  if (round.opponentId !== "rival") return { id: round.opponentId, ...base };
  const rivalId = CONTENT.campaign.rivalAssignments?.[heroineId]
    ?? Object.keys(CONTENT.heroines).find((id) => id !== heroineId);
  const rival = CONTENT.heroines[rivalId];
  return {
    id: rivalId ?? "rival",
    ...base,
    name: rival?.name ?? base.name,
    portrait: rival?.portrait ?? base.portrait,
  };
}

export function createCampaignStage(heroineId, round, carriedStats, progress = {}) {
  const heroine = CONTENT.heroines[heroineId];
  const opponent = resolveCampaignOpponent(heroineId, round);
  const stage = createTrainingStage({
    id: `campaign-${heroineId}-${round.id}`,
    heroineId,
    specialtyCommandId: heroine.specialtyCommandId,
    initialStats: carriedStats,
    opponent,
    turnLimit: round.trainingTurns,
    heroine,
    progress,
  });
  return {
    ...stage,
    campaignRound: round,
    opponent,
    name: `${round.label} vs ${opponent.name}`,
  };
}

export const STAGES = [
  {
    id: "stage1",
    // 元のエイプリルフール版。現在は隠しモード用ステージとして温存する。
    mode: "hidden",
    name: stage1Text.name,
    turnLimit: 5,
    commandIds: ["cheer", "love", "rest", "gift"],
    restCommandId: "rest",
    exhaustionKey: "playerSpirit",
    assets: {
      intro: "assets/backgrounds/OP/oheya.png",
      background: "assets/backgrounds/stage1/right.png",
      leftBackground: "assets/backgrounds/stage1/left.png",
      rightBackground: "assets/backgrounds/stage1/right.png",
      player: "assets/characters/yuu-default.png",
      rival: "assets/characters/mizuka-default.png",
      playerPops: {
        idle: "assets/characters/yuu/yuu_idle.png",
        cheer: "assets/characters/yuu/yuu_cheer.png",
        love: "assets/characters/yuu/yuu_hug.png",
        rest: "assets/characters/yuu/yuu_rest.png",
        gift: "assets/characters/yuu/yuu_present.png",
      },
      rivalPops: {
        idle: "assets/characters/zuika/zuika_idle.png",
        cheer: "assets/characters/zuika/zuika_cheer.png",
        love: "assets/characters/zuika/zuika_hug.png",
        rest: "assets/characters/zuika/zuika_rest.png",
        gift: "assets/characters/zuika/zuika_present.png",
      },
      fightSprites: {
        stance: "assets/characters/zuika/fight/stance.png",
        jab: "assets/characters/zuika/fight/jab.png",
        straight: "assets/characters/zuika/fight/straight.png",
        uppercut1: "assets/characters/zuika/fight/uppercut_1.png",
        uppercut2: "assets/characters/zuika/fight/uppercut_2.png",
      },
      fightSequence: [
        { key: "stance", duration: 520 },
        { key: "jab", duration: 220 },
        { key: "stance", duration: 420 },
        { key: "uppercut1", duration: 190 },
        { key: "uppercut2", duration: 260 },
        { key: "stance", duration: 880 },
      ],
    },
    opening: {
      setup: {
        background: "assets/backgrounds/OP/arena.png",
        leftName: "Zuika",
        rightName: "Champion",
        leftSprite: "assets/characters/zuika/fight/stance.png",
        rightSprite: "assets/characters/champion/fight/stance_fatigue.png",
        leftHpMax: 100,
        rightHpMax: 100,
        leftHpInitial: 100,
        rightHpInitial: 54,
      },
      openingText: stage1Text.opening,
      steps: [
        { type: "showMatchTitle", duration: 2100 },
        { type: "wait", duration: 700 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/jab.png" },
        { type: "wait", duration: 120 },
        { type: "damage", target: "right", amount: 8, x: "72%", y: "38%" },
        { type: "wait", duration: 220 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "wait", duration: 360 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/straight.png" },
        { type: "wait", duration: 110 },
        { type: "updateSprite", target: "right", src: "assets/characters/champion/fight/straight_damage.png" },
        { type: "damage", target: "right", amount: 12, x: "76%", y: "35%" },
        { type: "wait", duration: 260 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/champion/fight/stance_fatigue.png" },
        { type: "wait", duration: 380 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/body.png" },
        { type: "wait", duration: 120 },
        { type: "updateSprite", target: "right", src: "assets/characters/champion/fight/body_damage.png" },
        { type: "damage", target: "right", amount: 14, x: "74%", y: "49%" },
        { type: "wait", duration: 260 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/champion/fight/stance_fatigue.png" },
        { type: "wait", duration: 420 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/uppercut_1.png" },
        { type: "wait", duration: 240 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/uppercut_2.png" },
        { type: "wait", duration: 70 },
        { type: "updateSprite", target: "right", src: "assets/characters/champion/fight/uppercut_damage1.png" },
        { type: "damage", target: "right", amount: 20, x: "78%", y: "27%" },
        { type: "mouthpiece", x: "74%", y: "34%" },
        { type: "wait", duration: 130 },
        { type: "updateSprite", target: "right", src: "assets/characters/champion/fight/uppercut_damage2.png" },
        { type: "wait", duration: 150 },
        { type: "updateSprite", target: "right", src: "assets/characters/champion/fight/uppercut_damage3.png" },
        { type: "wait", duration: 500 },
        { type: "showKO" },
        { type: "wait", duration: 1700 },
        { type: "showChampionScene", duration: 2800 },
        { type: "showNarration", duration: 3200 },
        { type: "showIntroScene" },
      ],
    },
    victorySequence: {
      setup: {
        background: "assets/backgrounds/OP/arena.png",
        leftName: "Zuika",
        rightName: "Gyaru",
        leftSprite: "assets/characters/zuika/fight/stance.png",
        rightSprite: "assets/characters/gyaru/stance_fatigue.png",
        leftHpMax: 100,
        rightHpMax: 100,
        leftHpInitial: 100,
        rightHpInitial: 100,
      },
      steps: [
        { type: "wait", duration: 700 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/jab.png" },
        { type: "wait", duration: 120 },
        { type: "damage", target: "right", amount: 12, x: "76%", y: "36%" },
        { type: "wait", duration: 240 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/jab.png" },
        { type: "wait", duration: 260 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_fatigue.png" },
        { type: "wait", duration: 300 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/jab.png" },
        { type: "wait", duration: 100 },
        { type: "damage", target: "right", amount: 18, x: "77%", y: "35%" },
        { type: "wait", duration: 140 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/straight.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/straight_damage.png" },
        { type: "wait", duration: 120 },
        { type: "damage", target: "right", amount: 20, x: "79%", y: "34%" },
        { type: "wait", duration: 220 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_fatigue.png" },
        { type: "wait", duration: 320 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/body.png" },
        { type: "wait", duration: 120 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/body_damage.png" },
        { type: "damage", target: "right", amount: 20, x: "76%", y: "50%" },
        { type: "wait", duration: 260 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/uppercut_1.png" },
        { type: "wait", duration: 220 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/uppercut_2.png" },
        { type: "wait", duration: 80 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/uppercut_damage1.png" },
        { type: "damage", target: "right", amount: 30, x: "79%", y: "27%" },
        { type: "mouthpiece", x: "75%", y: "34%", color: "white" },
        { type: "wait", duration: 120 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/uppercut_damage2.png" },
        { type: "wait", duration: 120 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/uppercut_damage3.png" },
        { type: "wait", duration: 500 },
        { type: "showKO" },
      ],
    },
    yarisugiSequence: {
      setup: {
        background: "assets/backgrounds/OP/arena.png",
        leftName: "Zuika",
        rightName: "Gyaru",
        leftSprite: "assets/characters/zuika/fight/stance.png",
        rightSprite: "assets/characters/gyaru/stance_fatigue.png",
        leftHpMax: 100,
        rightHpMax: 100,
        leftHpInitial: 100,
        rightHpInitial: 100,
      },
      steps: [
        { type: "wait", duration: 700 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/jab.png" },
        { type: "wait", duration: 120 },
        { type: "damage", target: "right", amount: 20, x: "76%", y: "36%" },
        { type: "wait", duration: 240 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/jab.png" },
        { type: "wait", duration: 260 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_fatigue.png" },
        { type: "wait", duration: 300 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/straight.png" },
        { type: "wait", duration: 120 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/straight_damage.png" },
        { type: "damage", target: "right", amount: 30, x: "79%", y: "34%" },
        { type: "wait", duration: 240 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_fatigue.png" },
        { type: "wait", duration: 320 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/uppercut_1.png" },
        { type: "wait", duration: 220 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/uppercut_2.png" },
        { type: "wait", duration: 80 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/uppercut_damage1.png" },
        { type: "damage", target: "right", amount: 50, x: "77%", y: "31%" },
        { type: "wait", duration: 800 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_bodydamage.png" },
        { type: "wait", duration: 300 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/body.png" },
        { type: "wait", duration: 100 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/body_damage.png" },
        { type: "shakeScreen", duration: 400 },
        { type: "damage", target: "right", amount: 15, x: "76%", y: "50%", noHpLoss: true },
        { type: "wait", duration: 180 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_bodydamage.png" },
        { type: "wait", duration: 200 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/body.png" },
        { type: "wait", duration: 100 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/body_damage.png" },
        { type: "shakeScreen", duration: 400 },
        { type: "damage", target: "right", amount: 18, x: "78%", y: "48%", noHpLoss: true },
        { type: "wait", duration: 180 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_bodydamage.png" },
        { type: "wait", duration: 200 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/body.png" },
        { type: "wait", duration: 100 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/body_damage.png" },
        { type: "shakeScreen", duration: 400 },
        { type: "damage", target: "right", amount: 20, x: "80%", y: "52%", noHpLoss: true },
        { type: "wait", duration: 300 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/stance.png" },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/stance_bodydamage.png" },
        { type: "wait", duration: 1200 },
        { type: "updateSprite", target: "left", src: "assets/characters/zuika/fight/body.png" },
        { type: "wait", duration: 80 },
        { type: "updateSprite", target: "right", src: "assets/characters/gyaru/body_damage.png" },
        { type: "impactSprite", target: "right", motion: "lift-left-down" },
        { type: "shakeScreen", duration: 460 },
        { type: "damage", target: "right", amount: 50, x: "77%", y: "50%", noHpLoss: true },
        { type: "mouthpiece", x: "74%", y: "38%", color: "white", direction: "left-down" },
        { type: "wait", duration: 800 },
        { type: "blackout", duration: 2000 },
        { type: "wait", duration: 1000 },
      ],
    },
    introLines: stage1Text.introLines,
    uiText: stage1Text.ui,
    initialStats: {
      playerHealth: 4,
      playerSpirit: 3,
      rivalLove: 5,
      rivalMotivation: 4,
    },
    statLimits: {
      playerHealth: { min: 0, max: 5 },
      playerSpirit: { min: 0, max: 5 },
      rivalLove: { min: 0, max: 10 },
      rivalMotivation: { min: 0, max: 10 },
    },
    endings: {
      care: {
        id: "care",
        title: stage1Text.endings.care.title,
        galleryId: "ending-care",
        image: "assets/gallery/kanbyou.png",
        description: stage1Text.endings.care.description,
      },
      boycott: {
        id: "boycott",
        title: stage1Text.endings.boycott.title,
        galleryId: "ending-boycott",
        image: "assets/gallery/boikot.png",
        description: stage1Text.endings.boycott.description,
      },
      obsession: {
        id: "obsession",
        title: stage1Text.endings.obsession.title,
        galleryId: "ending-obsession",
        image: "assets/gallery/sukisuki.png",
        description: stage1Text.endings.obsession.description,
      },
      foul: {
        id: "foul",
        title: stage1Text.endings.foul.title,
        galleryId: "ending-foul",
        image: "assets/gallery/yarisugi.png",
        description: stage1Text.endings.foul.description,
      },
      victory: {
        id: "victory",
        title: stage1Text.endings.victory.title,
        galleryId: "ending-win",
        image: "assets/gallery/trueend.png",
        description: stage1Text.endings.victory.description,
        victoryFlavor: stage1Text.endings.victory.victoryFlavor,
      },
    },
    // 隠しモードの勝敗判定（愛情・やる気・体力・気力の閾値分岐）。
    // 旧 game.js のハードコードロジックをそのまま移設したもの。
    endingRules: {
      immediate(stats, endings) {
        if (stats.playerHealth <= 0) {
          return endings.care;
        }
        if (stats.rivalLove <= 0 && stats.rivalMotivation <= 0) {
          return endings.boycott;
        }
        return null;
      },
      final(stats, endings) {
        if (stats.rivalLove >= 8 && stats.rivalMotivation === 0) {
          return endings.obsession;
        }
        if (stats.rivalLove === 0 && stats.rivalMotivation >= 4) {
          return endings.foul;
        }
        if (
          stats.rivalLove >= 6 &&
          stats.rivalMotivation >= 6 &&
          stats.playerHealth >= 1 &&
          stats.playerSpirit >= 1
        ) {
          return endings.victory;
        }
        // 2026-09-17 user decision: former defeat fallback joins the existing boycott ending.
        return endings.boycott;
      },
    },
  },
  ...TRAINING_STAGES,
];
