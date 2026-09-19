import { COMMANDS } from "./data.js?v=20260920-gallery-spoilers-a1";

// ステージが statLimits を定義していない場合の保険値。
// 実際の上限・下限は各ステージ定義（stages.js）側で持たせる。
const DEFAULT_STAT_LIMITS = {
  playerHealth: { min: 0, max: 5 },
  playerSpirit: { min: 0, max: 5 },
  rivalLove: { min: 0, max: 10 },
  rivalMotivation: { min: 0, max: 10 },
};

// 文言はステージ定義（uiText）側を正とする。これはステージが文言を持たない
// 場合のみ使われる、キャラクター名を含まない中立的な保険値。
const FALLBACK_UI_TEXT = {
  initialLog: "準備完了。ターンを乗り切ろう。",
  commandRejected: {
    finished: "ゲームは終了しています。",
    forcedRest: "次のターンは強制休憩。休むのみ選択できます。",
  },
  turnMessages: {
    immediateEnding: "{ending} に突入した。",
    finalEnding: "最終ターン終了。{ending} になった。",
    forcedRestNotice: "気力が限界だ。次のターンは強制的に休むしかない。",
  },
};

function clampStat(key, value, limits) {
  const { min, max } = limits[key];
  return Math.max(min, Math.min(max, value));
}

function formatScriptLines(lines) {
  return lines.map(({ speaker, text }) => `${speaker}: ${text}`).join("\n");
}

function fillTemplate(template, values) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function getUiText(stageOrState) {
  return stageOrState.uiText ?? stageOrState.stageUiText ?? FALLBACK_UI_TEXT;
}

export function createGameState(stage, initialStats = stage.initialStats) {
  return {
    stageId: stage.id,
    turn: 1,
    maxTurn: stage.turnLimit,
    stats: { ...initialStats },
    statLimits: stage.statLimits ?? DEFAULT_STAT_LIMITS,
    // 強制休憩で唯一許可されるコマンド（隠し: rest / 育成: recover）。
    restCommandId: stage.restCommandId ?? "rest",
    // 0以下で次ターン強制休憩になる「疲弊」ステータス（隠し: playerSpirit / 育成: cond）。
    exhaustionKey: stage.exhaustionKey ?? "playerSpirit",
    flags: {
      giftUsed: false,
      forcedRestNextTurn: false,
    },
    finished: false,
    ending: null,
    log: getUiText(stage).initialLog,
    lastAction: null,
    stageUiText: getUiText(stage),
  };
}

export function getCommandState(command, gameState) {
  const uiText = getUiText(gameState);

  if (gameState.finished) {
    return { disabled: true, reason: uiText.commandRejected.finished };
  }

  const restId = gameState.restCommandId ?? "rest";
  if (gameState.flags.forcedRestNextTurn && command.id !== restId) {
    return { disabled: true, reason: uiText.commandRejected.forcedRest };
  }

  const check = command.usageCheck({ gameState });
  if (!check.ok) {
    return { disabled: true, reason: check.reason };
  }

  return { disabled: false, reason: "" };
}

function applyCommand(gameState, command, stage) {
  const limits = gameState.statLimits ?? DEFAULT_STAT_LIMITS;

  // 育成モードの成長補正（得意練習 +50% / コンディション低下時の獲得半減）。
  // 値・キーはすべて stage.training（データ）側に持たせ、エンジンは汎用のまま。
  const training = stage?.training;
  let growthMultiplier = 1;
  if (training) {
    if (training.specialtyCommandId && command.id === training.specialtyCommandId) {
      growthMultiplier *= training.specialtyMultiplier ?? 1;
    }
    if (
      training.condKey &&
      training.condPenaltyThreshold != null &&
      gameState.stats[training.condKey] < training.condPenaltyThreshold
    ) {
      growthMultiplier *= training.condPenaltyMultiplier ?? 1;
    }
  }

  const nextStats = { ...gameState.stats };
  for (const [key, delta] of Object.entries(command.effect)) {
    // 成長（プラス変化）にのみ補正を掛ける。消費（マイナス変化）はそのまま。
    const applied = delta > 0 ? Math.round(delta * growthMultiplier) : delta;
    nextStats[key] = clampStat(key, nextStats[key] + applied, limits);
  }

  const giftUsed = gameState.flags.giftUsed || command.id === "gift";

  return {
    ...gameState,
    stats: nextStats,
    flags: {
      ...gameState.flags,
      giftUsed,
      forcedRestNextTurn: false,
    },
    lastAction: command.id,
    log: formatScriptLines(command.responseLines),
  };
}

// 確定処理と同じ補正・上限で予測する。週進行や勝敗判定は行わない。
export function previewCommandStats(stage, gameState, command) {
  if (getCommandState(command, gameState).disabled) return { ...gameState.stats };
  return applyCommand(gameState, command, stage).stats;
}

// エンディング判定ルールはステージ定義（stages.js の endingRules）に委譲する。
// これによりモードごとに異なる勝敗ロジック（隠しモードの愛情/やる気判定、
// 育成モードの育成値判定式など）を、エンジンを変えずに差し替えられる。
function getImmediateEnding(stage, stats) {
  return stage.endingRules?.immediate?.(stats, stage.endings) ?? null;
}

function getFinalEnding(stage, stats) {
  return stage.endingRules?.final?.(stats, stage.endings) ?? null;
}

export function advanceTurn(stage, currentState, commandId) {
  const command = COMMANDS.find((item) => item.id === commandId);
  if (!command) {
    return currentState;
  }

  const commandState = getCommandState(command, currentState);
  if (commandState.disabled) {
    return {
      ...currentState,
      log: commandState.reason,
    };
  }

  const uiText = getUiText(stage);
  let nextState = applyCommand(currentState, command, stage);
  const immediateEnding = getImmediateEnding(stage, nextState.stats);
  if (immediateEnding) {
    return {
      ...nextState,
      finished: true,
      ending: immediateEnding,
      log: `${nextState.log}\n${fillTemplate(uiText.turnMessages.immediateEnding, { ending: immediateEnding.title })}`,
    };
  }

  const exhaustionKey = nextState.exhaustionKey ?? "playerSpirit";
  const shouldForceRest = nextState.turn < nextState.maxTurn && nextState.stats[exhaustionKey] <= 0;
  const nextTurn = nextState.turn + 1;

  if (nextState.turn >= nextState.maxTurn) {
    const finalEnding = getFinalEnding(stage, nextState.stats);
    return {
      ...nextState,
      finished: true,
      ending: finalEnding,
      log: `${nextState.log}\n${fillTemplate(uiText.turnMessages.finalEnding, { ending: finalEnding.title })}`,
    };
  }

  return {
    ...nextState,
    turn: nextTurn,
    flags: {
      ...nextState.flags,
      forcedRestNextTurn: shouldForceRest,
    },
    log: shouldForceRest
      ? `${nextState.log}\n${uiText.turnMessages.forcedRestNotice}`
      : nextState.log,
    stageUiText: uiText,
  };
}
