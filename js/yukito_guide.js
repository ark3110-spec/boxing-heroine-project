// Fixed walkthrough only. No search, stat bonuses or outcome overrides.
export const YUKITO_INTRODUCTION_KEY = "boxing-game-yukito-introduction";

export function loadYukitoIntroduction() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(YUKITO_INTRODUCTION_KEY) ?? "null");
    return value?.version === 1 && ["win", "lose"].includes(value.result) ? value : null;
  } catch { return null; }
}

export function recordYukitoIntroduction(won, previouslyEncountered = false) {
  if (loadYukitoIntroduction()) return null;
  const record = { version: 1, result: won ? "win" : "lose" };
  try { globalThis.localStorage?.setItem(YUKITO_INTRODUCTION_KEY, JSON.stringify(record)); } catch { /* progression remains playable */ }
  return previouslyEncountered ? null : record;
}

export function createYukitoGuide(config, enabled = false) {
  return { enabled: Boolean(enabled), routeVersion: config?.routeVersion, steps: [], deviated: false };
}

export function getYukitoGuideStatus(config, campaign, game) {
  const guide = campaign?.yukitoGuide;
  const route = config?.routes?.[campaign?.heroineId];
  const steps = guide?.steps;
  if (!Array.isArray(route) || !route.length || !Array.isArray(steps)
    || guide?.routeVersion !== config?.routeVersion) return { status: "unverified" };
  if (guide.deviated || steps.length > route.length || steps.some((id, i) => id !== route[i])) {
    return { status: "outside" };
  }
  if (steps.length === route.length) return { status: "complete", week: steps.length };
  const elapsed = (campaign.weeksElapsed ?? 0) + (game?.turn ?? 1) - 1;
  // A retry, missing history or older progress cannot be claimed as a verified prefix.
  if (elapsed !== steps.length || campaign.fightCount !== Math.floor(steps.length / 4) + 1
    || campaign.roundIndex !== Math.floor(steps.length / 4)) return { status: "outside" };
  return { status: "on-route", week: steps.length + 1, commandId: route[steps.length] };
}

export function recordYukitoGuideStep(config, campaign, game, commandId) {
  const guide = campaign?.yukitoGuide;
  if (!guide || !Array.isArray(guide.steps)) return;
  const status = getYukitoGuideStatus(config, campaign, game);
  if (status.status !== "on-route" || status.commandId !== commandId) guide.deviated = true;
  guide.steps.push(commandId);
}

export function yukitoIconMarkup() {
  return `<svg class="yukito-icon" viewBox="0 0 16 20" width="32" height="40" aria-hidden="true" shape-rendering="crispEdges">
    <path fill="#e8eaf2" d="M3 1h3v8H3zM10 0h3v9h-3zM2 8h12v3h1v6h-2v2H3v-2H1v-6h1z"/>
    <path fill="#fff" d="M4 2h1v6H4zM11 1h1v7h-1zM3 9h10v7H3zM4 16h8v2H4z"/>
    <path fill="#efb7cb" d="M4 4h1v4H4zM11 3h1v5h-1zM3 14h2v1H3zM11 14h2v1h-2zM7 14h2v1H7z"/>
    <path fill="#263042" d="M5 11h1v2H5zM10 11h1v2h-1zM7 16h2v1H7z"/>
  </svg>`;
}
