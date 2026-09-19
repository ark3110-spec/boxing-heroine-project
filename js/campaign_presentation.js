// Presentation reads committed actions/results; it never rolls or settles a match.
export function trainingEventLines(heroine, event, action) {
  const intro = event.continuesFrom ? [] : heroine.eventLeadIns?.[action] ?? [];
  return [...intro, ...event.lines.map(({ byAction, ...line }) => ({
    ...line, ...(byAction?.[action] ?? {}),
  }))];
}

export function previewEventProgress(heroine, game, roundId, progress = {}) {
  const firedEventIds = [...(progress?.firedEventIds ?? [])];
  // The final action settles the match before weekly events, just like advanceTurn.
  if (!game.finished && game.turn < game.maxTurn) {
    for (const event of heroine.events ?? []) {
      if (event.turn === game.turn + 1 && (event.round == null || event.round === roundId)
          && !firedEventIds.includes(event.id)) firedEventIds.push(event.id);
    }
  }
  return { ...progress, firedEventIds };
}

export function matchPresentation(record) {
  if (!record) return { winnerSide: null, finishType: null, revenge: false };
  return {
    winnerSide: record.result === 'draw' ? null : ['win', 'ko'].includes(record.result) ? 'left' : 'right',
    finishType: record.result === 'ko' || record.knockout ? 'ko' : 'decision',
    revenge: record.revenge === true,
  };
}

export function victoryReaction(heroine, record) {
  if (!record || !['win', 'ko'].includes(record.result)) return [];
  return heroine.victoryReactions?.[record.revenge ? 'revenge' : record.roundId] ?? [];
}

export function isSavedRevengeAttempt(campaign, game, hiddenRoundId) {
  if (typeof campaign.isRevenge === 'boolean') return campaign.isRevenge;
  // Migrate only an identifiable in-progress retry from older saves.
  const last = campaign.results?.at(-1);
  return !game.finished && campaign.currentRoundId !== hiddenRoundId
    && last?.roundId === campaign.currentRoundId && ['lose', 'draw'].includes(last.result)
    && last.fight === campaign.fightCount - 1;
}

// Two decimals retain the score precision used by the current weights (61.96 < 62).
export function formatMatchScore(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}
