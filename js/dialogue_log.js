import { STORAGE_KEYS } from "./data.js?v=20260920-gallery-spoilers-a1";

// 既読会話の記録（DEC-055 #9）。会話イベントIDを永続保存し、周回の自動スキップ判定に使う。
// キャンペーン途中保存とは独立し、保存不能でも進行を止めない。
const STORAGE_KEY = STORAGE_KEYS.seenDialogues ?? "boxing-game-seen-dialogues";

export function loadSeenDialogues() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function hasSeenDialogue(id) {
  return typeof id === "string" && id !== "" && loadSeenDialogues().includes(id);
}

export function markDialogueSeen(id) {
  if (typeof id !== "string" || id === "") return false;
  const seen = loadSeenDialogues();
  if (seen.includes(id)) return true;
  seen.push(id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
    return true;
  } catch {
    return false;
  }
}

export function resetSeenDialogues() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
