import { trainingEventLines, previewEventProgress, matchPresentation, victoryReaction, formatMatchScore, isSavedRevengeAttempt } from "./campaign_presentation.js?v=20260920-pages-debug-a1";
import { pixelReady, pixelActorMarkup, mountPixelActors, clearPixelActors, playPixelTraining, playPixelRevenge } from "./pixel_scene.js?v=20260920-pages-debug-a1";
import { COMMANDS, getStageCommands } from "./data.js?v=20260920-pages-debug-a1";
import { createGameState, advanceTurn, getCommandState, previewCommandStats } from "./game.js?v=20260920-pages-debug-a1";
import { getGalleryItems, getGyaruClearProgress, loadReachedEndings, loadUnlockedGallery, unlockGalleryItem, unlockEventArtwork } from "./gallery.js?v=20260920-pages-debug-a1";
import { hasSeenDialogue, markDialogueSeen } from "./dialogue_log.js?v=20260920-pages-debug-a1";
import { STAGES, applyHeroineName, canChallengeHiddenRound, createCampaignStage, getAcquiredMoves, getTrainingMatchForecast, getTrainingStatTargets, resolveCampaignOpponent } from "./stages.js?v=20260920-pages-debug-a1";
import { playActionSequence } from "./sequence.js?v=20260920-pages-debug-a1";
import { playBattleScene, getRoundBattlePresentation } from "./battle_scene.js?v=20260920-pages-debug-a1";
import { getSpectatorFighters, getSpectatorMove, createSpectatorCard } from "./spectator.js?v=20260920-pages-debug-a1";
import { CONTENT } from "./content.js?v=20260920-pages-debug-a1";
import { loadCampaignSave, saveCampaignProgress, clearCampaignSave } from "./campaign_save.js?v=20260920-pages-debug-a1";
import { getAudioSettings, setAudioSettings, playSfx as playConfiguredSfx, unlockAudio, playBgm, stopBgm, configureAudioSources } from "./audio.js?v=20260920-pages-debug-a1";
import { resolveDialoguePresentation } from "./content_media.js?v=20260920-pages-debug-a1";
import { getCornerProgress, recordCornerProgress, resetCornerProgress, getEffectiveCornerThresholds } from "./corner_progress.js?v=20260920-pages-debug-a1";

import { createYukitoGuide, getYukitoGuideStatus, recordYukitoGuideStep, yukitoIconMarkup, loadYukitoIntroduction, recordYukitoIntroduction } from "./yukito_guide.js?v=20260920-pages-debug-a1";

import { getLanguage, englishAvailable, setLanguage, localizeUI, observeLocalizedUI } from "./i18n.js?v=20260920-pages-debug-a1";
import { GAME_VERSION, SAVE_VERSION } from "./version.js?v=20260920-pages-debug-a1";

const app = document.querySelector("#app");
configureAudioSources(CONTENT.audio);
// start_local.bat opts in on loopback only. Published URLs cannot enable debug.
const DEV_PREVIEW_ENABLED = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).get("dev") === "1";

const state = {
  screen: "title",
  conversationIndex: 0,
  selectedGalleryId: null,
  selectedGalleryTab: "ren",
  yukitoGuideChoice: false,
  readSkipChoice: false,   // 新規開始時の「既読の会話を飛ばす」選択（campaign.skipReadDialogues へ写す）
  selectedTrainingCharacterId: "ren",
  currentStage: STAGES[0],
  game: null,
  pendingCommandId: null,
  fightSpriteKey: "stance",
  dialogue: null,          // 導入会話・育成中イベント用 { lines, index, after }
  firedEventIds: [],       // 発火済みイベントid（同じイベントの再発火防止）
  campaign: null,
  trainingAnimationActive: false,
  revengeAnimationActive: false,
  battleResult: null,
  battleKnockoutWinner: null,
  battleSceneActive: false,
  cornerResetPending: false,
  cornerResetDone: false,
  soundReturnScreen: "title",
  hiddenIntro: null,
  hiddenChallengeFresh: false,
  spectatorChoice: null,
  spectatorActive: false,
  spectatorCompleted: false,
};

let victoryAnimationTimer = null;
let lastRenderedScreen = null;
let lastDialogueSoundLine = null;
let activeMoveAnnouncement = null;
let moveAnnouncementTimer = null;

function hasPreviousYukitoEncounter() {
  const recorded = new Set([...loadReachedEndings(), ...loadUnlockedGallery()]);
  return Boolean(loadYukitoIntroduction()) || (CONTENT.campaign.yukitoGuide?.introduction?.unlockEndingIds ?? []).some(id => recorded.has(id));
}

function canUseYukitoGuide() {
  return DEV_PREVIEW_ENABLED || hasPreviousYukitoEncounter() || state.campaign?.yukitoGuide?.enabled === true;
}
function playSfx(id) {
  return playConfiguredSfx(id, { builtin: state.currentStage?.mode === "hidden" && ["conversation", "game", "victory-fight", "yarisugi-fight", "ending"].includes(state.screen) });
}
const ASSET_VERSION = "20260920-pages-debug-a1";
const acquiredMoveRenderSnapshots = new WeakMap();
const TRAINING_STAT_LABELS = {
  pow: "POW",
  spd: "SPD",
  sta: "STA",
  tec: "TEC",
  cond: "COND",
};
const TITLE_SCREEN = {
  eyebrow: "PIXEL BOXING TRAINING GAME",
  title: "ボクシングヒロイン",
  subtitle: "―花冠のリング―",
  lead: "3人のボクサーを育成し、試合の勝敗へつなげるボクシング育成・試合ゲームへ改造中。",
  image: "assets/title/title_keyvisual.png",
  replacementImagePath: "assets/title/title_keyvisual.png",
  legacyImage: "assets/title/title_main.png",
  imageAlt: "ボクシングヒロイン ―花冠のリング― タイトルキービジュアル",
  ...(CONTENT.campaign.titleScreen ?? {}),
};
document.title = `${TITLE_SCREEN.title} ${TITLE_SCREEN.subtitle}`.trim();

const PLAYABLE_HEROINE_IDS = CONTENT.campaign.playableHeroineIds?.length
  ? CONTENT.campaign.playableHeroineIds
  : Object.keys(CONTENT.heroines);

function getStandingSprite(characterId, expression = "", pose = "") {
  const character = CONTENT.standingSprites?.characters?.[characterId];
  const outfit = character?.outfits?.[character.defaultOutfit];
  if (!outfit) return null;
  const resolvedExpression = expression || outfit.defaultExpression;
  const resolvedPose = pose || outfit.defaultPose;
  const requestedKey = `${resolvedExpression}.${resolvedPose}`;
  const defaultKey = `${outfit.defaultExpression}.${outfit.defaultPose}`;
  return outfit.sprites?.[requestedKey] ?? outfit.sprites?.[defaultKey] ?? null;
}

const TRAINING_CHARACTERS = PLAYABLE_HEROINE_IDS.filter((id) => CONTENT.heroines[id]).map((id) => {
  const text = CONTENT.heroines[id];
  const standingSprite = getStandingSprite(id);
  return {
    id,
    name: text.name,
    type: text.type,
    copy: text.copy,
    portrait: text.portrait ?? "",
    standingImage: standingSprite?.src ?? "",
    trainingImage: text.trainingImage ?? text.portrait ?? "",
    trainingAnimations: text.trainingAnimations ?? {},
    themeClass: text.themeClass ?? id,
    profile: text.profile ?? { hp: 100, attack: 50, defense: 50 },
  };
});

function assetUrl(src) {
  if (!src) return "";
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}v=${ASSET_VERSION}`;
}

function normalizeTrainingAnimationFrame(entry) {
  if (typeof entry === "string") return { src: entry, flipX: false };
  if (entry && typeof entry.src === "string") {
    return { src: entry.src, flipX: entry.flipX === true };
  }
  return null;
}

function versionBattleSprite(entry) {
  if (typeof entry === "string") return assetUrl(entry);
  if (entry?.sheet) return { ...entry, sheet: assetUrl(entry.sheet) };
  return entry;
}

function getBattleFighter(id, name) {
  const definition = CONTENT.battle?.fighters?.[id] ?? {};
  const sprites = Object.fromEntries(
    Object.entries(definition.sprites ?? {}).map(([key, entry]) => [key, versionBattleSprite(entry)]),
  );
  return {
    id,
    ...definition,
    name: name || definition.name || id,
    sprites,
    victoryImage: assetUrl(definition.victoryImage ?? ""),
    finisher: definition.finisher ? {
      ...definition.finisher,
      cutinImage: assetUrl(definition.finisher.cutinImage ?? ""),
      background: assetUrl(definition.finisher.background ?? ""),
    } : null,
  };
}

function currentAcquiredMoves(heroine, stats) { return getAcquiredMoves(heroine, stats, state.campaign ?? {}); }

function createCampaignBattleCard(result) {
  const campaign = state.campaign;
  const round = state.currentStage.campaignRound;
  const opponent = state.currentStage.opponent ?? {};
  const heroine = CONTENT.heroines[campaign.heroineId];
  const leftId = campaign.heroineId;
  const rightId = opponent.id || round.opponentId;
  const backgrounds = CONTENT.battle?.backgrounds ?? {};
  const left = getBattleFighter(leftId, heroine.name);
  const acquiredMoves = currentAcquiredMoves(heroine, state.game?.stats ?? campaign.stats);
  const acquiredMove = acquiredMoves[acquiredMoves.length - 1];
  if (acquiredMove) {
    left.finisher = {
      ...(left.finisher ?? {}),
      name: acquiredMove.name,
    };
  } else {
    left.finisher = null;
  }
  if (CONTENT.battle?.presentationByRound?.[round.id]?.basicFinishers?.includes(leftId)) left.finisher = null;
  return {
    left,
    right: getBattleFighter(rightId, opponent.name),
    background: assetUrl(backgrounds[round.id] ?? backgrounds[rightId] ?? backgrounds.default ?? ""),
    result,
    tempo: CONTENT.battle?.tempo ?? 1,
    title: round.label,
    ...getRoundBattlePresentation(CONTENT.battle, round.id, result, state.battleKnockoutWinner),
    knockoutWinner: state.battleKnockoutWinner,
    koFinish: CONTENT.battle?.koFinish,
    ...matchPresentation(campaign.results.at(-1)),
    preloadImages: [assetUrl(state.game.ending.image)],
  };
}

function renderCampaignBattleScene() {
  if (state.battleSceneActive || !state.battleResult) return;
  state.battleSceneActive = true;
  const card = createCampaignBattleCard(state.battleResult);
  const complete = () => {
    state.battleSceneActive = false;
    if (state.screen !== "campaign-battle") return;
    state.battleResult = null;
    showCampaignEnding();
  };
  // 画像の準備中に、直前の練習画面を再操作できないようにする。
  app.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  playBattleScene(app, card, complete).catch((error) => {
    console.warn("[battle] 試合演出を再生できなかったため、結果画面へ進みます。", error);
    complete();
  });
}

function renderMediaSlot({ src, alt, placeholderClass, title, body }) {
  return `
    <div class="media-slot">
      <img
        class="media-image"
        src="${assetUrl(src)}"
        alt="${escapeHtml(alt)}"
        onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
      >
      <div class="placeholder-art ${placeholderClass}" style="display:none;">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(body)}</p>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getGalleryDisplayImage(item) {
  if (item?.id === "ending-win") {
    return "assets/gallery/trueend.png";
  }
  return item?.image ?? "";
}

const GALLERY_ALBUM_TABS = [
  { id: "ren", label: "紅 蓮華", shortLabel: "蓮華", accent: "#e23b4e" },
  { id: "tsubaki", label: "氷室 椿", shortLabel: "椿", accent: "#748bb5" },
  { id: "amane", label: "因幡 甘音", shortLabel: "甘音", accent: "#d6a348" },
  { id: "special", label: "SPECIAL", shortLabel: "SPECIAL", accent: "#a88bc4" },
];

function getGalleryAlbumTabId(item) {
  if (item?.id?.startsWith("campaign-ren-")) return "ren";
  if (item?.id?.startsWith("campaign-tsubaki-")) return "tsubaki";
  if (item?.id?.startsWith("campaign-amane-")) return "amane";
  return "special";
}

function renderTitlePlaceholderArt() {
  return `
    <div class="pixel-title-stage" aria-hidden="true">
      <div class="pixel-ring">
        <div class="pixel-rope rope-top"></div>
        <div class="pixel-rope rope-mid"></div>
        <div class="pixel-rope rope-bottom"></div>
        <div class="pixel-silhouette boxer-left">
          <span class="pixel-head"></span>
          <span class="pixel-hair"></span>
          <span class="pixel-body"></span>
          <span class="pixel-arm arm-front"></span>
          <span class="pixel-arm arm-back"></span>
          <span class="pixel-glove glove-front"></span>
          <span class="pixel-glove glove-back"></span>
          <span class="pixel-leg leg-front"></span>
          <span class="pixel-leg leg-back"></span>
        </div>
        <div class="pixel-silhouette boxer-right">
          <span class="pixel-head"></span>
          <span class="pixel-hair"></span>
          <span class="pixel-body"></span>
          <span class="pixel-arm arm-front"></span>
          <span class="pixel-arm arm-back"></span>
          <span class="pixel-glove glove-front"></span>
          <span class="pixel-glove glove-back"></span>
          <span class="pixel-leg leg-front"></span>
          <span class="pixel-leg leg-back"></span>
        </div>
        <div class="pixel-logo-block">
          <span>${escapeHtml(TITLE_SCREEN.title)}</span>
          <strong>${escapeHtml(TITLE_SCREEN.subtitle)}</strong>
        </div>
      </div>
    </div>
  `;
}

function getSelectedTrainingCharacter() {
  return TRAINING_CHARACTERS.find((character) => character.id === state.selectedTrainingCharacterId)
    ?? TRAINING_CHARACTERS[0];
}

// 得意練習名・初期ステータス表記は stages.js の数値から動的に作る（二重持ち防止）。
function getSpecialtyName(characterId) {
  const stage = getTrainingStage(characterId);
  const command = COMMANDS.find((c) => c.id === stage?.training?.specialtyCommandId);
  return command?.name ?? "";
}

function getTrainingStatsLabel(characterId) {
  const stage = getTrainingStage(characterId);
  const s = stage?.initialStats;
  if (!s) return "";
  return `パワー ${s.pow} / スピード ${s.spd} / スタミナ ${s.sta} / テクニック ${s.tec}`;
}

function getCombatProfileLabel(character) {
  const profile = character?.profile ?? {};
  return `HP ${profile.hp ?? "-"} / ATK ${profile.attack ?? "-"} / DEF ${profile.defense ?? "-"}`;
}

function renderTrainingCharacterFigure(character, className = "", useTrainingArt = false, useStandingArt = false, standingImage = character.standingImage) {
  const hasStandingArt = useStandingArt && Boolean(standingImage);
  const image = useTrainingArt
    ? character.trainingImage
    : hasStandingArt ? standingImage : character.portrait;
  const fallback = useTrainingArt || hasStandingArt ? character.portrait : "";
  const imageKindClass = hasStandingArt ? "is-standing-sprite" : "is-legacy-portrait";
  const fallbackHandler = hasStandingArt && fallback !== image
    ? `if(!this.dataset.fallback){this.dataset.fallback='1';this.classList.remove('is-standing-sprite');this.classList.add('is-legacy-portrait');this.closest('.training-figure-stage')?.classList.remove('has-standing-sprite');this.src='${assetUrl(fallback)}';}else{this.style.display='none';this.nextElementSibling.style.display='grid';}`
    : fallback && fallback !== image
      ? `if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${assetUrl(fallback)}';}else{this.style.display='none';this.nextElementSibling.style.display='grid';}`
      : "this.style.display='none';this.nextElementSibling.style.display='grid';";
  if (image) {
    return `
      <img
        class="training-character-image ${className} ${imageKindClass}"
        src="${assetUrl(image)}"
        alt="${escapeHtml(character.name)}"
        onerror="${fallbackHandler}"
      >
      <div class="training-character-pixel ${character.themeClass} ${className}" style="display:none;" aria-hidden="true">
        <span class="tc-head"></span>
        <span class="tc-hair"></span>
        <span class="tc-body"></span>
        <span class="tc-glove left"></span>
        <span class="tc-glove right"></span>
        <span class="tc-leg left"></span>
        <span class="tc-leg right"></span>
      </div>
    `;
  }

  return `
    <div class="training-character-pixel ${character.themeClass} ${className}" aria-hidden="true">
      <span class="tc-head"></span>
      <span class="tc-hair"></span>
      <span class="tc-body"></span>
      <span class="tc-glove left"></span>
      <span class="tc-glove right"></span>
      <span class="tc-leg left"></span>
      <span class="tc-leg right"></span>
    </div>
  `;
}

function renderExtrasTitle() {
  const title = CONTENT.campaign.extrasTitle;
  app.innerHTML = `<main class="screen extras-title-screen">
    <section class="panel extras-title-card">
      ${renderMediaSlot({ src: title.image, alt: title.title, placeholderClass: "stage", title: title.title, body: "" })}
      <div class="extras-title-copy">
        <p class="eyebrow">おまけ</p><h1>${escapeHtml(title.title)}</h1>
        <p>${escapeHtml(title.description)}</p>
        <div class="footer-actions">
          <button class="primary-btn" data-action="start-extras">START</button>
          <button class="secondary-btn" data-action="back-gallery">ギャラリーへ</button>
        </div>
      </div>
    </section>
  </main>`;
}

function renderTitleRoster() {
  const heroines = Object.values(CONTENT.heroines ?? {});
  if (!heroines.length) return "";
  const names = heroines
    .map((heroine) => `<span class="roster-name roster-${escapeHtml(heroine.themeClass ?? "")}">${escapeHtml(heroine.name)}</span>`)
    .join(`<span class="roster-x" aria-hidden="true">×</span>`);
  return `
    <div class="corner-stripe" aria-hidden="true">
      ${heroines.map((heroine) => `<span class="corner-${escapeHtml(heroine.themeClass ?? "")}"></span>`).join("")}
    </div>
    <p class="title-roster">${names}</p>
  `;
}

function renderTitle() {
  const hasCampaignSave = Boolean(loadCampaignSave());
  app.innerHTML = `
    <main class="screen title-screen">
      <section class="panel title-card title-card-hero">
        <div class="title-visual-wrap title-visual-hero">
          ${TITLE_SCREEN.image ? `
            <img
              class="title-main-image"
              src="${assetUrl(TITLE_SCREEN.image)}"
              alt="${TITLE_SCREEN.imageAlt}"
              onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
            >
          ` : ""}
          <div class="title-placeholder pixel-title-placeholder" style="${TITLE_SCREEN.image ? "display:none;" : "display:grid;"}">
            <div>
              ${renderTitlePlaceholderArt()}
            </div>
          </div>
        </div>

        <div class="title-copy-block">
          <span class="eyebrow title-eyebrow">${TITLE_SCREEN.eyebrow}</span>
          <h1>${TITLE_SCREEN.title}</h1>
          <p class="title-subtitle">${TITLE_SCREEN.subtitle}</p>
          ${renderTitleRoster()}
          <p class="lead">${TITLE_SCREEN.lead}</p>
          <small class="game-version">v${escapeHtml(GAME_VERSION)}</small>
        </div>

        <div class="title-button-row" aria-label="タイトルメニュー">
          ${hasCampaignSave
            ? `<button class="primary-btn title-menu-button" data-action="continue-campaign">CONTINUE</button>
               <button class="secondary-btn title-menu-button" data-action="request-new-game">NEW GAME</button>`
            : `<button class="primary-btn title-menu-button" data-action="start-game">START</button>`}
          <button class="secondary-btn title-menu-button" data-action="open-gallery">
            GALLERY
          </button>
          <button class="secondary-btn title-menu-button" data-action="open-sound-settings">
            オプション
          </button>
          <button class="secondary-btn title-menu-button" data-action="open-dev-preview" ${DEV_PREVIEW_ENABLED ? "" : "hidden"}>
            DEV PREVIEW
          </button>
        </div>
      </section>
    </main>
  `;
}
function renderSoundSettings() {
  const audio = getAudioSettings();
  const fromTraining = state.soundReturnScreen === "game";
  const volume = Math.round(audio.volume * 100);
  const bgmVolume = Math.round(audio.bgmVolume * 100);
  app.innerHTML = `
    <main class="screen sound-settings-screen">
      <section class="panel sound-settings-card">
        <header class="sound-settings-header">
          <div>
            <p class="eyebrow">OPTIONS</p>
            <h2>オプション</h2>
          </div>
          <div class="sound-equalizer" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </header>
        <div class="sound-control-row language-control" role="group" aria-label="表示言語">
          <span class="sound-control-label">言語 / Language</span>
          <div class="language-buttons" data-no-i18n>
            <button class="secondary-btn" data-action="set-language" data-language="ja" aria-pressed="${getLanguage() === "ja"}">日本語</button>
            <button class="secondary-btn" data-action="set-language" data-language="en" aria-pressed="${getLanguage() === "en"}" ${englishAvailable() ? "" : "disabled"}>English</button>
          </div>
        </div>
        ${englishAvailable() ? "" : `<p role="status">英語データを読み込めませんでした。ページを再読み込みしてください。</p>`}
        <p class="lead">効果音と、タイトル・育成・試合のチップチューンBGMを個別に調整します。</p>
        <div class="sound-control-row">
          <div>
            <span class="sound-control-label">全音声</span>
            <strong class="sound-state">${audio.muted ? "MUTED" : "ON"}</strong>
          </div>
          <button
            class="secondary-btn sound-mute-button"
            data-action="toggle-audio"
            aria-pressed="${audio.muted}"
          >${audio.muted ? "ミュート解除" : "ミュート"}</button>
        </div>
        <label class="sound-volume-control" for="sound-volume">
          <span><span class="sound-control-label">効果音の音量</span><output data-audio-volume-output for="sound-volume">${volume}%</output></span>
          <input id="sound-volume" data-audio-volume type="range" min="0" max="100" step="1" value="${volume}" aria-label="効果音の音量">
        </label>
        <div class="sound-control-row">
          <div>
            <span class="sound-control-label">BGM</span>
            <strong class="sound-state">${audio.bgmMuted ? "MUTED" : "ON"}</strong>
          </div>
          <button
            class="secondary-btn sound-mute-button"
            data-action="toggle-bgm"
            aria-pressed="${audio.bgmMuted}"
          >${audio.bgmMuted ? "BGMミュート解除" : "BGMミュート"}</button>
        </div>
        <label class="sound-volume-control" for="bgm-volume">
          <span><span class="sound-control-label">BGMの音量</span><output data-bgm-volume-output for="bgm-volume">${bgmVolume}%</output></span>
          <input id="bgm-volume" data-bgm-volume type="range" min="0" max="100" step="1" value="${bgmVolume}" aria-label="BGMの音量">
        </label>
        ${fromTraining ? "" : `<section class="corner-reset-panel" aria-label="周回補助データ">
          <div>
            <span class="sound-control-label">周回補助</span>
            <p>ヒロイン×対戦相手ごとの外枠マーカーだけを初期化できます。</p>
          </div>
          ${state.cornerResetPending
            ? `<div class="corner-reset-actions">
                 <button class="secondary-btn" data-action="cancel-reset-corner-progress">戻る</button>
                 <button class="primary-btn" data-action="confirm-reset-corner-progress">初期化する</button>
               </div>`
            : `<button class="secondary-btn" data-action="request-reset-corner-progress">周回補助を初期化</button>`}
          ${state.cornerResetDone ? `<span class="corner-reset-done" role="status">周回補助を初期化しました。</span>` : ""}
        </section>`}
        <div class="sound-settings-note">設定はこのブラウザに保存されます。音声を再生できない環境でもゲーム進行には影響しません。</div>
        <div class="footer-actions">
          <button class="back-btn" data-action="${fromTraining ? "close-sound-settings" : "back-title"}">${fromTraining ? (state.currentStage?.mode === "hidden" ? "ゲームに戻る" : "育成に戻る") : "タイトルへ戻る"}</button>
        </div>
      </section>
    </main>
  `;
}


function renderDeveloperPreview() {
  const heroineId = PLAYABLE_HEROINE_IDS[0];
  const heroine = CONTENT.heroines[heroineId];
  const rounds = [...(CONTENT.campaign.rounds ?? []), CONTENT.campaign.hiddenRound].filter(Boolean);
  const thresholdConfig = CONTENT.campaign.thresholdDisplay ?? {};
  const thresholdMode = thresholdConfig.debug ?? "all";
  const thresholdKeys = thresholdConfig.modes?.[thresholdMode] ?? ["win", "ko"];
  const thresholdLabels = { win: "勝利ライン", ko: "KOライン" };
  const roundCards = rounds.map((round, index) => {
    const opponent = resolveCampaignOpponent(heroineId, round);
    const resultTexts = Object.fromEntries(
      Object.entries(opponent.resultTexts ?? {}).map(([key, value]) => [key, applyHeroineName(value, heroine)]),
    );
    return `
      <article class="dev-preview-stage">
        <h3>${round.id === CONTENT.campaign.hiddenRound?.id ? "Hidden" : `Stage ${index + 1}`}: ${escapeHtml(round.label)} / vs ${escapeHtml(opponent.name)}</h3>
        <p><strong>育成期間:</strong> ${round.trainingTurns}週間（1コマンド＝1週）</p>
        <p><strong>開始:</strong> ${escapeHtml((opponent.preFight ?? []).map((line) => `${line.speaker}: ${line.text}`).join(" / "))}</p>
        <p><strong>KO:</strong> ${escapeHtml(resultTexts.ko ?? "未設定")}</p>
        <p><strong>勝利:</strong> ${escapeHtml(resultTexts.win ?? "未設定")}</p>
        <p><strong>引き分け:</strong> ${escapeHtml(resultTexts.draw ?? "未設定")}</p>
        <p><strong>敗北:</strong> ${escapeHtml(resultTexts.lose ?? "未設定")}</p>
        ${thresholdKeys.map((key) => `<p><strong>${thresholdLabels[key] ?? escapeHtml(key)}:</strong> ${(opponent.alwaysKnockout && key === "ko" ? opponent.thresholds?.win : opponent.thresholds?.[key]) ?? "未設定"}以上</p>`).join("")}
      </article>
    `;
  }).join("");
  const campaignGalleryItems = getGalleryItems().filter((item) => item.stageId === "campaign");
  const galleryInspector = campaignGalleryItems.map((item) => `
    <p>
      <strong>${escapeHtml(item.title)}:</strong> ${item.unlocked ? "解放済み" : "未解放"}
      <code>${escapeHtml(item.id)}</code>
      <button class="secondary-btn" data-action="debug-unlock-gallery" data-gallery-id="${escapeHtml(item.id)}" data-ending-id="${escapeHtml(item.endingId)}" ${item.unlocked ? "disabled" : ""}>テスト解放</button>
    </p>
  `).join("");

  app.innerHTML = `
    <main class="screen">
      <section class="panel dev-preview-card">
        <p class="eyebrow">DEVELOPER DATA PREVIEW</p>
        <h2>現在読み込まれているMVPデータ</h2>
        <p class="hint">表示内容は content/*.json から読み込まれています。</p>
        <article class="dev-preview-stage">
          <h3>Player: ${escapeHtml(heroine.name)}</h3>
          <p>${escapeHtml(heroine.copy)}</p>
          <p><strong>仮戦闘値:</strong> ${escapeHtml(getCombatProfileLabel({ profile: heroine.profile }))}</p>
          <p><strong>初期育成値:</strong> ${escapeHtml(JSON.stringify(heroine.initialStats))}</p>
        </article>
        <div class="dev-preview-grid">${roundCards}</div>
        <article class="dev-preview-stage">
          <h3>キャンペーンギャラリー解放状況</h3>
          ${galleryInspector}
        </article>
        <details>
          <summary>読み込み済みJSON概要</summary>
          <pre>${escapeHtml(JSON.stringify({ heroine, campaign: CONTENT.campaign, opponents: CONTENT.opponents }, null, 2))}</pre>
        </details>
        <div class="footer-actions"><button class="back-btn" data-action="back-title">タイトルへ戻る</button></div>
      </section>
    </main>
  `;
}

function renderConversation() {
  const stage = state.currentStage;
  const line = stage.introLines[state.conversationIndex];
  app.innerHTML = `
    <main class="screen">
      <section class="conversation-layout">
        <div class="panel art-card">
          ${renderMediaSlot({
            src: stage.assets.intro,
            alt: `${stage.name} 導入イラスト`,
            placeholderClass: "stage",
            title: "導入イラスト プレースホルダー",
            
          })}
        </div>
        <div class="panel dialog-card">
          <p class="eyebrow">${escapeHtml(stage.name)}</p>
          <h2>導入会話</h2>
          <div class="dialog-text"><strong>${line.speaker}</strong>\n${line.text}</div>
          <div class="footer-actions">
            <span class="hint">${state.conversationIndex + 1} / ${stage.introLines.length} タップまたはクリックで進行</span>
            <div class="stack">
              <button class="back-btn" data-action="back-title">タイトルへ</button>
              <button class="secondary-btn" data-action="skip-opening">スキップ</button>
              <button class="primary-btn" data-action="next-line">次へ</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderCharacterSelect() {
  const selectedCharacter = getSelectedTrainingCharacter();
  const characterButtons = TRAINING_CHARACTERS.map((character) => `
    <button
      class="character-select-button ${character.id === selectedCharacter.id ? "is-selected" : ""}"
      data-action="select-training-character"
      data-character-id="${character.id}"
      aria-pressed="${character.id === selectedCharacter.id}"
    >
      ${pixelActorMarkup(character.id)}
      <strong>${escapeHtml(character.name)}</strong>
      <span>${escapeHtml(character.type)} / 得意: ${escapeHtml(getSpecialtyName(character.id))}</span>
    </button>
  `).join("");

  app.innerHTML = `
    <main class="screen character-select-screen theme-${escapeHtml(selectedCharacter.themeClass)}">
      <section class="character-select-layout">
        <article class="character-stage-panel">
          <div class="single-character-stage">
            <div class="single-stage-grid"></div>
            <div class="single-ring-lines" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
            <div class="single-character-spotlight">
              ${renderTrainingCharacterFigure({ ...selectedCharacter, portrait: CONTENT.campaign.characterSelection?.[selectedCharacter.id]?.image || selectedCharacter.portrait }, "large")}
            </div>
          </div>
        </article>

        <aside class="character-info-panel">
          <p class="eyebrow title-eyebrow">SELECT BOXER</p>
          <h2>${escapeHtml(selectedCharacter.name)}</h2>
          <p class="character-type">${escapeHtml(selectedCharacter.type)}タイプ</p>
          <p class="character-copy">${escapeHtml(selectedCharacter.copy)}</p>
          <div class="character-stat-line">${escapeHtml(getTrainingStatsLabel(selectedCharacter.id))}</div>
          <div class="character-button-list">
            ${characterButtons}
          </div>
          ${canOfferReadSkip() ? `
            <label class="read-skip-option">
              <input type="checkbox" data-read-skip ${state.readSkipChoice ? "checked" : ""}>
              <span>既読の会話を飛ばす<small>見たことのない会話は表示します</small></span>
            </label>
          ` : ""}
          ${CONTENT.campaign.yukitoGuide && canUseYukitoGuide() ? `<label class="read-skip-option yukito-option">
            <input type="checkbox" data-yukito-guide ${state.yukitoGuideChoice ? "checked" : ""}>
            ${yukitoIconMarkup()}<span>${escapeHtml(CONTENT.campaign.yukitoGuide.title)}<small>${escapeHtml(CONTENT.campaign.yukitoGuide.description)}</small>${state.yukitoGuideChoice ? `<small class="yukito-marker-message" role="status">${escapeHtml(CONTENT.campaign.yukitoGuide.markerMessage)}</small>` : ""}</span>
          </label>` : ""}
          <div class="footer-actions character-select-actions">
            <button class="back-btn" data-action="back-title">タイトルへ</button>
            <button class="primary-btn title-menu-button" data-action="confirm-training-character">このボクサーで始める</button>
          </div>
        </aside>
      </section>
    </main>
  `;
}

function renderVerticalGauge(label, value, max, className, align = "left") {
  const fillPercent = (value / max) * 100;
  return `
    <div class="vertical-gauge ${align}">
      <div class="vertical-gauge-track ${className}">
        <span style="height: ${fillPercent}%"></span>
      </div>
      <div class="vertical-gauge-meta">
        <span class="vertical-gauge-label">${label}</span>
        <span class="vertical-gauge-value">${value}/${max}</span>
      </div>
    </div>
  `;
}

function renderPopDisplay({ areaClass, title, body, src, alt }) {
  const animationClass = state.pendingCommandId ? " pop-animate" : "";

  if (src) {
    return `
      <div class="pop-display ${areaClass}">
        <span class="pop-title">${title}</span>
        <img
          class="pop-image breathe-anim${animationClass}"
          src="${assetUrl(src)}"
          alt="${escapeHtml(alt || title)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
        >
        <div class="pop-placeholder breathe-anim ${areaClass}${animationClass}" style="display:none;">
          <strong>${escapeHtml(title)}</strong>
          <span>${body}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="pop-display ${areaClass}">
      <span class="pop-title">${title}</span>
      <div class="pop-placeholder breathe-anim ${areaClass}${animationClass}">
        <strong>${escapeHtml(title)}</strong>
        <span>${body}</span>
      </div>
    </div>
  `;
}

function renderConversationLines(lines) {
  return lines
    .map((line) => `<div><strong>${escapeHtml(line.speaker)}</strong>: ${escapeHtml(line.text)}</div>`)
    .join("");
}

function getPendingCommand() {
  return COMMANDS.find((command) => command.id === state.pendingCommandId) ?? null;
}

function getPreviewLines(stage, pendingCommand) {
  if (pendingCommand) {
    return pendingCommand.responseLines;
  }
  return stage.uiText.gameScreen.defaultConversation;
}

function getPopBodies(stage, pendingCommand) {
  if (pendingCommand?.preview) {
    return {
      player: pendingCommand.preview.playerPop,
      rival: pendingCommand.preview.rivalPop,
    };
  }

  return {
    player: stage.uiText.gameScreen.defaultPops.player,
    rival: stage.uiText.gameScreen.defaultPops.rival,
  };
}

function getPopImageSources(stage, pendingCommand) {
  const key = pendingCommand?.id ?? "idle";
  return {
    player: stage.assets.playerPops?.[key] ?? "",
    rival: stage.assets.rivalPops?.[key] ?? "",
  };
}

function getStageLabel(stage) {
  return stage.name.split(":")[0];
}

function renderGame() {
  const stage = state.currentStage;
  const { stats, turn, maxTurn, log, flags } = state.game;
  const pendingCommand = getPendingCommand();
  const ui = stage.uiText.gameScreen;
  const previewLines = getPreviewLines(stage, pendingCommand);
  const popBodies = getPopBodies(stage, pendingCommand);
  const popImages = getPopImageSources(stage, pendingCommand);

  const commandControls = pendingCommand
    ? `
      <div class="confirm-actions">
        <button class="secondary-btn preview-action-btn preview-action-back" data-action="cancel-command">${ui.actions.back || "戻る"}</button>
        <button class="primary-btn preview-action-btn preview-action-confirm" data-action="confirm-command">${ui.actions.confirm || "決定"}</button>
      </div>
    `
    : `
      <div class="command-palette">
        ${getStageCommands(stage).map((command) => {
          const commandState = getCommandState(command, state.game);

          let icon = "";
          let idClass = "";
          if (command.id === "cheer") { icon = "📣"; idClass = "cmd-cheer"; }
          else if (command.id === "love") { icon = "🫂"; idClass = "cmd-love"; }
          else if (command.id === "rest") { icon = "☕"; idClass = "cmd-rest"; }
          else if (command.id === "gift") { icon = "🎁"; idClass = "cmd-gift"; }

          return `
            <button
              class="command-tile ${idClass}"
              data-command="${command.id}"
              ${commandState.disabled ? "disabled" : ""}
              title="${escapeHtml(commandState.reason || command.description)}"
            >
              <strong><span aria-hidden="true">${icon}</span> ${command.name}</strong>
              <span>${command.description}</span>
            </button>
          `;
        }).join("")}
      </div>
    `;

  app.innerHTML = `
    <main class="screen game-screen">
      <section class="game-layout duel-layout">
        <div class="panel topbar duel-topbar">
          <div class="duel-topbar-stage">${getStageLabel(stage)}</div>
          <div class="duel-topbar-turn">ターン ${turn} / ${maxTurn}</div>
          <button class="secondary-btn" data-action="open-sound-settings">設定</button>
        </div>

        <section class="duel-board">
          <article class="duel-side duel-side-player panel">
            <div class="duel-side-background">
              <img
                class="duel-side-background-image"
                  src="${assetUrl(stage.assets.leftBackground ?? "")}"
                alt="優エリア背景"
                onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
              >
              <div class="duel-side-background-fallback" style="display:none;">
                <strong>優エリア背景プレースホルダー</strong>
                <span>left.png 未配置時の仮表示です。</span>
              </div>
            </div>
            <div class="side-inner">
              <aside class="side-gauges side-gauges-left">
                ${renderVerticalGauge("体力", stats.playerHealth, 5, "gauge-health", "left")}
                ${renderVerticalGauge("気力", stats.playerSpirit, 5, "gauge-spirit", "left")}
              </aside>
              <div class="side-core">
                <div class="pop-frame">
                  <div class="pop-caption">${ui.labels.playerPop}</div>
                  ${renderPopDisplay({
                    areaClass: "hero",
                    title: ui.labels.playerPop,
                    body: popBodies.player,
                    src: popImages.player,
                    alt: "優君ポップ",
                  })}
                </div>
              </div>
            </div>
          </article>

          <article class="duel-side duel-side-rival panel">
            <div class="duel-side-background">
              <img
                class="duel-side-background-image"
                  src="${assetUrl(stage.assets.rightBackground ?? "")}"
                alt="瑞花エリア背景"
                onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
              >
              <div class="duel-side-background-fallback" style="display:none;">
                <strong>瑞花エリア背景プレースホルダー</strong>
                <span>right.png 未配置時の仮表示です。</span>
              </div>
            </div>
            <div class="side-inner rival">
              <div class="side-core">
                <div class="pop-frame">
                  <div class="pop-caption">${ui.labels.rivalPop}</div>
                  ${renderPopDisplay({
                    areaClass: "rival",
                    title: ui.labels.rivalPop,
                    body: popBodies.rival,
                    src: popImages.rival,
                    alt: "瑞花ポップ",
                  })}
                </div>
              </div>
              <aside class="side-gauges side-gauges-right">
                ${renderVerticalGauge("やる気", stats.rivalMotivation, 10, "gauge-motivation", "right")}
                ${renderVerticalGauge("愛", stats.rivalLove, 10, "gauge-love", "right")}
              </aside>
            </div>
          </article>
        </section>

        <article class="panel dialogue-dock">
          <div class="dialogue-header">
            <div>
              <p class="eyebrow">${pendingCommand ? ui.labels.commandConfirm : ui.labels.commandSelect}</p>
              <h3>${ui.labels.talkBox}</h3>
            </div>
            <div class="hint">${pendingCommand ? escapeHtml(pendingCommand.name) : log}</div>
          </div>
          <div class="dialogue-body">
            ${renderConversationLines(previewLines)}
          </div>
          <div class="dialogue-actions">
            ${commandControls}
          </div>
        </article>
      </section>
    </main>
  `;
}

function renderCornerMarker(kind, marker) {
  if (!marker || marker.value === null || (marker.value === 0 && marker.achieved)) return "";
  return '<i class="training-stat-corner-marker is-' + kind + '" data-corner-marker="' + kind + '" style="--corner-marker-left:' + marker.value + '%" aria-hidden="true"></i>';
}
function renderStatTarget(kind, target) {
  if (!target) return "";
  const label = kind === "win" ? "赤・勝利" : "青・KO";
  const value = target.value === null ? "他の能力も必要"
    : target.value === 0 && target.achieved ? "達成済み（ほかの能力で条件クリア）"
    : `${target.value}${target.achieved ? "（達成）" : ""}`;
  return `<span class="training-stat-target is-${kind}" data-stat-target="${kind}">${label} ${value}</span>`;
}
function renderStatBar(label, value, max, className, cornerMarkers = {}) {
  const markerLabel = ["win", "ko"].filter(kind => cornerMarkers[kind]).map(kind => {
    const target = cornerMarkers[kind];
    const value = target.value === 0 && target.achieved ? "達成済み（ほかの能力で条件クリア）" : target.value ?? "他の能力も必要";
    return `。${kind === "win" ? "判定勝ち以上" : "KO勝ち"}の目標：${value}`;
  }).join("");
  const cellCount = 10;
  const normalizedValue = Math.max(0, Math.min(cellCount, (value / max) * cellCount));
  const filledCells = Math.floor(normalizedValue);
  const hasHalfCell = normalizedValue > filledCells;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const fillClass = index < filledCells
      ? " is-filled"
      : index === filledCells && hasHalfCell
        ? " is-half"
        : "";
    return `<span class="training-stat-cell${fillClass}" aria-hidden="true"></span>`;
  }).join("");

  return `
    <div class="training-stat-row ${className}">
      <span class="training-stat-label">${label}</span>
      <span class="training-stat-cells" role="meter" aria-label="${label}${markerLabel}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}">
        ${cells}
        ${renderCornerMarker("win", cornerMarkers.win)}
        ${renderCornerMarker("ko", cornerMarkers.ko)}
      </span>
      <span class="training-stat-value">${value}</span>
      ${cornerMarkers.win || cornerMarkers.ko ? `<small class="training-stat-targets">${renderStatTarget("win", cornerMarkers.win)}${renderStatTarget("ko", cornerMarkers.ko)}</small>` : ""}
    </div>
  `;
}

function getMoveRenderState(heroine, stats) {
  const acquiredMoves = currentAcquiredMoves(heroine, stats);
  const previousIds = state.campaign ? acquiredMoveRenderSnapshots.get(state.campaign) : null;
  const newlyAcquiredIds = previousIds
    ? new Set(acquiredMoves.filter((move) => !previousIds.has(move.id)).map((move) => move.id))
    : new Set();

  if (state.campaign) {
    acquiredMoveRenderSnapshots.set(state.campaign, new Set(acquiredMoves.map((move) => move.id)));
  }
  return { acquiredMoves, newlyAcquiredIds };
}

function renderMoveEntry(move, isNewlyAcquired) {
  const scoreBonus = Number(move.scoreBonus) || 0;
  return `
    <div class="training-move-row${isNewlyAcquired ? " is-newly-acquired" : ""}">
      <span class="training-move-reveal">
        <span class="training-move-label">技:</span>
        <span class="training-move-name">${escapeHtml(move.name)}</span>
        <span class="training-move-bonus">${scoreBonus >= 0 ? "+" : ""}${scoreBonus}</span>
      </span>
      <span class="training-move-stamp" aria-label="新しく習得">NEW</span>
    </div>
  `;
}

function renderTrainingStats(heroine, stats, newlyAcquiredIds, opponent) {
  const statRows = [
    ["pow", "パワー"],
    ["spd", "スピード"],
    ["sta", "スタミナ"],
    ["tec", "テクニック"],
    ["cond", "コンディション"],
  ];
  const acquiredMoves = currentAcquiredMoves(heroine, stats);

  const heroineId = state.campaign?.heroineId;
  const opponentId = opponent?.id ?? state.currentStage?.campaignRound?.opponentId;
  const progress = heroineId && opponentId ? getCornerProgress(heroineId, opponentId) : null;
  const statMarkup = statRows.map(([stat, label]) => {
    const win = progress?.winMarkers.some(marker => marker.stat === stat);
    const ko = progress?.koMarkers.some(marker => marker.stat === stat);
    const targets = win || ko ? getTrainingStatTargets(stats, stat, opponent, heroine, state.campaign,
      state.currentStage.statLimits[stat].max) : null;
    return renderStatBar(label, stats[stat], 100, "training-stat-" + stat, {
      win: win ? targets.win : null,
      ko: ko ? targets.ko : null,
    });
  }).join("");

  // 必殺技はステータスのグラフと混ざらないよう、独立した囲み枠で表示する
  const movesMarkup = acquiredMoves.length
    ? `
      <div class="training-moves-box">
        <span class="training-moves-title">必殺技</span>
        ${acquiredMoves.map((move) => renderMoveEntry(move, newlyAcquiredIds.has(move.id))).join("")}
        <span class="training-moves-note">試合スコアに加算</span>
      </div>
    `
    : "";

  const hasMarkers = progress && (progress.winMarks || progress.koMarks);
  const markerNote = hasMarkers ? `<p class="training-marker-note">赤＝判定勝ち以上、青＝KO勝ちの目標です。ほかの能力を今の値に固定し、この能力だけを伸ばす場合の目安です。
    <small>${opponent?.alwaysKnockout
      ? "この試合は必ずKO決着なので、同じ能力の赤と青は同じ位置です。"
      : "練習や技の習得で目標位置も更新されます。複数の能力を組み合わせて伸ばしても勝利を目指せます。"}</small></p>` : "";
  return statMarkup + markerNote + movesMarkup;
}

const TRAINING_STAT_NAMES = { pow: "パワー", spd: "スピード", sta: "スタミナ", tec: "テクニック", cond: "コンディション" };

function trainingChangeLabel(before, after, keys = Object.keys(TRAINING_STAT_NAMES)) {
  return keys.filter((key) => after[key] !== before[key]).map((key) => {
    const delta = after[key] - before[key];
    return TRAINING_STAT_NAMES[key] + (delta > 0 ? " +" : " ") + delta;
  }).join(" / ") || "変化なし（上限）";
}

function renderTrainingRules(stage, stats) {
  const training = stage.training;
  const low = stats[training.condKey] < training.condPenaltyThreshold;
  return `<details class="training-rules"${low ? " open" : ""}>
    <summary>${low ? "疲労中：練習・休養のプラス効果が半減" : "練習と試合のルール"}</summary>
    <p>得意練習の伸びは${training.specialtyMultiplier}倍。開始時のコンディションが${training.condPenaltyThreshold}未満だと、休養を含むプラス効果が半減します。0になった次の練習は休養のみです（試合終了時を除く）。</p>
    <p>試合はパワー・スピード・スタミナ・テクニックと必殺技で判定。コンディションは練習の効率に影響し、試合での減点はありません。スタミナ40未満では終盤に失速します。</p>
    ${stage.opponent?.alwaysKnockout ? "<p>この試合は必ずKO決着。勝利目安に届けばKO勝ち、届かなければKO負けです。</p>" : ""}
  </details>`;
}

function renderTrainingReview(stage, stats, heroine) {
  const forecast = getTrainingMatchForecast(stats, stage.opponent, heroine, state.campaign);
  const growth = trainingChangeLabel(heroine.initialStats, stats, ["pow", "spd", "sta", "tec"]);
  const moves = currentAcquiredMoves(heroine, stats);
  const fade = Math.max(0, (40 - stats.sta) * 0.5);
  return `<details class="training-result-review"${["lose", "draw"].includes(state.game.ending.id) ? " open" : ""}>
    <summary>育成の振り返り</summary>
    <p>ここまでの成長：${escapeHtml(growth)}</p>
    <p>試合スコア ${formatMatchScore(forecast.baseScore)} ／ 勝利目安 ${forecast.thresholds.win}（乱数なし）</p>
    <p>${fade > 0 ? `スタミナ不足による失速 −${fade.toFixed(1)}。40まで伸ばすと解消します。` : "スタミナ40以上：終盤の失速なし。"}</p>
    ${moves.length ? `<p>${escapeHtml(moves.map(m => m.name).join("・"))}：試合スコア +${forecast.scoreBonus}${stage.opponent?.alwaysKnockout ? "。この試合は勝利ラインでKO決着。" : `、KO判定にはさらに +${forecast.koBonus}。`}</p>` : ""}
  </details>`;
}

const MATCH_FORECAST_LABELS = {
  "ko-likely": "KO圏内",
  "win-likely": "勝利圏内",
  "draw-possible": "引き分け圏内",
  "loss-likely": "判定負け圏内",
  "ko-loss": "KO負け圏内",
};

function renderMatchForecast(stats, opponent, heroine) {
  if (!opponent) return "";
  const forecast = getTrainingMatchForecast(stats, opponent, heroine, state.campaign);
  const score = formatMatchScore(forecast.baseScore);
  return `
    <div class="campaign-match-forecast">
      <span>勝利目安 <strong>${forecast.thresholds.win}</strong></span>
      <span>スコア <strong>${score}</strong></span>
      <b>${escapeHtml(MATCH_FORECAST_LABELS[forecast.prediction] ?? forecast.prediction)}</b>
      <small>同じ能力・補助記録なら同じ結果</small>
    </div>
  `;
}

function renderYukitoGuide(pendingCommand) {
  const config = CONTENT.campaign.yukitoGuide;
  if (!config || !state.campaign || !canUseYukitoGuide()) return "";
  const enabled = state.campaign.yukitoGuide?.enabled === true;
  const progress = getYukitoGuideStatus(config, state.campaign, state.game);
  const deviating = enabled && progress.status === "on-route" && pendingCommand && pendingCommand.id !== progress.commandId;
  const recommended = COMMANDS.find(item => item.id === progress.commandId);
  const message = progress.status === "on-route" ? `${config.onRoute} 第${progress.week}週：${recommended?.name ?? ""}`
    : progress.status === "unverified" ? config.unverified : progress.status === "complete" ? "保証ルートの練習を完了したよ！" : config.outside;
  return `<aside class="yukito-guide${enabled && (deviating || progress.status !== "on-route") ? " is-warning" : ""}" data-yukito-status="${escapeHtml(progress.status)}">
    <label><input type="checkbox" data-yukito-guide ${enabled ? "checked" : ""}>${yukitoIconMarkup()}<span>${escapeHtml(config.title)}</span></label>
    ${enabled ? `<div class="yukito-guide-message" aria-live="polite">
      <small class="yukito-marker-message">${escapeHtml(config.markerMessage)}</small>
      <strong data-yukito-recommendation="${progress.status === "on-route" ? escapeHtml(progress.commandId) : ""}">${escapeHtml(message)}</strong>
      ${progress.status === "on-route" ? `<small>${escapeHtml(config.guarantee)} 王者戦後は挑戦状を受けてね。</small>` : ""}
      ${deviating ? `<p class="yukito-deviation" role="alert">${escapeHtml(config.deviationWarning)}</p>` : ""}
    </div>` : ""}
  </aside>`;
}

function renderTrainingGame() {
  const stage = state.currentStage;
  const character = getSelectedTrainingCharacter();
  const opponent = stage.opponent;
  const { stats, turn, maxTurn, log } = state.game;
  const heroine = CONTENT.heroines[character.id];
  const { newlyAcquiredIds } = getMoveRenderState(heroine, stats);
  const pendingCommand = getPendingCommand();
  const commands = getStageCommands(stage);
  const schedule = CONTENT.campaign.schedule ?? {};
  const maxFights = schedule.maxFights ?? 4;
  const weeksPerFight = schedule.weeksPerFight ?? maxTurn;
  const weekNumber = (state.campaign?.weeksElapsed ?? 0) + turn;
  const maxWeeks = maxFights * weeksPerFight;
  const fightNumber = state.campaign?.fightCount ?? 1;
  const forecastMarkup = renderMatchForecast(stats, opponent, heroine);
  const previewStats = pendingCommand ? previewCommandStats(stage, state.game, pendingCommand) : null;
  const previewProgress = previewEventProgress(heroine, state.game, state.campaign?.currentRoundId, state.campaign);
  const previewForecast = previewStats ? getTrainingMatchForecast(previewStats, opponent, heroine, previewProgress) : null;

  const commandIcons = {
    sandbag: "BAG",
    roadwork: "ROAD",
    sparring: "SPAR",
    recover: "REST",
  };

  const commandControls = pendingCommand
    ? `
      <div class="confirm-actions">
        <button class="secondary-btn preview-action-btn" data-action="cancel-command">戻る</button>
        <button class="primary-btn preview-action-btn" data-action="confirm-command">決定</button>
      </div>
    `
    : `
      <div class="command-palette training-command-palette">
        ${commands.map((command) => {
          const commandState = getCommandState(command, state.game);
          const icon = commandIcons[command.id] ?? "•";
          return `
            <button
              class="command-tile cmd-${command.id}"
              data-command="${command.id}"
              ${commandState.disabled ? "disabled" : ""}
              title="${escapeHtml(commandState.reason || command.description)}"
            >
              <strong><span class="training-command-code" aria-hidden="true">${icon}</span><span class="training-command-name">${escapeHtml(command.name)}</span></strong>
              <span>${escapeHtml(command.description)}</span>
              <small class="training-command-effect">${escapeHtml(commandState.disabled ? commandState.reason : trainingChangeLabel(stats, previewCommandStats(stage, state.game, command)))}</small>
              ${command.id === stage.training.specialtyCommandId ? '<small class="training-specialty">得意練習 ×1.5</small>' : ""}
            </button>
          `;
        }).join("")}
      </div>
    `;

  const dockHint = pendingCommand
    ? escapeHtml(trainingChangeLabel(stats, previewStats)) + "<br>行動・会話後のスコア " + formatMatchScore(previewForecast.baseScore)
      + (getAcquiredMoves(heroine, previewStats, previewProgress).length > currentAcquiredMoves(heroine, stats).length ? "<br>この行動・会話で必殺技を習得" : "")
    : escapeHtml(log);

  app.innerHTML = `
    <main class="screen training-game-screen theme-${escapeHtml(character.themeClass)}">
      <section class="training-layout">
        <div class="panel topbar training-topbar">
          <div class="duel-topbar-stage">${escapeHtml(stage.campaignRound?.label ?? character.name)}${opponent ? ` / vs ${escapeHtml(opponent.name)}` : ""}</div>
          <div class="training-topbar-actions">
            <div class="duel-topbar-turn">第${weekNumber}週 / 試合 ${fightNumber}/${maxFights}</div>
            <button class="secondary-btn training-sound-button" data-action="open-sound-settings" aria-label="育成中のオプション">設定</button>
          </div>
        </div>

        <section class="training-board">
          <article class="panel training-figure-panel">
            <div class="training-figure-stage">
              <div class="single-stage-grid"></div>
              ${renderTrainingCharacterFigure(character, "", true)}
            </div>
          </article>

          <article class="training-stats-panel" aria-label="${escapeHtml(character.name)}の育成記録紙">
            <header class="training-stats-header">
              <h3 class="training-stats-title">育成記録 — ${escapeHtml(character.name)}</h3>
              <span class="training-stats-day">WEEK ${weekNumber}/${maxWeeks} · 試合内 ${turn}/${maxTurn}</span>
            </header>
            ${opponent ? `
              <div class="campaign-opponent-card">
                <img src="${assetUrl(opponent.portrait)}" alt="${escapeHtml(opponent.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">
                <div class="campaign-opponent-placeholder" style="display:none;">VS</div>
                <div>
                  <span>NEXT OPPONENT</span><strong>${escapeHtml(opponent.name)}</strong>
                  ${forecastMarkup}
                </div>
              </div>
            ` : ""}
            ${renderTrainingStats(heroine, stats, newlyAcquiredIds, opponent)}
            ${renderTrainingRules(stage, stats)}
          </article>
        </section>

        <article class="panel dialogue-dock">
          <div class="dialogue-header">
            <div>
              <p class="eyebrow">${pendingCommand ? "この練習で進める？" : "練習を選ぶ"}</p>
              <h3>${pendingCommand ? escapeHtml(pendingCommand.name) : "トレーニング"}</h3>
            </div>
            <div class="hint">${dockHint}</div>
          </div>
          ${renderYukitoGuide(pendingCommand)}
          <div class="dialogue-actions">
            ${commandControls}
          </div>
        </article>
      </section>
    </main>
  `;
}

function getTrainingStatChanges(prevStats, nextStats) {
  return Object.entries(TRAINING_STAT_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      amount: (nextStats[key] ?? 0) - (prevStats[key] ?? 0),
    }))
    .filter((change) => change.amount !== 0);
}

// 練習直後に記録紙の該当行へ目を向けさせる。伸びたセルを塗り、増加値を行の右端に短く残す。
const TRAINING_STAT_HIGHLIGHT_MS = 1800;
const TRAINING_STAT_BAR_MAX = 100;
const TRAINING_STAT_BAR_CELLS = 10;
function highlightTrainingStatRows(prevStats, nextStats, changes) {
  const panel = app.querySelector(".training-stats-panel");
  if (!panel) return;
  const toCells = (value) => Math.max(0, Math.min(TRAINING_STAT_BAR_CELLS, ((value ?? 0) / TRAINING_STAT_BAR_MAX) * TRAINING_STAT_BAR_CELLS));
  for (const { key, amount } of changes) {
    const row = panel.querySelector(`.training-stat-row.training-stat-${key}`);
    if (!row) continue;
    row.classList.add(amount > 0 ? "is-grown" : "is-dropped");
    const gained = [];
    if (amount > 0) {
      const from = Math.floor(toCells(prevStats[key]));
      const to = Math.ceil(toCells(nextStats[key]));
      row.querySelectorAll(".training-stat-cell").forEach((cell, index) => {
        if (index >= from && index < to) { cell.classList.add("is-gained"); gained.push(cell); }
      });
    }
    const delta = document.createElement("span");
    delta.className = `training-stat-delta ${amount > 0 ? "is-positive" : "is-negative"}`;
    delta.setAttribute("aria-hidden", "true");
    delta.textContent = `${amount > 0 ? "+" : ""}${amount}`;
    row.appendChild(delta);
    setTimeout(() => {
      row.classList.remove("is-grown", "is-dropped");
      gained.forEach((cell) => cell.classList.remove("is-gained"));
      delta.remove();
    }, TRAINING_STAT_HIGHLIGHT_MS);
  }
}

function queueMoveAnnouncements(moves) {
  if (!state.campaign) return;
  const campaign = state.campaign;
  campaign.announcedMoveIds ??= [];
  campaign.pendingMoveIds ??= [];
  for (const move of moves) if (!campaign.announcedMoveIds.includes(move.id) && !campaign.pendingMoveIds.includes(move.id)) campaign.pendingMoveIds.push(move.id);
}

function renderMoveAnnouncement() {
  const campaign = state.campaign;
  if (!campaign || !["game", "ending"].includes(state.screen)) return;
  const moves = (CONTENT.heroines[campaign.heroineId]?.moves ?? []).filter(move => campaign.pendingMoveIds?.includes(move.id));
  if (moves.length) {
    campaign.pendingMoveIds = [];
    campaign.announcedMoveIds = [...new Set([...(campaign.announcedMoveIds ?? []), ...moves.map(move => move.id)])];
    activeMoveAnnouncement = { campaign, names: moves.map(move => move.name), until: Date.now() + 3000 };
    playSfx("unlock");
    if (!isFinalCampaignOutcome(campaign.outcome)) persistCampaignSave(state.screen);
  }
  const announcement = activeMoveAnnouncement;
  if (!announcement || announcement.campaign !== campaign || announcement.until <= Date.now()) return;
  app.querySelector(".move-acquisition-telop")?.remove();
  const banner = document.createElement("div");
  banner.className = "move-acquisition-telop";
  banner.setAttribute("role", "status");
  banner.innerHTML = announcement.names.map(name => `<strong>${escapeHtml((CONTENT.campaign.trainingUiText.moveAcquired ?? "必殺技：{moveName} 取得").replace("{moveName}", name))}</strong>`).join("");
  app.appendChild(banner);
  clearTimeout(moveAnnouncementTimer);
  moveAnnouncementTimer = setTimeout(() => { banner.remove(); activeMoveAnnouncement = null; }, Math.max(0, announcement.until - Date.now()));
}

function showTrainingStatChanges(prevStats, nextStats, previousProgress = state.campaign) {
  const changes = getTrainingStatChanges(prevStats, nextStats);
  highlightTrainingStatRows(prevStats, nextStats, changes);
  const heroine = CONTENT.heroines[state.selectedTrainingCharacterId];
  const previousMoveIds = new Set(getAcquiredMoves(heroine, prevStats, previousProgress).map((move) => move.id));
  const newlyAcquiredMoves = currentAcquiredMoves(heroine, nextStats)
    .filter((move) => !previousMoveIds.has(move.id));
  queueMoveAnnouncements(newlyAcquiredMoves);
  renderMoveAnnouncement();
  if (state.campaign && !isFinalCampaignOutcome(state.campaign.outcome)) persistCampaignSave(state.screen === "campaign-battle" ? "ending" : state.screen);
  if (!changes.length) return;

  app.querySelector(".training-stat-change-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "training-stat-change-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.innerHTML = `
    <strong>TRAINING RESULT</strong>
    <div class="training-stat-change-list">
      ${changes.map(({ label, amount }) => `
        <span class="${amount > 0 ? "is-positive" : "is-negative"}">
          ${label} ${amount > 0 ? "+" : ""}${amount}
        </span>
      `).join("")}
    </div>
  `;
  app.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 180);
  }, 2500);
}

function gyaruSparringPartner() {
  if (state.campaign?.currentRoundId !== CONTENT.campaign.hiddenRound.id) return null;
  const heroineId = state.campaign.heroineId;
  const injured = CONTENT.campaign.hiddenIntro.byHeroine[heroineId].rivalId;
  return CONTENT.campaign.playableHeroineIds.find(id => id !== heroineId && id !== injured) ?? null;
}

function playTrainingCommandAnimation(commandId, onComplete) {
  const partnerId = commandId === "sparring" ? gyaruSparringPartner() : null;
  if (state.currentStage?.mode === "training" && !state.trainingAnimationActive) {
    const started = playPixelTraining(app, getSelectedTrainingCharacter().id, commandId, () => {
      state.trainingAnimationActive = false;
      onComplete();
    }, partnerId);
    if (started) { state.trainingAnimationActive = true; return true; }
  }
  const character = getSelectedTrainingCharacter();
  if (partnerId && !state.trainingAnimationActive) {
    state.trainingAnimationActive = true;
    const left = getBattleFighter(character.id, character.name), right = getBattleFighter(partnerId, CONTENT.heroines[partnerId].name);
    left.finisher = null; right.finisher = null;
    const complete = () => { state.trainingAnimationActive = false; onComplete(); };
    playBattleScene(app, { left, right, background: assetUrl(CONTENT.battle.backgrounds.default), result: "draw", title: "スパーリング", roundIntroMs: 250, resultHoldMs: 400,
      resultBanner: { main: "練習終了", sub: `${left.name} / ${right.name}` }, events: [{ actor: "left", action: "straight", hit: false }, { actor: "right", action: "jab", hit: false }] }, complete).catch(complete);
    return true;
  }
  const animation = character.trainingAnimations?.[commandId];
  const frames = animation?.frames
    ?.map(normalizeTrainingAnimationFrame)
    .filter(Boolean) ?? [];
  if (
    state.currentStage?.mode !== "training"
    || state.trainingAnimationActive
    || frames.length < 2
  ) {
    return false;
  }

  state.trainingAnimationActive = true;
  const allowedEffects = new Set(["sandbag", "roadwork", "sparring", "recover"]);
  const effect = allowedEffects.has(animation.effect) ? animation.effect : commandId;
  const overlay = document.createElement("div");
  overlay.className = `training-action-overlay training-action-${effect}`;
  overlay.dataset.trainingCommand = commandId;
  overlay.dataset.trainingFrame = "0";
  overlay.setAttribute("role", "img");
  overlay.setAttribute("aria-label", `${character.name}の${animation.label ?? commandId}演出`);

  const scene = document.createElement("div");
  scene.className = `training-action-scene${effect === "sandbag" ? " has-training-prop" : ""}`;

  const label = document.createElement("span");
  label.className = "training-action-label";
  label.textContent = animation.label ?? commandId;

  const frameViewport = document.createElement("div");
  frameViewport.className = "training-action-frame-viewport";

  const fallback = document.createElement("span");
  fallback.className = "training-action-fallback";
  fallback.textContent = animation.label ?? "TRAINING";
  fallback.style.display = "none";

  let frameIndex = 0;
  const frameImages = frames.map((frame, index) => {
    const image = document.createElement("img");
    image.className = `training-action-frame${frame.flipX ? " is-flipped" : ""}`;
    image.alt = "";
    image.dataset.trainingFrame = String(index);
    image.dataset.flipX = String(frame.flipX);
    image.dataset.loadState = "loading";
    image.addEventListener("load", () => {
      image.dataset.loadState = "loaded";
      image.classList.remove("has-load-error");
      if (frameIndex === index) fallback.style.display = "none";
    });
    image.addEventListener("error", () => {
      image.dataset.loadState = "error";
      image.classList.add("has-load-error");
      if (frameIndex === index) fallback.style.display = "grid";
    });
    image.src = assetUrl(frame.src);
    return image;
  });
  const applyTrainingFrame = (nextFrameIndex) => {
    frameIndex = nextFrameIndex;
    frameImages.forEach((image, index) => {
      image.classList.toggle("is-active", index === frameIndex);
    });
    fallback.style.display = frameImages[frameIndex].dataset.loadState === "loaded" ? "none" : "grid";
    overlay.dataset.trainingFrame = String(frameIndex);
  };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  frameViewport.append(...frameImages, fallback);
  scene.append(frameViewport);
  if (effect === "sandbag") {
    const sandbag = document.createElement("span");
    sandbag.className = "training-css-sandbag";
    sandbag.setAttribute("aria-hidden", "true");
    sandbag.innerHTML = `
      <span class="training-css-sandbag-mount"></span>
      <span class="training-css-sandbag-chain"></span>
      <span class="training-css-sandbag-body"></span>
    `;
    scene.appendChild(sandbag);
  }
  scene.appendChild(label);
  overlay.appendChild(scene);
  app.appendChild(overlay);

  const frameMs = Math.max(300, animation.frameMs ?? 550);
  const durationMs = reduceMotion ? 700 : Math.max(frameMs * 4, animation.durationMs ?? 2400);
  frameIndex = reduceMotion ? frames.length - 1 : 0;
  let frameTimer = null;

  applyTrainingFrame(frameIndex);
  if (reduceMotion) {
    overlay.classList.add("is-impact");
  } else {
    frameTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      applyTrainingFrame(frameIndex);
      overlay.classList.toggle("is-impact", frameIndex > 0);
    }, frameMs);
  }

  setTimeout(() => {
    if (frameTimer) clearInterval(frameTimer);
    overlay.remove();
    state.trainingAnimationActive = false;
    onComplete();
  }, durationMs);
  return true;
}

function completeCommandAction(commandId) {
  if (!state.game) return;
  const prevStats = { ...state.game.stats };
  const previousProgress = { firedEventIds: [...(state.campaign?.firedEventIds ?? [])] };
  const isTrainingMode = state.currentStage?.mode === "training";

  const command = COMMANDS.find(item => item.id === commandId);
  if (isTrainingMode && (!command || getCommandState(command, state.game).disabled)) return;
  if (isTrainingMode) recordYukitoGuideStep(CONTENT.campaign.yukitoGuide, state.campaign, state.game, commandId);
  state.game = advanceTurn(state.currentStage, state.game, commandId);
  if (isTrainingMode) playSfx("training");
  const nextStats = { ...state.game.stats };
  state.pendingCommandId = null;
  finishGameIfNeeded();

  if (state.screen === "ending" || state.screen === "campaign-battle") {
    if (isTrainingMode) showTrainingStatChanges(prevStats, nextStats, previousProgress);
    return;
  }
  // 育成中イベント：会話へ切り替わった場合も、直前の実増減値を表示する。
  if (maybeShowTrainingEvent()) {
    persistCampaignSave("dialogue");
    if (isTrainingMode) showTrainingStatChanges(prevStats, nextStats, previousProgress);
    return;
  }

  render();
  if (isTrainingMode && state.currentStage?.campaignRound) persistCampaignSave("game");

  // Hidden mode の既存フィードバックは変更しない。
  if (!isTrainingMode) {
    if (commandId === "rest") {
      app.classList.add("shake-screen");
      setTimeout(() => app.classList.remove("shake-screen"), 400);
    }
    triggerFlyTexts(prevStats, nextStats);
    return;
  }

  showTrainingStatChanges(prevStats, nextStats, previousProgress);
}

function renderDialogue() {
  const dialogue = state.dialogue;
  if (!dialogue) {
    state.screen = "title";
    renderTitle();
    return;
  }
  const line = dialogue.lines[dialogue.index] ?? { speaker: "", text: "" };
  if (dialogue.after === "select-heroine") {
    const opening = CONTENT.campaign.coachOpening;
    app.innerHTML = `<main class="screen coach-opening-screen">
      <section class="panel coach-opening-panel">
        ${opening.background ? `<img class="coach-opening-background" src="${escapeHtml(assetUrl(opening.background))}" alt="" onerror="this.style.display='none'">` : ""}
        <p class="eyebrow">${escapeHtml(opening.label)}</p>
        <div class="coach-opening-stage">
          ${opening.portrait ? `<img class="coach-opening-portrait" src="${escapeHtml(assetUrl(opening.portrait))}" alt="会長" onerror="this.style.display='none'">` : ""}
        </div>
        <article class="dialogue-dock">
          ${line.speaker ? `<div class="dialogue-speaker-label" aria-label="話者">${escapeHtml(line.speaker)}</div>` : ""}
          <p class="training-dialogue-text">${escapeHtml(line.text)}</p>
          <div class="footer-actions"><span class="hint">${dialogue.index + 1} / ${dialogue.lines.length}</span><button class="primary-btn" data-action="dialogue-next">次へ</button></div>
        </article>
      </section>
    </main>`;
    return;
  }
  const presentation = resolveDialoguePresentation(CONTENT, { background: dialogue.background, ...line }, getSelectedTrainingCharacter().id, dialogue.lines);
  const character = TRAINING_CHARACTERS.find((item) => item.id === presentation.characterId) ?? getSelectedTrainingCharacter();
  const standingImage = presentation.hideSprite ? "" : presentation.sprite || character.standingImage;
  const showEventCg = presentation.hideSprite && Boolean(presentation.background);
  const showPov = presentation.layout === "pov";
  // 相手紹介の紙がある場面は、行の指定がなければヒロインを右へ寄せ、左に紙を置く。
  const paper = dialogue.paper;
  const stagePosition = paper && !line.position ? "right" : presentation.position;
  const paperMarkup = paper ? `
    <figure class="opponent-paper" aria-label="対戦相手の資料">
      <div class="opponent-paper-photo">
        <img src="${escapeHtml(assetUrl(paper.image))}" alt="${escapeHtml(paper.name)}" onload="if(this.naturalWidth===this.naturalHeight)this.classList.add('is-square');" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">
        <span class="opponent-paper-fallback" style="display:none;">VS</span>
      </div>
      <figcaption><span>${escapeHtml(paper.label || "NEXT OPPONENT")}</span><strong>${escapeHtml(paper.name)}</strong></figcaption>
    </figure>
  ` : "";
  const paired = presentation.actors.length === 2;
  const actorsMarkup = presentation.actors.map((actor) => {
    const person = TRAINING_CHARACTERS.find((item) => item.id === actor.characterId) ?? character;
    const figure = renderTrainingCharacterFigure(person,
      `training-dialogue-portrait ${actor.speaking ? "is-speaking" : actor.dimmed ? "is-inactive-speaker" : ""}`,
      false, true, actor.sprite || person.standingImage);
    return paired ? `<div class="dialogue-actor actor-${actor.position}" data-character-id="${escapeHtml(actor.characterId)}">${figure}</div>` : figure;
  }).join("");

  app.innerHTML = `
    <main class="screen training-dialogue-screen theme-${escapeHtml(character.themeClass)}">
      <section class="training-dialogue-layout${showEventCg ? " is-event-cg" : showPov ? " is-event-cg is-pov" : ""}">
        <article class="panel training-dialogue-figure">
          <div class="training-figure-stage${standingImage ? " has-standing-sprite" : ""}${paired ? " has-two-actors" : ""} dialogue-position-${stagePosition}">
            ${presentation.background ? `<img class="dialogue-background" style="visibility:hidden" onload="this.decode().catch(()=>{}).then(()=>{this.style.visibility='visible';})" src="${escapeHtml(assetUrl(presentation.background))}" alt="" ${presentation.backgroundFallback ? `data-fallback="${escapeHtml(assetUrl(presentation.backgroundFallback))}" onerror="if(this.dataset.fallback){const next=this.dataset.fallback;delete this.dataset.fallback;this.src=next;}else{this.style.display='none';}"` : `onerror="this.style.display='none'"`}>` : ""}
            ${showEventCg ? `<span class="dialogue-cg-fallback" aria-hidden="true">場面のイラスト</span>` : `<div class="single-stage-grid"></div>`}
            ${showEventCg ? "" : paperMarkup}
            ${showPov ? `<img class="dialogue-pov-character" src="${escapeHtml(assetUrl(standingImage))}" alt="${escapeHtml(character.name)}" onerror="this.style.display='none'"><img class="dialogue-pov-foreground" src="${escapeHtml(assetUrl(presentation.foreground))}" alt="コーチのミット" onerror="this.style.display='none'">` : actorsMarkup}
          </div>
        </article>
        <article class="panel dialogue-dock training-dialogue-box">
          ${line.speaker ? `<div class="dialogue-speaker-label" aria-label="話者">${escapeHtml(line.speaker)}</div>` : ""}
          <div class="training-dialogue-text">${escapeHtml(line.text)}</div>
          <div class="footer-actions">
            <span class="hint">${dialogue.index + 1} / ${dialogue.lines.length} タップまたはクリックで進行</span>
            <button class="primary-btn" data-action="dialogue-next">次へ</button>
          </div>
        </article>
      </section>
    </main>
  `;
  // Register only successfully decoded artwork that is still on the screen.
  const artwork = app.querySelector(".dialogue-background");
  if (artwork) {
    const record = async () => {
      try { await artwork.decode(); } catch { return; }
      if (!artwork.isConnected || !artwork.naturalWidth || artwork.style.display === "none") return;
      unlockEventArtwork(new URL(artwork.currentSrc || artwork.src, location.href).pathname.replace(/^\/+/, ""));
    };
    artwork.addEventListener("load", record, { once: true });
    if (artwork.complete) void record();
  }
}

function renderVictoryFight() {
  const stage = state.currentStage;
  const fightSprites = stage.assets.fightSprites ?? {};
  const currentSprite = fightSprites[state.fightSpriteKey] ?? "";

  app.innerHTML = `
    <main class="screen victory-screen">
      <section class="panel victory-shell">
        <div class="victory-stage">
          <img
            class="victory-stage-image"
            src="${assetUrl(stage.assets.background)}"
            alt="${escapeHtml(stage.name)} 試合背景"
            onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
          >
          <div class="victory-stage-fallback" style="display:none;">
            <strong>試合背景プレースホルダー</strong>
            <span>試合演出用背景をここに表示します。</span>
          </div>

          <div class="victory-overlay">
            <div class="victory-fight-area">
              <div class="victory-fighter victory-fighter-rival">
                <img
                  class="victory-fighter-image"
                  src="${assetUrl(currentSprite)}"
                  alt="瑞花 試合スプライト"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
                >
                <div class="victory-fighter-fallback" style="display:none;">
                  <strong>瑞花スプライト</strong>
                  <span>fight 画像未配置時の仮表示です。</span>
                </div>
              </div>
            </div>
            <div class="victory-actions">
              <button class="primary-btn" data-action="open-victory-ending">結果を見る</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
}


function hiddenIntroBackground() {
  const round = state.currentStage.campaignRound;
  const opponentId = state.currentStage.opponent?.id ?? round.opponentId;
  const backgrounds = CONTENT.battle?.backgrounds ?? {};
  return backgrounds[round.id] ?? backgrounds[opponentId] ?? backgrounds.default ?? "";
}

function showHiddenIntroDialogue(lines, after) {
  state.hiddenIntro = { phase: "dialogue" };
  state.dialogue = { lines, index: 0, after, paper: CONTENT.campaign.hiddenIntro.paper };
  state.screen = "hidden-intro";
  render();
}

function clearHiddenIntroSignal() {
  for (const timer of state.hiddenIntro?.timers ?? []) clearTimeout(timer);
  app.classList.remove("shake-screen");
}

function finishHiddenIntroSignal() {
  if (state.hiddenIntro?.phase !== "signal") return;
  clearHiddenIntroSignal();
  const intro = CONTENT.campaign.hiddenIntro;
  const route = intro.byHeroine[state.campaign.heroineId];
  const lines = [intro.gyaruLines.entry, route.rivalStepIn, intro.gyaruLines.acceptRival]
    .map((line) => ({ ...line, background: hiddenIntroBackground() }));
  showHiddenIntroDialogue(lines, "hidden-intro-battle");
}

function beginHiddenIntro() {
  if (state.screen !== "ending" || state.campaign?.outcome !== "hidden-offer" || state.campaign.hiddenIntroSeen) return;
  const heroineId = state.campaign.heroineId;
  const lines = CONTENT.campaign.hiddenIntro.byHeroine[heroineId]?.beforeLines;
  if (beginCampaignDialogue(`champion-before-intrusion:${heroineId}`, lines, "start-hidden-intro-signal")) return;
  startHiddenIntroSignal();
}

function startHiddenIntroSignal() {
  if (state.campaign?.outcome !== "hidden-offer" || state.campaign.hiddenIntroSeen) return;
  persistCampaignSave("ending");
  state.hiddenIntro = { phase: "signal", started: false, timers: [] };
  state.screen = "hidden-intro";
  render();
}

function createHiddenIntroBattleCard() {
  const intro = CONTENT.campaign.hiddenIntro;
  const route = intro.byHeroine[state.campaign.heroineId];
  const rivalId = route.rivalId;
  const left = getBattleFighter("gyaru", intro.paper.name);
  const right = getBattleFighter(rivalId, CONTENT.heroines[rivalId].name);
  left.finisher = {
    ...route.exhibition.finisher,
    cutinImage: assetUrl(route.exhibition.finisher.cutinImage ?? ""),
  };
  right.finisher = null;
  // Only this exhibition shortens wind-up/reset while keeping hit poses readable.
  for (const fighter of [left, right]) fighter.feel = { ...fighter.feel, ...intro.exhibitionFeel };
  return {
    left, right,
    background: assetUrl(hiddenIntroBackground()),
    result: "ko",
    events: route.exhibition.events,
    tempo: intro.exhibitionTempo,
    title: intro.exhibitionTitle,
    roundIntroMs: 300,
    resultBanner: intro.exhibitionBanner,
    koFinish: CONTENT.battle.koFinish,
    koMouthpiece: true,
    exhibition: true,
    preloadImages: [assetUrl(route.koDownImage)],
  };
}

function finishHiddenIntroBattle() {
  if (state.screen !== "hidden-intro" || state.hiddenIntro?.phase !== "battle") return;
  const intro = CONTENT.campaign.hiddenIntro;
  const route = intro.byHeroine[state.campaign.heroineId];
  const aftermath = [intro.gyaruLines.lateHit, route.taunt, route.stretcher, route.rivalSendOff]
    .map((line) => ({ ...line, sprite: "none", background: route.koDownImage }));
  const response = [...route.reaction, route.trainer, intro.gyaruLines.paper]
    .map((line) => ({ ...line, background: hiddenIntroBackground() }));
  showHiddenIntroDialogue([...aftermath, ...response], "hidden-intro-offer");
}

function renderHiddenIntro() {
  const flow = state.hiddenIntro;
  if (!flow) return;
  if (flow.phase === "dialogue") {
    renderDialogue();
    return;
  }
  if (flow.started) return;
  flow.started = true;
  stopBgm();
  if (flow.phase === "battle") {
    app.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    playBattleScene(app, createHiddenIntroBattleCard(), finishHiddenIntroBattle).catch((error) => {
      console.warn("[battle] 乱入試合を再生できなかったため、会話へ進みます。", error);
      finishHiddenIntroBattle();
    });
    return;
  }
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  app.innerHTML = `
    <main class="screen hidden-intro-screen" data-hidden-intro-phase="signal" tabindex="-1">
      <div class="hidden-intro-dim"></div>
      <div class="hidden-intro-stripe" aria-live="polite">${escapeHtml(CONTENT.campaign.hiddenIntro.banner)}</div>
      <button class="secondary-btn hidden-intro-skip" data-action="hidden-intro-skip">タップ / クリック / Enter でスキップ</button>
    </main>
  `;
  for (const delay of [0, 500, 1000]) {
    flow.timers.push(setTimeout(() => {
      if (state.hiddenIntro !== flow) return;
      playSfx("bell");
      if (!reduced) {
        app.classList.remove("shake-screen");
        void app.offsetWidth;
        app.classList.add("shake-screen");
      }
    }, delay));
  }
  flow.timers.push(setTimeout(finishHiddenIntroSignal, 1200));
}

function finishHiddenIntroDialogue(after) {
  if (after === "hidden-intro-battle") {
    state.hiddenIntro = { phase: "battle", started: false };
    render();
  } else if (after === "hidden-intro-offer") {
    state.hiddenIntro = null;
    state.campaign.hiddenIntroSeen = true;
    state.hiddenChallengeFresh = true;
    state.screen = "ending";
    persistCampaignSave("ending");
    render();
  } else {
    state.hiddenIntro = null;
    if (after === "hidden-intro-accept") {
      const round = getCampaignRound(state.campaign.pendingRoundId);
      if (round) startCampaignRound(round);
    } else if (after === "hidden-intro-decline") {
      finishCampaignWith("good", state.campaign.lastRoundDescription);
      render();
    }
  }
}

function chooseHiddenChallenge(choice) {
  if (state.campaign?.outcome !== "hidden-offer" || state.campaign.hiddenIntroSeen !== true) return;
  const route = CONTENT.campaign.hiddenIntro.byHeroine[state.campaign.heroineId];
  state.hiddenChallengeFresh = false;
  showHiddenIntroDialogue([{ ...route[choice], background: hiddenIntroBackground() }], `hidden-intro-${choice}`);
}

function renderHiddenChallenge() {
  const intro = CONTENT.campaign.hiddenIntro;
  const offer = CONTENT.campaign.outcomeText.hiddenOffer;
  const paper = intro.paper;
  const fresh = state.hiddenChallengeFresh;
  state.hiddenChallengeFresh = false;
  app.innerHTML = `
    <main class="screen campaign-ending-screen hidden-challenge-screen${fresh ? " is-fresh" : ""}">
      <section class="ending-layout campaign-result-sheet">
        <div class="panel art-card campaign-result-art hidden-challenge-art${fresh ? " shake-screen" : ""}">
          <figure class="opponent-paper hidden-challenge-paper">
            <div class="opponent-paper-photo">
              <img src="${escapeHtml(assetUrl(paper.image))}" alt="${escapeHtml(paper.name)}" onload="if(this.naturalWidth===this.naturalHeight)this.classList.add('is-square');" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">
              <span class="opponent-paper-fallback" style="display:none;">VS</span>
            </div>
            <figcaption><span>CHALLENGE</span><strong>${escapeHtml(paper.name)}</strong></figcaption>
            <img class="challenge-decal challenge-heart-one" src="${assetUrl("assets/ui/decal_heart.png")}" alt="" onerror="this.style.display='none'">
            <img class="challenge-decal challenge-heart-two" src="${assetUrl("assets/ui/decal_heart.png")}" alt="" onerror="this.style.display='none'">
            <img class="challenge-decal challenge-sparkle" src="${assetUrl("assets/ui/decal_sparkle.png")}" alt="" onerror="this.style.display='none'">
            <span class="challenge-doodle">${escapeHtml(intro.doodle)}</span>
          </figure>
        </div>
        <article class="panel ending-card campaign-result-card">
          <p class="eyebrow">CHALLENGE</p>
          <h2>${escapeHtml(offer.title)}</h2>
          <div class="ending-text">${escapeHtml(offer.description)}</div>
          <p class="hidden-challenge-notice">※${escapeHtml(intro.notice)}</p>
          <div class="footer-actions"><div class="stack">
            <button class="primary-btn" data-action="hidden-intro-accept">${escapeHtml(intro.choices.accept)}</button>
            <button class="secondary-btn" data-action="hidden-intro-decline">${escapeHtml(intro.choices.decline)}</button>
            <button class="primary-btn" data-action="back-title">タイトルへ戻る</button>
          </div></div>
        </article>
      </section>
    </main>
  `;
}

function renderProgressNotices(campaign) {
  if (!campaign) return "";
  const marker = campaign.cornerNotice;
  const intro = campaign.yukitoIntroduction;
  const text = CONTENT.campaign.cornerGuideMessages;
  const guide = CONTENT.campaign.yukitoGuide?.introduction;
  return `${marker && text ? `<aside class="progress-notice corner-progress-notice" role="status"><strong>${escapeHtml(text[marker.color])}</strong><p>${escapeHtml(text.targets)}</p><p>${escapeHtml(text.context)}</p>${campaign.currentRoundId === CONTENT.campaign.hiddenRound.id ? `<p>${escapeHtml(text.koOnly)}</p>` : ""}</aside>` : ""}
    ${intro && guide ? `<aside class="progress-notice yukito-introduction" aria-label="雪兎ちゃんのごあいさつ"><header>${yukitoIconMarkup()}<strong>${escapeHtml(guide.title)}</strong></header>${[guide.greeting, guide[intro.result], ...guide.lines].map(line => `<p>${escapeHtml(line)}</p>`).join("")}</aside>` : ""}`;
}

function renderEnding() {
  const stage = state.currentStage;
  const ending = state.game.ending;
  const campaign = state.campaign;
  const reaction = campaign ? victoryReaction(CONTENT.heroines[campaign.heroineId], campaign.results.at(-1)) : [];
  const hasNextRound = Boolean(campaign?.pendingRoundId);
  const { weeksPerFight, maxFights } = getCampaignSchedule();
  const canRetry = campaign?.outcome === "revenge-offer" && campaign.fightCount < maxFights;
  const isHiddenOffer = campaign?.outcome === "hidden-offer";
  if (isHiddenOffer && campaign.hiddenIntroSeen === true) {
    renderHiddenChallenge();
    return;
  }
  const isFinalCampaignEnding = ["normal", "good", "true", "epilogue"].includes(campaign?.outcome);
  const showGallery = campaign ? isFinalCampaignEnding : true;
  const nextRoundIsHidden = campaign?.pendingRoundId === CONTENT.campaign.hiddenRound?.id;
  const resultHint = isHiddenOffer ? "試合結果が確定しました。" : hasNextRound
    ? nextRoundIsHidden
      ? `第${campaign.weeksElapsed + 1}週から隠しボス戦の準備に入ります。挑まなければグッドエンドです。`
      : `ステータスを持ち越し、第${campaign.weeksElapsed + 1}週から次戦の準備に入ります。`
    : canRetry
      ? `現在の育成値を保持したまま、次の${weeksPerFight}週間を使ってリベンジできます。`
      : isFinalCampaignEnding
        ? `${campaign.fightCount}試合・${campaign.weeksElapsed}週間の結果が記録されました。`
        : "試合結果が確定しました。";

  const heroineThemeClass = campaign
    ? (CONTENT.heroines[campaign.heroineId]?.themeClass ?? campaign.heroineId)
    : "";
  const isRoundResultArt = ["ko", "win", "draw", "lose"].includes(ending.id);
  const endingScreenClass = campaign ? " campaign-ending-screen theme-" + escapeHtml(heroineThemeClass) + (isRoundResultArt ? " campaign-round-result-screen" : "") : "";
  const endingLayoutClass = campaign ? " campaign-result-sheet" : "";
  const endingArtClass = campaign ? " campaign-result-art" : "";
  const endingCardClass = campaign ? " campaign-result-card" : "";

  app.innerHTML = `
    <main class="screen${endingScreenClass}">
      <section class="ending-layout${endingLayoutClass}">
        <div class="panel art-card${endingArtClass}">
          ${renderMediaSlot({
            src: ending.image,
            alt: `${ending.title} CG`,
            placeholderClass: "stage",
            title: `${ending.title} 用イラスト プレースホルダー`,
            body: "素材追加後はここにエンドCGや演出画像を配置します。",
          })}
        </div>
        <article class="panel ending-card${endingCardClass}">
          <p class="eyebrow">${escapeHtml(stage.name)}</p>
          <h2>${escapeHtml(ending.title)}</h2>
          <div class="ending-text">${escapeHtml(ending.description)}</div>
          ${reaction.length ? `<div class="match-victory-reaction" aria-label="勝利の会話">${reaction.map(line => `<p><strong>${escapeHtml(line.speaker)}</strong><span>${escapeHtml(line.text)}</span></p>`).join("")}</div>` : ""}
          ${campaign && ending.closingLine ? `<blockquote class="ending-closing"><span>${escapeHtml(CONTENT.heroines[campaign.heroineId].name)}</span><p>「${escapeHtml(ending.closingLine)}」</p></blockquote>` : ""}
          ${campaign && isRoundResultArt ? renderTrainingReview(stage, state.game.stats, CONTENT.heroines[campaign.heroineId]) : ""}
          ${campaign ? `<div class="pixel-result">${pixelActorMarkup(campaign.heroineId, ["win", "ko"].includes(ending.id) || ["good", "true"].includes(campaign.outcome) ? "victory" : "tired", "arena")}</div>` : ""}
          ${renderProgressNotices(campaign)}
          <div class="footer-actions">
            <span class="hint">${escapeHtml(resultHint)}</span>
            <div class="stack">
              ${hasNextRound && !isHiddenOffer ? `<button class="primary-btn" data-action="next-campaign-round">${nextRoundIsHidden ? "隠しボスに挑む" : "次の試合へ"}</button>` : ""}
              ${isHiddenOffer ? `<button class="primary-btn" data-action="hidden-intro-start">次へ</button>` : ""}
              ${canRetry ? `<button class="primary-btn" data-action="retry-campaign-round">リベンジする（さらに${weeksPerFight}週間）</button>` : ""}
              ${canRetry ? `<button class="secondary-btn" data-action="end-campaign-normal">ここでシーズンを終える</button>` : ""}
              ${showGallery ? `<button class="secondary-btn" data-action="open-gallery">ギャラリーへ</button>` : ""}
              <button class="primary-btn" data-action="back-title">タイトルへ戻る</button>
            </div>
          </div>
        </article>
      </section>
    </main>
  `;
}

const GALLERY_STAT_LABELS = { pow: "パワー", spd: "スピード", sta: "スタミナ", tec: "テクニック" };

// 王者突破（good / true / epilogue のいずれかに到達）済みのヒロインだけ、必殺技の狙い方をギャラリーに記す。
function hasBeatenChampion(heroineId, reachedEndings) {
  return ["good", "true", "epilogue"].some((type) => reachedEndings.has(`campaign-${heroineId}-${type}`));
}

// 必殺技メモ: 普段は言葉のヒント、開くと正確な習得条件（DEC-055 #8）。
function renderGalleryMoveMemo(heroineId) {
  const moves = CONTENT.heroines?.[heroineId]?.moves ?? [];
  if (!moves.length) return "";
  if (!hasBeatenChampion(heroineId, new Set(loadReachedEndings()))) {
    return `
      <aside class="gallery-move-memo is-locked" aria-label="必殺技メモ">
        <p class="gallery-move-memo-title">必殺技メモ</p>
        <p class="gallery-move-memo-lock">王座決定戦に勝つと、必殺技の狙い方がここに記される。</p>
      </aside>
    `;
  }
  const entries = moves.map((move) => {
    const conditions = Object.entries(move.acquiredWhen ?? {})
      .map(([stat, value]) => `${GALLERY_STAT_LABELS[stat] ?? String(stat).toUpperCase()} ${value}以上`)
      .join(" かつ ");
    return `
      <div class="gallery-move-memo-entry">
        <strong>${escapeHtml(move.name)}</strong>
        <p>${escapeHtml(move.hint ?? move.paperNote ?? "")}</p>
        <details>
          <summary>正確な条件を見る</summary>
          <p>${move.acquisitionNote ? `${escapeHtml(move.acquisitionNote)}、` : ""}${escapeHtml(conditions)}で習得。試合スコア +${move.scoreBonus ?? 0}、KO判定にも +${move.koBonus ?? 0}。</p>
        </details>
      </div>
    `;
  }).join("");
  return `
    <aside class="gallery-move-memo" aria-label="必殺技メモ">
      <p class="gallery-move-memo-title">必殺技メモ</p>
      ${entries}
    </aside>
  `;
}

function renderSpectatorSetup() {
  if (!getGyaruClearProgress().allCleared) {
    state.screen = "gallery";
    renderGallery();
    return;
  }
  const ids = getSpectatorFighters(CONTENT);
  state.spectatorChoice ??= { leftId: ids[0], rightId: ids[1], winnerSide: "left", finishType: "ko", special: true };
  const choice = state.spectatorChoice;
  const name = id => CONTENT.battle.fighters[id]?.name ?? "選手";
  const corners = ["left", "right"].map(side => {
    const id = choice[side + "Id"], opponent = choice[(side === "left" ? "right" : "left") + "Id"];
    const fighter = CONTENT.battle.fighters[id];
    const sprite = fighter?.sprites?.stance;
    const src = typeof sprite === "string" ? assetUrl(sprite) : "";
    const flip = (side === "right") !== (fighter?.facing === "left");
    return `<section class="spectator-corner ${side}" data-winner="${choice.winnerSide === side}">
      <label for="spectator-${side}Id">${side === "left" ? "左" : "右"}コーナーの選手</label>
      <select id="spectator-${side}Id" data-spectator-field="${side}Id">${ids.map(candidate => `<option value="${candidate}" ${candidate === id ? "selected" : ""} ${candidate === opponent ? "disabled" : ""}>${escapeHtml(name(candidate))}</option>`).join("")}</select>
      <div class="spectator-portrait">
        ${src ? `<img src="${src}" alt="${escapeHtml(name(id))}" style="transform:scaleX(${flip ? -1 : 1})" onerror="this.hidden=true;this.nextElementSibling.hidden=false;">` : ""}
        <span class="spectator-image-fallback" ${src ? "hidden" : ""}>${escapeHtml(name(id))}</span>
        ${choice.winnerSide === side ? '<strong class="spectator-winner-mark">勝者</strong>' : ""}
      </div>
      <p class="spectator-move">必殺技：${escapeHtml(getSpectatorMove(CONTENT, id)?.name ?? "なし")}</p>
    </section>`;
  }).join("");
  app.innerHTML = `<main class="screen"><section class="panel spectator-card">
    <header><p class="eyebrow">RINGSIDE / EXHIBITION MATCH</p><h2>試合観戦モード</h2><p>対戦カードと結末を選んで、リングへ。</p></header>
    <div class="spectator-corners">${corners}</div>
    <div class="spectator-swap"><button class="secondary-btn" data-action="spectator-swap">左右を入れ替える</button></div>
    <div class="spectator-options">
      <label for="spectator-winnerSide">勝者<select id="spectator-winnerSide" data-spectator-field="winnerSide">${["left", "right"].map(side => `<option value="${side}" ${choice.winnerSide === side ? "selected" : ""}>${side === "left" ? "左" : "右"}：${escapeHtml(name(choice[side + "Id"]))}</option>`).join("")}</select></label>
      <label for="spectator-finishType">決着<select id="spectator-finishType" data-spectator-field="finishType"><option value="ko" ${choice.finishType === "ko" ? "selected" : ""}>KO</option><option value="decision" ${choice.finishType === "decision" ? "selected" : ""}>判定</option></select></label>
      <label for="spectator-special">勝者の必殺技<select id="spectator-special" data-spectator-field="special"><option value="true" ${choice.special ? "selected" : ""}>あり</option><option value="false" ${choice.special ? "" : "selected"}>なし</option></select></label>
    </div>
    <p class="spectator-note">必殺技ありでは、勝者がその技で攻め込みます。KOではダウン、判定では勝者へのスポットライトを再生します。</p>
    <div class="footer-actions"><button class="back-btn" data-action="back-gallery">ギャラリーへ戻る</button><button class="primary-btn" data-action="spectator-play" ${ids.length < 2 ? "disabled" : ""}>試合を再生</button></div>
  </section></main>`;
}

function renderSpectatorBattle() {
  if (state.spectatorActive || state.spectatorCompleted) return;
  state.spectatorActive = true;
  const card = createSpectatorCard(CONTENT, state.spectatorChoice, getBattleFighter);
  card.background = assetUrl(card.background);
  app.innerHTML = `<main class="screen spectator-playback"><header><p class="eyebrow">RINGSIDE / EXHIBITION MATCH</p><h2>試合観戦モード</h2></header><div data-spectator-stage></div><div class="spectator-playback-footer" data-spectator-footer><p>画面をタップ、または Enter / Space でスキップ</p></div></main>`;
  const complete = (failed = false) => {
    if (state.spectatorCompleted) return;
    state.spectatorActive = false;
    state.spectatorCompleted = true;
    if (state.screen !== "spectator-battle") return;
    const winner = card[card.winnerSide];
    const arena = app.querySelector("[data-bs-arena]");
    if (arena) {
      arena.setAttribute("role", "group");
      arena.setAttribute("aria-label", "試合結果");
      arena.tabIndex = -1;
      arena.querySelector(".bs-skip-hint").style.display = "none";
    }
    app.querySelector("[data-spectator-footer]").innerHTML = `
      <p role="status">${failed ? "再生できませんでした。条件を確認して、もう一度お試しください。" : `${escapeHtml(winner.name)}の${card.finishType === "ko" ? "KO" : "判定"}勝利`}</p>
      <div class="footer-actions"><button class="back-btn" data-action="back-gallery">ギャラリーへ戻る</button><button class="secondary-btn" data-action="spectator-setup">条件を変える</button><button class="primary-btn" data-action="spectator-play">もう一度再生</button></div>`;
    app.querySelector('[data-action="spectator-setup"]').focus({ preventScroll: true });
    syncBgmForScreen();
  };
  playBattleScene(app.querySelector("[data-spectator-stage]"), card, () => complete()).catch(error => {
    console.warn("[spectator] 試合観戦を再生できませんでした。", error);
    complete(true);
  });
}

function renderGallery() {
  const items = getGalleryItems();
  const extras = getGyaruClearProgress();
  const availableTabIds = new Set(items.map(getGalleryAlbumTabId));
  if (!availableTabIds.has(state.selectedGalleryTab)) {
    state.selectedGalleryTab = GALLERY_ALBUM_TABS.find((tab) => availableTabIds.has(tab.id))?.id ?? "ren";
  }

  const tabButtons = GALLERY_ALBUM_TABS
    .filter((tab) => availableTabIds.has(tab.id))
    .map((tab) => {
      const tabItems = items.filter((item) => getGalleryAlbumTabId(item) === tab.id);
      const unlockedCount = tabItems.filter((item) => item.unlocked).length;
      const active = tab.id === state.selectedGalleryTab;
      return `
        <button
          class="gallery-album-tab ${active ? "active" : ""}"
          role="tab"
          id="gallery-tab-${tab.id}"
          aria-controls="gallery-panel-${tab.id}"
          aria-selected="${active}"
          tabindex="${active ? "0" : "-1"}"
          data-action="switch-gallery-tab"
          data-gallery-tab="${tab.id}"
          style="--tab-accent: ${tab.accent};"
        >
          <span>${escapeHtml(tab.shortLabel)}</span>
          <small>${unlockedCount}/${tabItems.length}</small>
        </button>
      `;
    })
    .join("");

  const albumPages = GALLERY_ALBUM_TABS
    .filter((tab) => availableTabIds.has(tab.id))
    .map((tab) => {
      const tabItems = items.filter((item) => getGalleryAlbumTabId(item) === tab.id);
      const active = tab.id === state.selectedGalleryTab;
      const list = tabItems.map((item, index) => `
        <button class="gallery-item ${item.unlocked ? "" : "locked"}" data-gallery-id="${item.id}" ${item.unlocked ? "" : "disabled"}>
          <span class="gallery-photo-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
          <div class="gallery-thumb">
            ${item.unlocked
              ? `<img class="gallery-thumb-image" src="${assetUrl(item.image)}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">
                 <span class="gallery-thumb-fallback">CG Placeholder</span>`
              : `<span class="gallery-lock-mark" aria-hidden="true">◆</span><span>LOCKED</span>`}
          </div>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${item.unlocked ? escapeHtml(item.description) : "この記録はまだ空白です。"}</span>
        </button>
      `).join("");
      const unlockedCount = tabItems.filter((item) => item.unlocked).length;
      return `
        <section
          class="gallery-album-page"
          id="gallery-panel-${tab.id}"
          role="tabpanel"
          aria-labelledby="gallery-tab-${tab.id}"
          ${active ? "" : "hidden"}
          style="--page-accent: ${tab.accent};"
        >
          <header class="gallery-page-header">
            <div>
              <p class="gallery-page-kicker">BOXING RECORD / ${escapeHtml(tab.id.toUpperCase())}</p>
              <h3>${escapeHtml(tab.label)}のアルバム</h3>
            </div>
            <p class="gallery-page-count"><strong>${unlockedCount}</strong><span>/ ${tabItems.length} OPEN</span></p>
          </header>
          ${renderGalleryMoveMemo(tab.id)}
          <div class="gallery-grid">${list}</div>
        </section>
      `;
    })
    .join("");

  app.innerHTML = `
    <main class="screen">
      <section class="panel gallery-card">
        <div class="gallery-album-heading">
          <div>
            <p class="eyebrow">${escapeHtml(TITLE_SCREEN.title)} ${escapeHtml(TITLE_SCREEN.subtitle)} / ARCHIVE</p>
            <h2>リングサイド・アルバム</h2>
            <p>ヒロインごとのシーズン記録を、1冊ずつめくって振り返れます。</p>
          </div>
          <div class="gallery-extras-entry">
            <button class="secondary-btn" data-action="open-spectator" ${extras.allCleared ? "" : "disabled"}>試合観戦モード${extras.allCleared ? "" : "（未解放）"}</button>
            <button class="secondary-btn" data-action="open-extras" ${extras.allCleared ? "" : "disabled"}>おまけ${extras.allCleared ? "" : "（未解放）"}</button>
            <small>${extras.allCleared ? "瑞花のゲームで遊ぶ" : `3人でギャルに勝つと解放（${extras.clearedHeroineIds.length}/3）`}</small>
          </div>
        </div>
        <div class="gallery-album-shell">
          <div class="gallery-album-binding" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <div class="gallery-album-body">
            <div class="gallery-album-tabs" role="tablist" aria-label="ギャラリーのアルバムを選ぶ">
              ${tabButtons}
            </div>
            ${albumPages}
          </div>
        </div>
        <div class="footer-actions">
          <span class="hint">未開放の写真ポケットは、対応するエンド到達で開きます。</span>
          <button class="back-btn" data-action="back-title">タイトルへ戻る</button>
        </div>
      </section>
    </main>
  `;
}

function renderGalleryDetail() {
  const item = getGalleryItems().find((galleryItem) => galleryItem.id === state.selectedGalleryId);
  if (!item || !item.unlocked) {
    state.screen = "gallery";
    render();
    return;
  }

  const commentMarkup = item.comments
    .map((comment) => `<div class="dialog-text"><strong>${comment.speaker}</strong>\n${comment.text}</div>`)
    .join("");

  app.innerHTML = `
    <main class="screen">
      <section class="gallery-detail-layout">
        <div class="panel art-card">
          ${renderMediaSlot({
            src: getGalleryDisplayImage(item),
            alt: item.title,
            placeholderClass: "stage",
            title: item.title,
            body: "ここに開放済みCGの実画像が入ります。",
          })}
        </div>
        <article class="panel detail-card">
          <p class="eyebrow">ギャラリー詳細</p>
          <h2>${item.title}</h2>
          <p class="gallery-copy">${item.description}</p>
          ${commentMarkup}
          <div class="footer-actions">
            <button class="back-btn" data-action="back-gallery">一覧へ戻る</button>
          </div>
        </article>
      </section>
    </main>
  `;
}

function render() {
  clearPixelActors();
  clearVictoryAnimation();
  if (state.screen === "title") renderTitle();
  if (state.screen === "extras-title") renderExtrasTitle();
  if (state.screen === "spectator-setup") renderSpectatorSetup();
  if (state.screen === "spectator-battle") renderSpectatorBattle();
  if (state.screen === "new-game-confirm") renderNewGameConfirm();
  if (state.screen === "character-select") renderCharacterSelect();
  if (state.screen === "dialogue") renderDialogue();
  if (state.screen === "hidden-intro") renderHiddenIntro();
  if (state.screen === "conversation") renderConversation();
  if (state.screen === "game") {
    if (state.currentStage.mode === "training") renderTrainingGame();
    else renderGame();
  }
  if (state.screen === "victory-fight") {
    playActionSequence(app, state.currentStage.victorySequence, () => {
      state.screen = "ending";
      render();
    });
  }
  if (state.screen === "yarisugi-fight") {
    playActionSequence(app, state.currentStage.yarisugiSequence, () => {
      state.screen = "ending";
      render();
    });
  }
  if (state.screen === "campaign-battle") renderCampaignBattleScene();
  if (state.screen === "ending") {
    renderEnding();
    if (isFinalCampaignOutcome(state.campaign?.outcome)) clearCampaignSave();
  }
  if (state.screen === "gallery") renderGallery();
  if (state.screen === "gallery-detail") renderGalleryDetail();
  if (state.screen === "sound-settings") renderSoundSettings();
  if (state.screen === "dev-preview") renderDeveloperPreview();
  if (state.screen === "opening-sequence") {
    playActionSequence(app, state.currentStage.opening, () => {
      startNewRun();
    });
  }

  localizeUI(app);
  mountPixelActors(app);
  renderMoveAnnouncement();
  syncBgmForScreen();
  const screenChanged = lastRenderedScreen !== state.screen;
  lastRenderedScreen = state.screen;
  const focusCampaignScreen = (
    ["title", "extras-title", "spectator-setup", "new-game-confirm", "character-select", "dialogue", "hidden-intro", "gallery", "gallery-detail", "dev-preview", "sound-settings"].includes(state.screen)
    || (state.screen === "game" && state.currentStage?.mode === "training")
    || (state.screen === "ending" && Boolean(state.campaign))
  );
  if (screenChanged && focusCampaignScreen) {
    requestAnimationFrame(() => {
      const screen = app.querySelector("main");
      if (!screen) return;
      screen.tabIndex = -1;
      screen.focus({ preventScroll: true });
    });
  }
}

function syncBgmForScreen() {
  // The bonus fight sequence times its music to the fight and story phases.
  if (["opening-sequence", "victory-fight", "yarisugi-fight"].includes(state.screen)) return;
  if (state.screen === "hidden-intro" || (state.screen === "ending" && state.campaign?.outcome === "hidden-offer" && state.campaign.hiddenIntroSeen === true)) {
    stopBgm();
    return;
  }
  if (state.screen !== "dialogue") lastDialogueSoundLine = null;
  const hiddenScreen = state.currentStage?.mode === "hidden"
    && ["conversation", "game", "victory-fight", "yarisugi-fight", "ending"].includes(state.screen);
  if (hiddenScreen) {
    stopBgm();
    return;
  }
  if (state.screen === "dialogue" && state.dialogue) {
    const line = state.dialogue.lines[state.dialogue.index];
    if (line && line !== lastDialogueSoundLine) {
      lastDialogueSoundLine = line;
      if (line.se) playConfiguredSfx(line.se, { builtin: true });
    }
    if (line?.bgm === "none") stopBgm();
    else if (line?.bgm) playBgm(line.bgm, { builtin: true });
    else playBgm("training");
    return;
  }
  if (state.screen === "campaign-battle" || (state.screen === "spectator-battle" && state.spectatorActive)) {
    playBgm("battle");
    return;
  }
  if (["dialogue", "conversation", "game", "ending"].includes(state.screen)) {
    playBgm("training");
    return;
  }
  if (state.screen === "sound-settings" && state.soundReturnScreen === "game") {
    if (state.currentStage?.mode === "hidden") stopBgm();
    else playBgm("training");
    return;
  }
  playBgm("title");
}

function clearVictoryAnimation() {
  if (victoryAnimationTimer) {
    clearTimeout(victoryAnimationTimer);
    victoryAnimationTimer = null;
  }
}

function updateVictorySprite(key) {
  state.fightSpriteKey = key;
  const stage = state.currentStage;
  const sprite = stage.assets.fightSprites?.[key] ?? "";
  const image = document.querySelector(".victory-fighter-image");
  const fallback = document.querySelector(".victory-fighter-fallback");

  if (!image || !fallback) {
    return;
  }

  image.classList.remove("fight-sprite-swap");
  void image.offsetWidth;
  image.src = assetUrl(sprite);
  image.style.display = "";
  fallback.style.display = "none";
  image.classList.add("fight-sprite-swap");
}

function startVictoryAnimation() {
  clearVictoryAnimation();

  if (state.screen !== "victory-fight") {
    return;
  }

  const sequence = state.currentStage.assets.fightSequence ?? [];
  if (!sequence.length) {
    return;
  }

  let index = 0;

  const step = () => {
    if (state.screen !== "victory-fight") {
      clearVictoryAnimation();
      return;
    }

    const frame = sequence[index];
    updateVictorySprite(frame.key);
    index = (index + 1) % sequence.length;
    victoryAnimationTimer = setTimeout(step, frame.duration);
  };

  step();
}

function startNewRun() {
  clearVictoryAnimation();
  state.currentStage = STAGES[0];
  state.game = createGameState(state.currentStage);
  state.pendingCommandId = null;
  state.conversationIndex = 0;
  state.fightSpriteKey = "stance";
  state.screen = "game";
  render();
}

function beginNewGameFlow() {
  clearVictoryAnimation();
  state.game = null;
  state.campaign = null;
  state.pendingCommandId = null;
  state.conversationIndex = 0;
  state.selectedGalleryId = null;
  state.selectedTrainingCharacterId = state.selectedTrainingCharacterId || TRAINING_CHARACTERS[0].id;
  const opening = CONTENT.campaign.coachOpening;
  state.dialogue = opening?.lines?.length ? { lines: opening.lines, index: 0, after: "select-heroine" } : null;
  state.screen = state.dialogue ? "dialogue" : "character-select";
  render();
}

function enterGame() {
  clearVictoryAnimation();
  state.game = createGameState(state.currentStage);
  state.pendingCommandId = null;
  state.screen = "game";
  render();
}

function getTrainingStage(characterId) {
  return (
    STAGES.find((stage) => stage.id === characterId && stage.mode === "training")
    ?? STAGES.find((stage) => stage.mode === "training")
  );
}

// 既読会話の自動スキップ（DEC-055 #9）。誰か1人で王者突破済みなら新規開始時に選べる。
function canOfferReadSkip() {
  const reached = new Set(loadReachedEndings());
  return Object.keys(CONTENT.heroines ?? {}).some((heroineId) => hasBeatenChampion(heroineId, reached));
}

// 周回でONにしていて既読IDなら会話を表示せず、通常の後続処理へ進む。未読は必ず表示する。
function shouldSkipDialogue(id) {
  if (!id) return false;
  const enabled = state.campaign ? Boolean(state.campaign.skipReadDialogues) : Boolean(state.readSkipChoice);
  return enabled && hasSeenDialogue(id);
}

// キャラ確定 → 導入会話があれば先に流し、その後で育成開始。
function beginTrainingWithIntro() {
  const character = getSelectedTrainingCharacter();
  const intro = CONTENT.heroines[character.id]?.intro ?? [];
  const id = `intro:${character.id}`;
  if (intro.length && !shouldSkipDialogue(id)) {
    state.dialogue = { id, lines: intro, index: 0, after: "start-campaign" };
    state.screen = "dialogue";
    render();
  } else {
    startCampaign();
  }
}

function getCampaignRound(roundId) {
  return [...(CONTENT.campaign.rounds ?? []), CONTENT.campaign.hiddenRound]
    .filter(Boolean)
    .find((round) => round.id === roundId) ?? null;
}

function getCampaignSchedule() {
  return {
    weeksPerFight: CONTENT.campaign.schedule?.weeksPerFight ?? 4,
    maxFights: CONTENT.campaign.schedule?.maxFights ?? 4,
  };
}

function getCampaignEndingVariant(campaign, type) {
  const variants = CONTENT.campaign.endingVariants?.[campaign.heroineId] ?? {};
  if (type !== "normal") return variants[type] ?? null;
  const clearedCount = campaign.clearedRegularRoundIds?.length ?? 0;
  const tiers = [...(CONTENT.campaign.normalEndingTiers ?? [])]
    .sort((a, b) => (b.minClearedRegularRounds ?? 0) - (a.minClearedRegularRounds ?? 0));
  const tier = tiers.find((item) => clearedCount >= (item.minClearedRegularRounds ?? 0));
  return variants[tier?.variantKey ?? "normal"] ?? variants.normal ?? null;
}

function finishCampaignWith(type, roundDescription = "") {
  const campaign = state.campaign;
  if (!campaign || !state.game) return;
  const fallbackText = CONTENT.campaign.outcomeText ?? {};
  const fallbackTitles = fallbackText.fallbackTitles ?? {
    normal: "ノーマルエンド",
    good: "グッドエンド",
    true: "トゥルーエンド",
    epilogue: "エピローグ",
    default: "キャンペーン終了",
  };
  const variant = getCampaignEndingVariant(campaign, type) ?? {
    id: `campaign-${campaign.heroineId}-${type}`,
    title: fallbackTitles[type] ?? fallbackTitles.default ?? "キャンペーン終了",
    description: fallbackText.fallbackDescription ?? "キャンペーンの戦績が記録された。",
    image: state.game.ending?.image ?? "",
  };
  campaign.outcome = type;
  campaign.pendingRoundId = null;
  state.game.ending = {
    ...variant,
    description: [roundDescription, variant.description].filter(Boolean).join("\n\n"),
  };
  if (variant.galleryId && unlockGalleryItem(variant.galleryId, variant.id)) {
    playSfx("unlock");
  }
  state.screen = "ending";
}
// These conversations only present an already recorded result; never settle it again.
function beginCampaignDialogue(id, lines, after) {
  const campaign = state.campaign;
  if (!campaign || !lines?.length || campaign.firedEventIds.includes(id)) return false;
  campaign.firedEventIds.push(id);
  if (shouldSkipDialogue(id)) return false;
  state.dialogue = { id, lines, index: 0, after, background: hiddenIntroBackground() };
  state.screen = "dialogue";
  persistCampaignSave("dialogue");
  render();
  return true;
}

function showCampaignEnding() {
  const campaign = state.campaign;
  if (campaign?.outcome === "true" && campaign.currentRoundId === CONTENT.campaign.hiddenRound.id) {
    const lines = CONTENT.campaign.endingVariants[campaign.heroineId]?.true?.beforeLines;
    if (beginCampaignDialogue(`true-before:${campaign.heroineId}`, lines, "show-campaign-ending")) return;
  }
  state.screen = "ending";
  render();
}

function isFinalCampaignOutcome(outcome) {
  return ["normal", "good", "true", "epilogue"].includes(outcome);
}

function applyCornerProgressToStage(stage, heroineId) {
  const opponent = stage?.opponent;
  if (!opponent || !heroineId) return stage;
  const progress = getCornerProgress(heroineId, opponent.id ?? stage.campaignRound?.opponentId);
  const baseThresholds = { ...(opponent.baseThresholds ?? opponent.thresholds ?? opponent) };
  opponent.baseThresholds = baseThresholds;
  opponent.cornerProgress = progress;
  opponent.thresholds = getEffectiveCornerThresholds(baseThresholds, progress);
  return stage;
}

function persistCampaignSave(screen = state.screen) {
  if (state.screen === "hidden-intro") return false;
  if (!state.campaign || !state.currentStage?.campaignRound || !state.game) return false;
  const snapshot = {
    version: SAVE_VERSION,
    screen,
    heroineId: state.campaign.heroineId,
    roundId: state.currentStage.campaignRound.id,
    campaign: { ...state.campaign, stats: { ...state.campaign.stats } },
    game: { ...state.game, stats: { ...state.game.stats }, flags: { ...state.game.flags }, ending: state.game.ending ? { ...state.game.ending } : null },
    ending: state.game.ending ? { ...state.game.ending } : null,
  };
  if (screen === "dialogue" && state.dialogue) snapshot.dialogue = { ...state.dialogue, lines: [...state.dialogue.lines] };
  return saveCampaignProgress(snapshot);
}

function restoreCampaignSave() {
  const snapshot = loadCampaignSave();
  const heroine = snapshot && CONTENT.heroines[snapshot.heroineId];
  const round = snapshot && getCampaignRound(snapshot.roundId);
  if (!snapshot || !heroine || !round || snapshot.campaign.heroineId !== snapshot.heroineId) {
    if (snapshot) clearCampaignSave();
    return false;
  }
  const stage = applyCornerProgressToStage(
    createCampaignStage(snapshot.heroineId, round, snapshot.campaign.stats, () => state.campaign),
    snapshot.heroineId,
  );
  const turn = Number(snapshot.game.turn);
  if (!Number.isInteger(turn) || turn < 1 || turn > stage.turnLimit || snapshot.game.stageId !== stage.id) {
    clearCampaignSave();
    return false;
  }
  const baseGame = createGameState(stage, snapshot.game.stats);
  state.currentStage = stage;
  state.game = {
    ...baseGame, ...snapshot.game,
    stats: { ...snapshot.game.stats },
    flags: { ...baseGame.flags, ...(snapshot.game.flags ?? {}) },
    statLimits: stage.statLimits,
    stageUiText: stage.uiText,
    ending: snapshot.ending ?? snapshot.game.ending ?? null,
  };
  state.campaign = {
    ...snapshot.campaign,
    isRevenge: isSavedRevengeAttempt(snapshot.campaign, state.game, CONTENT.campaign.hiddenRound?.id),
    hiddenIntroSeen: snapshot.campaign.hiddenIntroSeen === true,
    heroineId: snapshot.heroineId,
    stats: { ...snapshot.campaign.stats },
    results: [...(snapshot.campaign.results ?? [])],
    clearedRegularRoundIds: [...(snapshot.campaign.clearedRegularRoundIds ?? [])],
    firedEventIds: [...(snapshot.campaign.firedEventIds ?? [])],
  };
  state.campaign.announcedMoveIds ??= getAcquiredMoves(CONTENT.heroines[snapshot.heroineId], state.game.stats, state.campaign).map(move => move.id);
  state.hiddenIntro = null;
  state.hiddenChallengeFresh = false;
  if (state.campaign.outcome === "hidden-offer" && !state.campaign.hiddenIntroSeen) {
    state.game.ending = { ...state.game.ending, title: stage.endings.ko.title, description: state.campaign.lastRoundDescription || stage.endings.ko.description };
  }
  state.firedEventIds = state.campaign.firedEventIds;
  state.selectedTrainingCharacterId = snapshot.heroineId;
  state.pendingCommandId = null;
  state.battleResult = null;
  state.battleSceneActive = false;
  state.dialogue = snapshot.screen === "dialogue" ? snapshot.dialogue : null;
  if (state.dialogue?.paper && stage.opponent?.portrait
      && state.dialogue.id === `prefight:${snapshot.heroineId}:${snapshot.roundId}`) {
    // Introduction saves keep their line/index, but use the current approved photo.
    state.dialogue.paper = { ...state.dialogue.paper, image: stage.opponent.portrait };
    // Shared introduction metadata may have been corrected since this save.
    // Match the unchanged source line, keeping saved text and the reading position.
    for (const [index, source] of (stage.opponent.preFight ?? []).entries()) {
      const saved = state.dialogue.lines[index];
      if (!saved || saved.text !== source.text || saved.speaker !== source.speaker) continue;
      if (source.characterId) saved.characterId = source.characterId;
      else delete saved.characterId;
    }
  }
  state.screen = snapshot.screen === "dialogue" && state.dialogue ? "dialogue" : snapshot.screen === "ending" ? "ending" : "game";
  // Older saves may be inside the normal opponent intro after accepting a retry.
  // That fight has already been counted; resume its training without starting it again.
  if (state.campaign.isRevenge && !state.game.finished && state.game.turn === 1
      && state.dialogue?.after === "start-round-game"
      && state.dialogue.id === `prefight:${snapshot.heroineId}:${snapshot.roundId}`) {
    state.dialogue = null;
    state.screen = "game";
    persistCampaignSave("game");
  }
  // 旧条件で保存された未選択の挑戦状も、現在の戦績条件で再判定する。
  if (state.campaign.outcome === "hidden-offer" && !canChallengeHiddenRound(state.campaign)) {
    state.dialogue = null;
    finishCampaignWith("good");
    clearCampaignSave();
  }
  if (state.screen === "ending" && state.campaign.outcome === "true") showCampaignEnding();
  else render();
  return true;
}

function renderNewGameConfirm() {
  app.innerHTML = `
    <main class="screen title-screen">
      <section class="panel title-card new-game-confirm-card">
        <p class="eyebrow">CAMPAIGN SAVE</p>
        <h2>新しいキャンペーンを始めますか？</h2>
        <p class="lead">保存中の育成記録は消えます。この操作は取り消せません。</p>
        <div class="title-button-row" aria-label="新規ゲーム確認">
          <button class="primary-btn title-menu-button" data-action="confirm-new-game">保存を消して始める</button>
          <button class="secondary-btn title-menu-button" data-action="cancel-new-game">戻る</button>
        </div>
      </section>
    </main>
  `;
}


function startCampaign() {
  const heroine = CONTENT.heroines[state.selectedTrainingCharacterId];
  const firstRound = CONTENT.campaign.rounds?.[0];
  state.campaign = {
    heroineId: state.selectedTrainingCharacterId,
    stats: { ...heroine.initialStats },
    roundIndex: 0,
    currentRoundId: firstRound?.id ?? null,
    pendingRoundId: null,
    results: [],
    clearedRegularRoundIds: [],
    fightCount: 0,
    weeksElapsed: 0,
    lastRoundDescription: "",
    firedEventIds: [],
    outcome: null,
    skipReadDialogues: Boolean(state.readSkipChoice),
    yukitoGuide: createYukitoGuide(CONTENT.campaign.yukitoGuide, canUseYukitoGuide() && state.yukitoGuideChoice),
    announcedMoveIds: [],
    pendingMoveIds: [],
  };
  state.firedEventIds = state.campaign.firedEventIds;
  if (firstRound) startCampaignRound(firstRound);
  else startTrainingRun();
}

function startCampaignRound(round, { revenge = false, deferRender = false } = {}) {
  clearVictoryAnimation();
  const campaign = state.campaign;
  const { maxFights } = getCampaignSchedule();
  if (campaign.fightCount >= maxFights) {
    finishCampaignWith("normal", campaign.lastRoundDescription);
    render();
    return;
  }
  campaign.fightCount += 1;
  campaign.currentRoundId = round.id;
  campaign.isRevenge = revenge;
  campaign.pendingRoundId = null;
  campaign.outcome = null;
  const regularIndex = CONTENT.campaign.rounds.findIndex((item) => item.id === round.id);
  campaign.roundIndex = regularIndex >= 0 ? regularIndex : CONTENT.campaign.rounds.length;
  state.currentStage = applyCornerProgressToStage(
    createCampaignStage(campaign.heroineId, round, campaign.stats, () => state.campaign),
    campaign.heroineId,
  );
  state.game = createGameState(state.currentStage, campaign.stats);
  state.pendingCommandId = null;
  state.fightSpriteKey = "stance";
  // 試合前の相手紹介（DEC-055 #10）: 相手の preFight に、ヒロイン別×ラウンド別の反応を続け、相手の絵を紙として大きく見せる。
  const opponent = state.currentStage.opponent;
  const heroineReaction = CONTENT.heroines[campaign.heroineId]?.opponentIntro?.[round.id] ?? [];
  const lines = [...(opponent?.preFight ?? []), ...heroineReaction];
  const preFightId = `prefight:${campaign.heroineId}:${round.id}`;
  if (!revenge && lines.length && !shouldSkipDialogue(preFightId)) {
    const paper = opponent?.portrait
      ? { image: opponent.portrait, name: opponent.name, label: round.label ?? "" }
      : null;
    state.dialogue = { id: preFightId, lines, index: 0, after: "start-round-game", paper };
    state.screen = "dialogue";
  } else {
    state.dialogue = null;
    state.screen = "game";
  }
  if (!deferRender) render();
  persistCampaignSave(state.screen);
}

function beginCampaignRevenge(round) {
  const { maxFights } = getCampaignSchedule();
  if (state.revengeAnimationActive || !state.campaign || state.campaign.fightCount >= maxFights) return;
  const parent = app.querySelector(".pixel-result") ?? app.querySelector(".ending-card");
  state.revengeAnimationActive = true;
  // Save the accepted retry once, before the optional visual. Reload resumes
  // the new training week rather than charging another fight or replaying the intro.
  startCampaignRound(round, { revenge: true, deferRender: true });
  app.querySelectorAll("button, input").forEach(node => { node.disabled = true; });
  const complete = () => { state.revengeAnimationActive = false; render(); };
  if (parent) playPixelRevenge(parent, state.campaign.heroineId, complete);
  else complete();
}

function startTrainingRun() {
  clearVictoryAnimation();
  const stage = getTrainingStage(state.selectedTrainingCharacterId);
  state.currentStage = stage;
  state.game = createGameState(stage);
  state.pendingCommandId = null;
  state.fightSpriteKey = "stance";
  state.dialogue = null;
  state.firedEventIds = [];
  state.screen = "game";
  render();
}

function advanceDialogue() {
  if (!state.dialogue) return;
  if (state.dialogue.index < state.dialogue.lines.length - 1) {
    state.dialogue.index += 1;
    persistCampaignSave("dialogue");
    render();
  } else {
    finishDialogue();
  }
}

function finishDialogue() {
  const after = state.dialogue?.after;
  if (state.dialogue?.id) markDialogueSeen(state.dialogue.id);
  state.dialogue = null;
  if (after?.startsWith("hidden-intro-")) {
    finishHiddenIntroDialogue(after);
    return;
  }
  if (after === "start-hidden-intro-signal") {
    startHiddenIntroSignal();
  } else if (after === "show-campaign-ending") {
    showCampaignEnding();
  } else if (after === "select-heroine") {
    state.screen = "character-select";
    render();
  } else if (after === "start-campaign") {
    startCampaign();
  } else if (after === "start-round-game") {
    state.screen = "game";
    persistCampaignSave("game");
    render();
  } else if (after === "continue-next-round") {
    const round = getCampaignRound(state.campaign?.queuedRoundId);
    if (state.campaign) state.campaign.queuedRoundId = null;
    if (round) startCampaignRound(round);
    else {
      state.screen = "title";
      render();
    }
  } else if (after === "resume-game") {
    // Preserve earlier same-week events, including legacy saves without their fired IDs.
    if (maybeShowTrainingEvent()) {
      persistCampaignSave("dialogue");
      return;
    }
    state.screen = "game";
    persistCampaignSave("game");
    render();
  } else {
    state.screen = "title";
    render();
  }
}

function beginPendingCampaignRound() {
  const campaign = state.campaign;
  const round = getCampaignRound(campaign?.pendingRoundId);
  if (!campaign || !round) return;
  const heroine = CONTENT.heroines[campaign.heroineId];
  const event = (heroine.stageEvents ?? []).find((item) => (
    item.afterRound === campaign.currentRoundId
    && !campaign.firedEventIds.includes(item.id)
    && (item.chance == null || Math.random() < item.chance)
  ));
  if (!event?.lines?.length) {
    startCampaignRound(round);
    return;
  }
  campaign.firedEventIds.push(event.id);
  if (shouldSkipDialogue(event.id)) {
    startCampaignRound(round);
    return;
  }
  campaign.queuedRoundId = round.id;
  state.dialogue = { id: event.id, lines: event.lines, index: 0, after: "continue-next-round" };
  state.screen = "dialogue";
  persistCampaignSave("dialogue");
  render();
}

// 育成中イベント：現在ターンに対応する未発火イベントがあれば会話を表示する。
function maybeShowTrainingEvent() {
  if (state.currentStage.mode !== "training" || !state.game) return false;
  const character = getSelectedTrainingCharacter();
  const events = CONTENT.heroines[character.id]?.events ?? [];
  const turn = state.game.turn;
  const roundId = state.campaign?.currentRoundId;
  const event = events.find((e) => (
    e.turn === turn
    && (e.round == null || e.round === roundId)
    && !state.firedEventIds.includes(e.id)
  ));
  if (!event) return false;
  const priorMoves = new Set(currentAcquiredMoves(CONTENT.heroines[character.id], state.game.stats).map(move => move.id));
  state.firedEventIds.push(event.id);
  queueMoveAnnouncements(currentAcquiredMoves(CONTENT.heroines[character.id], state.game.stats).filter(move => !priorMoves.has(move.id)));
  if (shouldSkipDialogue(event.id)) return maybeShowTrainingEvent();
  state.dialogue = { id: event.id, lines: trainingEventLines(CONTENT.heroines[character.id], event, state.game.lastAction), index: 0, after: "resume-game" };
  state.screen = "dialogue";
  render();
  return true;
}

function finishCampaignRound() {
  const campaign = state.campaign;
  const round = state.currentStage.campaignRound;
  const result = state.game.ending.id;
  const roundDescription = state.game.ending.description;
  const { weeksPerFight, maxFights } = getCampaignSchedule();
  campaign.stats = { ...state.game.stats };
  campaign.weeksElapsed += round.trainingTurns ?? weeksPerFight;
  campaign.lastRoundDescription = roundDescription;
  campaign.results.push({
    fight: campaign.fightCount,
    weeksElapsed: campaign.weeksElapsed,
    roundId: round.id,
    result,
    revenge: campaign.isRevenge === true,
    ...(state.game.ending.knockout ? { knockout: true } : {}),
  });
  const opponentId = state.currentStage.opponent?.id ?? round.opponentId;
  const previousCorner = getCornerProgress(campaign.heroineId, opponentId);
  const updatedCorner = recordCornerProgress(
    campaign.heroineId,
    state.currentStage.opponent?.id ?? round.opponentId,
    result,
    { stats: state.game.stats, opponent: state.currentStage.opponent },
  );
  campaign.cornerNotice = updatedCorner.winMarks > previousCorner.winMarks ? { color: "red" }
    : updatedCorner.koMarks > previousCorner.koMarks ? { color: "blue" } : null;
  campaign.yukitoIntroduction = null;
  const advance = (CONTENT.campaign.advanceOn ?? ["win", "ko"]).includes(result);
  const hasFightSlot = campaign.fightCount < maxFights;
  const hidden = CONTENT.campaign.hiddenRound;
  const regularRounds = CONTENT.campaign.rounds ?? [];
  const championRoundId = hidden?.unlock?.afterRound ?? regularRounds[regularRounds.length - 1]?.id;

  if (round.id === hidden?.id) {
    campaign.yukitoIntroduction = recordYukitoIntroduction(advance, hasPreviousYukitoEncounter());
    finishCampaignWith(advance ? "true" : "epilogue", roundDescription);
    return;
  }

  if (!advance) {
    campaign.pendingRoundId = null;
    if (!hasFightSlot) {
      finishCampaignWith("normal", roundDescription);
    } else {
      campaign.outcome = "revenge-offer";
      state.screen = "ending";
    }
    return;
  }

  if (!campaign.clearedRegularRoundIds.includes(round.id)) {
    campaign.clearedRegularRoundIds.push(round.id);
  }

  if (round.id === championRoundId) {
    const canChallengeHidden = canChallengeHiddenRound(campaign);
    if (canChallengeHidden) {
      campaign.outcome = "hidden-offer";
      campaign.pendingRoundId = hidden.id;
      campaign.hiddenIntroSeen = false;
    } else {
      finishCampaignWith("good", roundDescription);
    }
    state.screen = "ending";
    return;
  }

  const currentIndex = CONTENT.campaign.rounds.findIndex((item) => item.id === round.id);
  const nextRound = CONTENT.campaign.rounds[currentIndex + 1];
  if (nextRound && hasFightSlot) {
    campaign.outcome = null;
    campaign.pendingRoundId = nextRound.id;
  } else {
    finishCampaignWith("normal", roundDescription);
  }
  state.screen = "ending";
}

function finishGameIfNeeded() {
  if (!state.game?.finished || !state.game.ending) {
    return;
  }
  const stage = state.currentStage;
  const ending = state.game.ending;

  if (stage.campaignRound && state.campaign) {
    state.pendingCommandId = null;
    const battleResult = ending.id;
    state.battleKnockoutWinner = ending.knockout ? "right" : ending.id === "ko" ? "left" : null;
    finishCampaignRound();
    state.battleResult = battleResult;
    persistCampaignSave("ending");
    state.battleSceneActive = false;
    state.screen = "campaign-battle";
    render();
    return;
  }

  // 隠しモードのみ OP チャンピオンギャラリーを開放する。
  if (stage.mode === "hidden") {
    unlockGalleryItem("opening-champion", "opening-champion");
  }
  if (ending.galleryId) {
    unlockGalleryItem(ending.galleryId, ending.id);
  }

  state.pendingCommandId = null;
  // Hidden modeの固定シネマ。育成キャンペーンは上のcampaign-battle経路を使う。
  if (stage.mode === "hidden" && ending.id === "victory") {
    state.screen = "victory-fight";
  } else if (stage.mode === "hidden" && ending.id === "foul") {
    state.screen = "yarisugi-fight";
  } else {
    state.screen = "ending";
  }
  render();
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action], [data-command], [data-gallery-id]");
  if (!target) return;
  if (state.trainingAnimationActive || state.revengeAnimationActive) return;

  const action = target.dataset.action;
  const commandId = target.dataset.command;
  const galleryId = target.dataset.galleryId;
  const endingId = target.dataset.endingId;
  unlockAudio();
  if (action !== "toggle-audio") {
    const backActions = ["back-title", "back-gallery", "back-character-select", "cancel-command", "cancel-new-game"];
    playSfx(backActions.includes(action) ? "uiBack" : "uiConfirm");
  }

  if (action === "set-language") {
    setLanguage(target.dataset.language);
    renderSoundSettings();
    localizeUI(app);
    app.querySelector(`[data-language="${getLanguage()}"]`)?.focus({ preventScroll: true });
    return;
  }

  if (action === "open-sound-settings") {
    state.soundReturnScreen = state.screen === "game" ? "game" : "title";
    state.cornerResetPending = false;
    state.cornerResetDone = false;
    state.screen = "sound-settings";
    render();
    return;
  }

  if (action === "close-sound-settings") {
    state.screen = state.soundReturnScreen;
    render();
    return;
  }

  if (action === "toggle-audio") {
    const next = setAudioSettings({ muted: !getAudioSettings().muted });
    renderSoundSettings();
    if (!next.muted) playSfx("uiConfirm");
    return;
  }

  if (action === "toggle-bgm") {
    setAudioSettings({ bgmMuted: !getAudioSettings().bgmMuted });
    renderSoundSettings();
    syncBgmForScreen();
    return;
  }

  if (action === "request-reset-corner-progress") {
    state.cornerResetPending = true;
    state.cornerResetDone = false;
    renderSoundSettings();
    return;
  }

  if (action === "cancel-reset-corner-progress") {
    state.cornerResetPending = false;
    renderSoundSettings();
    return;
  }

  if (action === "confirm-reset-corner-progress") {
    resetCornerProgress();
    state.cornerResetPending = false;
    state.cornerResetDone = true;
    renderSoundSettings();
    return;
  }

  if (action === "continue-campaign") {
    if (!restoreCampaignSave()) {
      state.screen = "title";
      render();
    }
    return;
  }

  if (action === "request-new-game") {
    state.screen = "new-game-confirm";
    render();
    return;
  }

  if (action === "cancel-new-game") {
    state.screen = "title";
    render();
    return;
  }

  if (action === "confirm-new-game") {
    clearCampaignSave();
    beginNewGameFlow();
    return;
  }

  if (action === "start-game") {
    beginNewGameFlow();
    return;
  }

  if (action === "skip-op") {
    beginNewGameFlow();
    return;
  }

  if (action === "open-gallery") {
    clearVictoryAnimation();
    state.pendingCommandId = null;
    state.screen = "gallery";
    render();
    return;
  }

  if (["open-spectator", "spectator-setup", "spectator-play", "spectator-swap"].includes(action)) {
    if (!getGyaruClearProgress().allCleared || state.spectatorActive) return;
    if (action === "spectator-play") {
      if (!state.spectatorChoice || !["spectator-setup", "spectator-battle"].includes(state.screen)) return;
      state.spectatorCompleted = false;
      state.screen = "spectator-battle";
    } else {
      if (action === "spectator-swap" && state.screen === "spectator-setup") {
        const choice = state.spectatorChoice;
        [choice.leftId, choice.rightId] = [choice.rightId, choice.leftId];
        choice.winnerSide = choice.winnerSide === "left" ? "right" : "left";
      }
      state.screen = "spectator-setup";
    }
    render();
    return;
  }

  if (action === "open-extras" && getGyaruClearProgress().allCleared) {
    clearVictoryAnimation();
    state.campaign = null;
    state.dialogue = null;
    state.game = null;
    state.screen = "extras-title";
    render();
    return;
  }

  if (action === "start-extras" && state.screen === "extras-title" && getGyaruClearProgress().allCleared) {
    state.currentStage = STAGES[0];
    state.screen = "opening-sequence";
    render();
    return;
  }

  if (action === "switch-gallery-tab") {
    const galleryTab = target.dataset.galleryTab;
    if (GALLERY_ALBUM_TABS.some((tab) => tab.id === galleryTab)) {
      state.selectedGalleryTab = galleryTab;
      render();
      document.querySelector(`#gallery-tab-${galleryTab}`)?.focus();
    }
    return;
  }

  if (action === "open-dev-preview") {
    if (!DEV_PREVIEW_ENABLED) return;
    clearVictoryAnimation();
    state.screen = "dev-preview";
    render();
    return;
  }

  if (action === "debug-unlock-gallery") {
    if (!DEV_PREVIEW_ENABLED || !galleryId) return;
    const item = getGalleryItems().find(item => item.id === galleryId);
    if (item?.unlockOnView ? unlockEventArtwork(item.image) : unlockGalleryItem(galleryId, endingId)) {
      playSfx("unlock");
    }
    render();
    return;
  }

  if (action === "back-title") {
    clearHiddenIntroSignal();
    state.hiddenIntro = null;
    state.hiddenChallengeFresh = false;
    clearVictoryAnimation();
    state.screen = "title";
    state.selectedGalleryId = null;
    state.pendingCommandId = null;
    state.game = null;
    state.campaign = null;
    render();
    return;
  }

  if (action === "select-training-character") {
    state.selectedTrainingCharacterId = target.dataset.characterId || TRAINING_CHARACTERS[0].id;
    render();
    return;
  }

  if (action === "confirm-training-character") {
    beginTrainingWithIntro();
    return;
  }

  if (action === "dialogue-next") {
    advanceDialogue();
    return;
  }

  if (action === "hidden-intro-start") { beginHiddenIntro(); return; }
  if (action === "hidden-intro-skip") { finishHiddenIntroSignal(); return; }
  if (action === "hidden-intro-accept") { chooseHiddenChallenge("accept"); return; }
  if (action === "hidden-intro-decline") { chooseHiddenChallenge("decline"); return; }

  if (action === "next-campaign-round" && state.campaign?.pendingRoundId) {
    beginPendingCampaignRound();
    return;
  }

  if (action === "retry-campaign-round" && state.campaign?.outcome === "revenge-offer") {
    const round = getCampaignRound(state.campaign.currentRoundId);
    if (round && round.id !== CONTENT.campaign.hiddenRound?.id) beginCampaignRevenge(round);
    return;
  }

  if (action === "end-campaign-normal" && state.campaign?.outcome === "revenge-offer") {
    finishCampaignWith("normal", state.campaign.lastRoundDescription);
    render();
    return;
  }

  if (action === "end-campaign-good" && state.campaign?.outcome === "hidden-offer") {
    finishCampaignWith("good", state.campaign.lastRoundDescription);
    render();
    return;
  }

  if (action === "back-character-select") {
    state.screen = "character-select";
    render();
    return;
  }

  if (action === "next-line") {
    const stage = state.currentStage;
    if (state.conversationIndex < stage.introLines.length - 1) {
      state.conversationIndex += 1;
      render();
    } else {
      enterGame();
    }
    return;
  }

  if (action === "skip-opening") {
    enterGame();
    return;
  }

  if (action === "back-gallery") {
    clearVictoryAnimation();
    state.screen = "gallery";
    state.selectedGalleryId = null;
    render();
    return;
  }

  if (action === "cancel-command") {
    state.pendingCommandId = null;
    render();
    return;
  }

  if (action === "confirm-command" && state.game && state.pendingCommandId) {
    const commandId = state.pendingCommandId;
    if (!playTrainingCommandAnimation(commandId, () => completeCommandAction(commandId))) {
      completeCommandAction(commandId);
    }
    return;
  }

  if (action === "open-victory-ending") {
    clearVictoryAnimation();
    state.screen = "ending";
    render();
    return;
  }

  if (commandId && state.game) {
    state.pendingCommandId = commandId;
    render();
    return;
  }

  if (galleryId) {
    state.selectedGalleryId = galleryId;
    state.screen = "gallery-detail";
    render();
  }
});
app.addEventListener("input", (event) => {
  const sfxSlider = event.target.closest?.("[data-audio-volume]");
  const bgmSlider = event.target.closest?.("[data-bgm-volume]");
  if (!sfxSlider && !bgmSlider) return;
  const slider = sfxSlider ?? bgmSlider;
  const volume = Math.min(100, Math.max(0, Number(slider.value) || 0));
  const next = setAudioSettings(sfxSlider ? { volume: volume / 100 } : { bgmVolume: volume / 100 });
  const output = app.querySelector(sfxSlider ? "[data-audio-volume-output]" : "[data-bgm-volume-output]");
  if (output) output.textContent = `${Math.round((sfxSlider ? next.volume : next.bgmVolume) * 100)}%`;
});

app.addEventListener("change", (event) => {
  const spectator = event.target.closest?.("[data-spectator-field]");
  if (spectator && state.screen === "spectator-setup") {
    const field = spectator.dataset.spectatorField;
    if (!["leftId", "rightId", "winnerSide", "finishType", "special"].includes(field)) return;
    state.spectatorChoice[field] = field === "special" ? spectator.value === "true" : spectator.value;
    renderSpectatorSetup();
    document.getElementById(spectator.id)?.focus({ preventScroll: true });
    return;
  }
  const guideChoice = event.target.closest?.("[data-yukito-guide]");
  if (guideChoice) {
    if (state.campaign) {
      state.campaign.yukitoGuide ??= { enabled: false };
      state.campaign.yukitoGuide.enabled = Boolean(guideChoice.checked);
      persistCampaignSave();
    } else state.yukitoGuideChoice = Boolean(guideChoice.checked);
    render();
    return;
  }
  const readSkip = event.target.closest?.("[data-read-skip]");
  if (readSkip) {
    state.readSkipChoice = Boolean(readSkip.checked);
    return;
  }
  const slider = event.target.closest?.("[data-audio-volume], [data-bgm-volume]");
  if (!slider) return;
  unlockAudio();
  playSfx("uiConfirm");
});


app.addEventListener("pointerup", (event) => {
  unlockAudio();
  const interactive = event.target.closest("button");
  if (interactive) return;

  if (state.screen === "hidden-intro") {
    if (state.hiddenIntro?.phase === "signal") finishHiddenIntroSignal();
    else if (state.hiddenIntro?.phase === "dialogue") advanceDialogue();
    return;
  }
  app.querySelector(".hidden-challenge-screen.is-fresh")?.classList.remove("is-fresh");

  // 育成の導入会話・イベント：画面タップで進行。
  if (state.screen === "dialogue") {
    playSfx("uiConfirm");
    advanceDialogue();
    return;
  }

  if (state.screen !== "conversation") return;
  playSfx("uiConfirm");

  const stage = state.currentStage;
  if (state.conversationIndex < stage.introLines.length - 1) {
    state.conversationIndex += 1;
    render();
  } else {
    enterGame();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.repeat || !["Enter", " "].includes(event.key)) return;
  if (state.screen === "hidden-intro" && state.hiddenIntro?.phase !== "battle") {
    event.preventDefault();
    if (state.hiddenIntro?.phase === "signal") finishHiddenIntroSignal();
    else if (state.hiddenIntro?.phase === "dialogue") advanceDialogue();
  } else if (state.screen === "ending") {
    app.querySelector(".hidden-challenge-screen.is-fresh")?.classList.remove("is-fresh");
  }
});

observeLocalizedUI(app);
render();

function createFlyText(text, isPositive, container) {
  const el = document.createElement("div");
  el.className = `fly-text ${isPositive ? 'positive' : 'negative'}`;
  el.textContent = text;
  
  // Random slight variations in starting position
  const xOffset = Math.random() * 40 - 20;
  const yOffset = Math.random() * 20 - 10;
  el.style.left = `calc(50% + ${xOffset}px)`;
  el.style.top = `calc(50% + ${yOffset}px)`;
  
  container.appendChild(el);
  
  // Remove after animation completes (1.2s)
  setTimeout(() => {
    el.remove();
  }, 1200);
}

function triggerFlyTexts(prevStats, nextStats) {
  const playerSide = document.querySelector(".duel-side-player .side-core");
  const rivalSide = document.querySelector(".duel-side-rival .side-core");
  
  if (!playerSide || !rivalSide) return;
  
  // Create relative positioning containers
  const playerContainer = document.createElement("div");
  playerContainer.className = "fly-text-container";
  playerSide.appendChild(playerContainer);
  
  const rivalContainer = document.createElement("div");
  rivalContainer.className = "fly-text-container";
  rivalSide.appendChild(rivalContainer);
  
  const diffs = [
    { key: "playerHealth", label: "体力", container: playerContainer },
    { key: "playerSpirit", label: "気力", container: playerContainer },
    { key: "rivalLove", label: "愛", container: rivalContainer },
    { key: "rivalMotivation", label: "やる気", container: rivalContainer },
  ];
  
  diffs.forEach(({ key, label, container }, index) => {
    const diff = nextStats[key] - prevStats[key];
    if (diff !== 0) {
      const isPositive = diff > 0;
      const sign = isPositive ? "+" : "";
      setTimeout(() => {
        createFlyText(`${sign}${diff} ${label}`, isPositive, container);
      }, index * 150); // Stagger text creation slightly
    }
  });
  
  // Clean up containers
  setTimeout(() => {
    playerContainer.remove();
    rivalContainer.remove();
  }, 2000);
}

// Optional pixel assets must never hold up the existing title or saved game.
pixelReady.then(() => {
  if (state.screen !== "character-select") return;
  const focusedAction = document.activeElement?.dataset.action;
  const focusedCharacter = document.activeElement?.dataset.characterId;
  render();
  const selector = focusedCharacter ? `[data-character-id="${focusedCharacter}"]` : focusedAction ? `[data-action="${focusedAction}"]` : "";
  if (selector) app.querySelector(selector)?.focus({ preventScroll: true });
});
