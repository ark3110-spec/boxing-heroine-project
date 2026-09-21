import { TRAINING_HEROINE_FALLBACK, TRAINING_COMMAND_FALLBACK } from "./training_texts.js?v=20260921-v110-yukito-a1";

const fallback = {
  heroines: TRAINING_HEROINE_FALLBACK,
  commands: TRAINING_COMMAND_FALLBACK,
  opponents: {},
  campaign: { rounds: [], advanceOn: ["win", "ko"] },
  standingSprites: {
    version: 1,
    canvas: { width: 192, height: 320, previewScale: 4, alphaRule: "binary_0_255", paletteLimit: 48 },
    characters: {},
  },
  battle: {
    backgrounds: {},
    fighters: {},
  },
  audio: { bgm: {}, se: {} },
};

async function loadJson(name, fallbackValue) {
  try {
    const response = await fetch(`content/${name}.json?v=20260921-v110-yukito-a1`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`[content] ${name}.json を読み込めませんでした。内蔵データで続行します。`, error);
    return fallbackValue;
  }
}

function validateContent(content) {
  const warn = (message) => console.warn(`[content] ${message}`);
  const heroineEntries = Object.entries(content.heroines ?? {});
  if (!heroineEntries.length) warn("heroines.json にヒロインがありません。");
  heroineEntries.forEach(([id, heroine]) => {
    ["name", "initialStats", "specialtyCommandId"].forEach((key) => {
      if (heroine?.[key] == null) warn(`heroines.${id}.${key} がありません。`);
    });
  });
  const opponentIds = new Set(Object.keys(content.opponents ?? {}));
  const schedule = content.campaign?.schedule ?? {};
  if (!Number.isInteger(schedule.weeksPerFight) || schedule.weeksPerFight < 1) {
    warn("campaign.schedule.weeksPerFight が不正です。");
  }
  if (!Number.isInteger(schedule.maxFights) || schedule.maxFights < 1) {
    warn("campaign.schedule.maxFights が不正です。");
  }
  [...(content.campaign?.rounds ?? []), content.campaign?.hiddenRound]
    .filter(Boolean)
    .forEach((round) => {
      if (!opponentIds.has(round.opponentId)) {
        warn(`campaign のラウンド ${round.id} が未知の opponentId "${round.opponentId}" を参照しています。`);
      }
      if (!Number.isFinite(round.trainingTurns) || round.trainingTurns < 1) {
        warn(`campaign のラウンド ${round.id} の trainingTurns が不正です。`);
      }
      if (Number.isInteger(schedule.weeksPerFight) && round.trainingTurns !== schedule.weeksPerFight) {
        warn(`campaign のラウンド ${round.id} は ${schedule.weeksPerFight}週設定と一致しません。`);
      }
    });
  const galleryItems = content.campaign?.gallery ?? [];
  const galleryIds = galleryItems.map((item) => item.id).filter(Boolean);
  const endingIds = galleryItems.map((item) => item.endingId).filter(Boolean);
  if (new Set(galleryIds).size !== galleryIds.length) {
    warn("campaign.gallery に重複する id があります。");
  }
  if (new Set(endingIds).size !== endingIds.length) {
    warn("campaign.gallery に重複する endingId があります。");
  }
}

export async function loadContent() {
  const [heroines, opponents, campaign, commands, standingSprites, battle, audio] = await Promise.all([
    loadJson("heroines", fallback.heroines),
    loadJson("opponents", fallback.opponents),
    loadJson("campaign", fallback.campaign),
    loadJson("commands", fallback.commands),
    loadJson("standing_sprites", fallback.standingSprites),
    loadJson("battle", fallback.battle),
    loadJson("audio", fallback.audio),
  ]);
  const content = { heroines, opponents, campaign, commands, standingSprites, battle, audio };
  validateContent(content);
  return content;
}

export const CONTENT = await loadContent();
