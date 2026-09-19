// Gallery-only match cards. No campaign state, score calculation or save writes.
export function getSpectatorFighters(content) {
  return (content.battle?.spectator?.fighterIds ?? []).filter(id => content.battle.fighters[id]);
}

export function getSpectatorMove(content, id) {
  const override = content.battle?.spectator?.finishers?.[id];
  const finisher = content.battle?.fighters?.[id]?.finisher;
  return override ?? (finisher ? {
    ...finisher,
    name: content.heroines?.[id]?.moves?.at(-1)?.name || finisher.cutinLabel || "必殺技",
  } : null);
}

export function createSpectatorCard(content, choice, resolveFighter = id => ({ id, ...content.battle.fighters[id] })) {
  const ids = getSpectatorFighters(content);
  if (!ids.includes(choice.leftId) || !ids.includes(choice.rightId) || choice.leftId === choice.rightId
    || !["left", "right"].includes(choice.winnerSide) || !["ko", "decision"].includes(choice.finishType)
    || typeof choice.special !== "boolean") throw new Error("観戦する選手と試合条件を選んでください。");
  const { winnerSide, finishType, special } = choice;
  const loserSide = winnerSide === "left" ? "right" : "left";
  const fighter = id => {
    const base = resolveFighter(id);
    const move = getSpectatorMove(content, id);
    return {
      ...base,
      mouthPoint: content.battle.spectator.mouthPoints?.[id] ?? base.mouthPoint,
      // Keep versioned image URLs supplied by the app. Basic opponent moves
      // have no cut-in artwork and reuse their existing straight pose.
      finisher: special && move ? { ...move, ...base.finisher, name: move.name } : null,
      victoryOnKnockout: true,
      victoryCaption: "",
    };
  };
  const knockout = finishType === "ko";
  return {
    left: fighter(choice.leftId), right: fighter(choice.rightId),
    background: content.battle.backgrounds.default,
    title: "試合観戦", readyLabel: "EXHIBITION MATCH",
    tempo: content.battle.tempo ?? 1,
    result: winnerSide === "right" ? "lose" : knockout ? "ko" : "win",
    winnerSide, finishType, knockoutWinner: knockout ? winnerSide : null,
    resultBanner: { main: knockout ? "KO勝利" : "判定勝利" },
    koMouthpiece: knockout, koFinish: content.battle.koFinish,
    resultHoldMs: 1600,
    events: [
      { actor: loserSide, action: "jab", hit: true, damage: 4 },
      { actor: winnerSide, action: "straight", hit: true, damage: 6 },
      { actor: loserSide, action: "straight", hit: false },
      { actor: winnerSide, action: "jab", hit: true, damage: 7 },
      { actor: loserSide, action: "straight", hit: true, damage: 5 },
      // This last exchange reflects the selected finish; it never decides it.
      { actor: winnerSide, action: knockout ? "finisher" : special ? "technique" : "straight",
        basic: !special, hit: true, damage: 12, heavy: true },
    ],
  };
}
