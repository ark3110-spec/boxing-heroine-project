import { STORAGE_KEYS } from "./data.js?v=20260921-v110-yukito-a1";

import { SAVE_VERSION } from "./version.js?v=20260921-v110-yukito-a1";
const SAVABLE_SCREENS = new Set(["game", "dialogue", "ending"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasValue(object, key) {
  return Object.hasOwn(object, key) && object[key] !== null && object[key] !== undefined;
}

function isValidSnapshot(snapshot) {
  if (!isPlainObject(snapshot) || snapshot.version !== SAVE_VERSION) return false;
  if (!SAVABLE_SCREENS.has(snapshot.screen)) return false;
  if (!isPlainObject(snapshot.campaign) || !isPlainObject(snapshot.game)) return false;
  if (typeof snapshot.heroineId !== "string" || typeof snapshot.roundId !== "string") return false;
  if (!isPlainObject(snapshot.game.stats) || typeof snapshot.game.finished !== "boolean") return false;
  if (snapshot.game.finished && !hasValue(snapshot.game, "ending")) return false;
  if (snapshot.screen === "dialogue" && !isPlainObject(snapshot.dialogue)) return false;
  return true;
}

export function saveCampaignProgress(snapshot) {
  const storedSnapshot = {
    ...snapshot,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
  };
  if (!isValidSnapshot(storedSnapshot)) return false;

  try {
    localStorage.setItem(STORAGE_KEYS.campaign, JSON.stringify(storedSnapshot));
    return true;
  } catch {
    return false;
  }
}

export function loadCampaignSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.campaign);
    if (raw === null) return null;
    const snapshot = JSON.parse(raw);
    if (isValidSnapshot(snapshot)) return snapshot;
  } catch {
    // Invalid or inaccessible saves are removed below when possible.
  }

  clearCampaignSave();
  return null;
}

export function clearCampaignSave() {
  try {
    localStorage.removeItem(STORAGE_KEYS.campaign);
    return true;
  } catch {
    return false;
  }
}
