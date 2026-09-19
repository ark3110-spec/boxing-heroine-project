import { COMMAND_TEXTS, STAGE_TEXTS } from "./texts.js?v=20260920-gallery-spoilers-a1";
import { CONTENT } from "./content.js?v=20260920-gallery-spoilers-a1";

export const STORAGE_KEYS = {
  gallery: "boxing-game-gallery",
  endings: "boxing-game-endings",
  campaign: "boxing-game-campaign",
  seenDialogues: "boxing-game-seen-dialogues",
  audioSettings: "boxing-game-audio-settings",
};

// 隠しモード（元エイプリルフール版）用コマンド。
const HIDDEN_COMMANDS = [
  {
    id: "cheer",
    name: COMMAND_TEXTS.cheer.name,
    description: COMMAND_TEXTS.cheer.description,
    effect: {
      playerHealth: -1,
      playerSpirit: 0,
      rivalLove: 0,
      rivalMotivation: 2,
    },
    usageCheck: () => ({ ok: true }),
    responseLines: COMMAND_TEXTS.cheer.responses,
  },
  {
    id: "love",
    name: COMMAND_TEXTS.love.name,
    description: COMMAND_TEXTS.love.description,
    effect: {
      playerHealth: 0,
      playerSpirit: -1,
      rivalLove: 3,
      rivalMotivation: 0,
    },
    usageCheck: () => ({ ok: true }),
    responseLines: COMMAND_TEXTS.love.responses,
  },
  {
    id: "rest",
    name: COMMAND_TEXTS.rest.name,
    description: COMMAND_TEXTS.rest.description,
    effect: {
      playerHealth: 2,
      playerSpirit: 2,
      rivalLove: -3,
      rivalMotivation: -3,
    },
    usageCheck: () => ({ ok: true }),
    responseLines: COMMAND_TEXTS.rest.responses,
  },
  {
    id: "gift",
    name: COMMAND_TEXTS.gift.name,
    description: COMMAND_TEXTS.gift.description,
    effect: {
      playerHealth: 0,
      playerSpirit: 0,
      rivalLove: 4,
      rivalMotivation: 4,
    },
    usageCheck: ({ gameState }) => {
      if (gameState.flags.giftUsed) {
        return { ok: false, reason: COMMAND_TEXTS.gift.errors.used };
      }
      if (gameState.stats.playerSpirit < 2) {
        return { ok: false, reason: COMMAND_TEXTS.gift.errors.spirit };
      }
      return { ok: true };
    },
    responseLines: COMMAND_TEXTS.gift.responses,
  },
];

// 育成コマンドは content/commands.json を正とする。
const TRAINING_COMMANDS = (CONTENT.commands ?? []).map(
  ({ id, name, description, effect = {}, responses = [] }) => ({
    id,
    name,
    description,
    effect,
    usageCheck: () => ({ ok: true }),
    responseLines: responses,
  }),
);

// 全コマンドの登録簿（エンジンは id でここから引く）。
export const COMMANDS = [...HIDDEN_COMMANDS, ...TRAINING_COMMANDS];

// ステージが commandIds を持つ場合、その順番でコマンドを返す。
// 持たない場合は全コマンド（後方互換）。
export function getStageCommands(stage) {
  const ids = stage?.commandIds;
  if (!ids) return COMMANDS;
  const byId = new Map(COMMANDS.map((command) => [command.id, command]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

const stage1GalleryText = STAGE_TEXTS.stage1.gallery;

export const GALLERY_BASE_ITEMS = [
  {
    id: "opening-champion",
    stageId: "stage1",
    endingId: "opening-champion",
    title: stage1GalleryText["opening-champion"].title,
    description: stage1GalleryText["opening-champion"].description,
    image: "assets/gallery/OP_1.png",
    comments: stage1GalleryText["opening-champion"].comments,
  },
  {
    id: "ending-win",
    stageId: "stage1",
    endingId: "victory",
    title: stage1GalleryText["ending-win"].title,
    description: stage1GalleryText["ending-win"].description,
    image: "assets/gallery/trueend.png",
    comments: stage1GalleryText["ending-win"].comments,
  },

  {
    id: "ending-care",
    stageId: "stage1",
    endingId: "care",
    title: stage1GalleryText["ending-care"].title,
    description: stage1GalleryText["ending-care"].description,
    image: "assets/gallery/kanbyou.png",
    comments: stage1GalleryText["ending-care"].comments,
  },
  {
    id: "ending-boycott",
    stageId: "stage1",
    endingId: "boycott",
    title: stage1GalleryText["ending-boycott"].title,
    description: stage1GalleryText["ending-boycott"].description,
    image: "assets/gallery/boikot.png",
    comments: stage1GalleryText["ending-boycott"].comments,
  },
  {
    id: "ending-obsession",
    stageId: "stage1",
    endingId: "obsession",
    title: stage1GalleryText["ending-obsession"].title,
    description: stage1GalleryText["ending-obsession"].description,
    image: "assets/gallery/sukisuki.png",
    comments: stage1GalleryText["ending-obsession"].comments,
  },
  {
    id: "ending-foul",
    stageId: "stage1",
    endingId: "foul",
    title: stage1GalleryText["ending-foul"].title,
    description: stage1GalleryText["ending-foul"].description,
    image: "assets/gallery/yarisugi.png",
    comments: stage1GalleryText["ending-foul"].comments,
  },
  ...(CONTENT.campaign?.gallery ?? []),
];
