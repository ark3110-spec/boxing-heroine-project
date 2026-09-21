import { playSfx, unlockAudio } from "./audio.js?v=20260921-v110-yukito-a1";

// battle_scene.js — 試合ログ駆動の汎用試合演出エンジン（設計承認 2026-07-03）
//
// 育成キャンペーン本編と battle_test.html の両方から使用する。
// sequence.js（隠しモード専用・凍結）には依存しない。
//
// 公開API:
//   playBattleScene(app, card, onComplete)
//   buildBattleLog({ leftId, rightId, result })
//   normalizeFighter(def)
//   getRoundBattlePresentation(battleContent, roundId, result)
//
// card = {
//   left, right,        // normalizeFighter 済みのファイター定義
//   background,         // 背景画像パス（カードごとに1枚）
//   result,             // "ko" | "win" | "draw" | "lose"（left 視点）
//   events?,            // 手書きの試合ログ。渡されたら自動合成をスキップ（保証経路）
//   tempo?,             // 再生速度倍率。既定 1.0（値を上げると速くなる）
//   title?,             // 例: "第1戦"
// }

const POSE_FALLBACKS = {
  stance: ["stance"],
  jab: ["jab", "straight", "stance"],
  straight: ["straight", "jab", "stance"],
  body: ["body", "jab", "straight", "stance"],
  utility: ["utility", "stance"],
  damage_face: ["damage_face", "damage_body", "stance"],
  damage_body: ["damage_body", "damage_face", "stance"],
  stagger: ["stagger", "damage_face", "damage_body", "stance"],
  down: ["down", "damage_body", "damage_face", "stance"],
  win: ["win", "stance"],
};

// 被弾・ダウンをスプライトで表現できないときに付ける代替CSSクラス
const CSS_SUBSTITUTES = {
  damage_face: "bs-sub-damage",
  damage_body: "bs-sub-damage",
  down: "bs-sub-down",
};

const ATTACK_DAMAGE_POSE = {
  jab: "damage_face",
  straight: "damage_face",
  body: "damage_body",
};

const MIN_SPRITE_SCALE = 0.5;
const MAX_SPRITE_SCALE = 1.5;
function normalizeSpriteScale(value) {
  return Number.isFinite(value) && value >= MIN_SPRITE_SCALE && value <= MAX_SPRITE_SCALE
    ? value
    : 1;
}
export function normalizeFighter(def = {}) {
  const feel = def.feel ?? {};
  return {
    id: def.id ?? "",
    name: def.name ?? "???",
    themeColor: def.themeColor ?? "#8a97ab",
    scale: normalizeSpriteScale(def.scale),
    facing: def.facing === "left" ? "left" : "right",
    sprites: def.sprites ?? {},
    spritePresentation: def.spritePresentation ?? {},
    finisher: def.finisher ?? null,
    victoryImage: def.victoryImage ?? "",
    victoryOnKnockout: def.victoryOnKnockout === true,
    victoryCaption: def.victoryCaption ?? "",
    mouthPoint: def.mouthPoint ?? [0.5, 0.21],
    feel: {
      anticipationMs: Number.isFinite(feel.anticipationMs) ? feel.anticipationMs : 140,
      recoveryMs: Number.isFinite(feel.recoveryMs) ? feel.recoveryMs : 420,
      resetMs: Number.isFinite(feel.resetMs) ? feel.resetMs : 240,
      hitStopMs: Number.isFinite(feel.hitStopMs) ? feel.hitStopMs : 60,
      shakeThreshold: Number.isFinite(feel.shakeThreshold) ? feel.shakeThreshold : 8,
    },
    hasSprites: Boolean(def.sprites && Object.keys(def.sprites).length),
  };
}

// スプライト定義（文字列=単体PNG / {sheet,cols,rows,index} / {sheet,x,y,w,h}）を
// 描画可能なフレーム記述に正規化する。
function toFrame(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { kind: "full", url: entry };
  }
  if (entry.sheet && Number.isFinite(entry.cols) && Number.isFinite(entry.rows)) {
    const cols = Math.max(1, entry.cols);
    const rows = Math.max(1, entry.rows);
    const index = Math.max(0, entry.index ?? 0);
    return { kind: "grid", url: entry.sheet, cols, rows, col: index % cols, row: Math.floor(index / cols) };
  }
  if (entry.sheet && Number.isFinite(entry.w) && Number.isFinite(entry.h)) {
    return { kind: "rect", url: entry.sheet, x: entry.x ?? 0, y: entry.y ?? 0, w: entry.w, h: entry.h };
  }
  return null;
}

// フォールバック連鎖を辿ってポーズを解決する。
// 戻り値: { frame, substituteClass } — frame=null ならシルエット表示。
function resolvePose(fighter, poseKey, unavailableUrls = new Set()) {
  const chain = POSE_FALLBACKS[poseKey] ?? [poseKey, "stance"];
  for (const key of chain) {
    const frame = toFrame(fighter.sprites[key]);
    if (frame && !unavailableUrls.has(frame.url)) {
      const substituteClass = key !== poseKey ? (CSS_SUBSTITUTES[poseKey] ?? "") : "";
      return { frame, substituteClass, usedKey: key };
    }
  }
  return { frame: null, substituteClass: CSS_SUBSTITUTES[poseKey] ?? "", usedKey: null };
}

function loadImage(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false);
      return;
    }
    const image = new Image();
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(available);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    image.onload = async () => {
      try { await image.decode(); finish(image); } catch { finish(false); }
    };
    image.onerror = () => finish(false);
    image.src = url;
  });
}

async function prepareSceneAssets(left, right, background, extraImages = []) {
  const spriteUrls = [...new Set(
    [left, right]
      .flatMap((fighter) => Object.values(fighter.sprites ?? {}))
      .map(toFrame)
      .filter(Boolean)
      .map((frame) => frame.url)
      .concat([left, right].map((fighter) => fighter.finisher?.cutinImage)
        .filter((url) => typeof url === "string" && url.length > 0))
      .concat([left, right].map((fighter) => fighter.finisher?.background).filter(Boolean))
      .concat([left.victoryImage, right.victoryImage, ...extraImages].filter(Boolean)),
  )];
  const [spriteChecks, hasBackground] = await Promise.all([
    Promise.all(spriteUrls.map(async (url) => [url, await loadImage(url)])),
    background ? loadImage(background) : Promise.resolve(false),
  ]);
  const unavailableUrls = new Set(spriteChecks.filter(([, available]) => !available).map(([url]) => url));
  return { unavailableUrls, background: hasBackground ? background : "", images: new Map(spriteChecks),
    imageSizes: new Map(spriteChecks.filter(([, image]) => image).map(([url, image]) =>
      [url, { width: image.naturalWidth, height: image.naturalHeight }])) };
}

function applyFrame(spriteArtEl, frame, presentation = {}) {
  const renderScale = normalizeSpriteScale(presentation.renderScale);
  spriteArtEl.style.backgroundImage = `url("${frame.url}")`;
  spriteArtEl.style.inset = "";
  spriteArtEl.style.translate = "";
  if (frame.kind === "full") {
    spriteArtEl.style.backgroundSize = "contain";
    spriteArtEl.style.backgroundPosition = "center bottom";
  } else if (frame.kind === "grid") {
    spriteArtEl.style.backgroundSize = `${frame.cols * 100}% ${frame.rows * 100}%`;
    const px = frame.cols > 1 ? (frame.col / (frame.cols - 1)) * 100 : 0;
    const py = frame.rows > 1 ? (frame.row / (frame.rows - 1)) * 100 : 0;
    spriteArtEl.style.backgroundPosition = `${px}% ${py}%`;
  } else if (frame.kind === "rect") {
    // 切り出し矩形を素の解像度で置き、フレーム高さに合わせて拡縮する
    const box = spriteArtEl.parentElement;
    const scale = (box ? box.clientHeight / frame.h : 1) * renderScale;
    spriteArtEl.style.backgroundSize = "auto";
    spriteArtEl.style.backgroundPosition = `${-frame.x}px ${-frame.y}px`;
    spriteArtEl.style.width = `${frame.w}px`;
    spriteArtEl.style.inset = "auto auto 0 50%";
    spriteArtEl.style.translate = "-50% 0";
    spriteArtEl.style.height = `${frame.h}px`;
    spriteArtEl.style.transform = `scaleX(var(--bs-source-facing-scale, 1)) scale(${scale})`;
    return;
  }
  spriteArtEl.style.width = "";
  spriteArtEl.style.height = "";
  spriteArtEl.style.transform = `scaleX(var(--bs-source-facing-scale, 1)) scale(${renderScale})`;
}

function silhouetteHtml() {
  return `
    <div class="bs-silhouette" aria-hidden="true">
      <span class="bs-sil-head"></span>
      <span class="bs-sil-body"></span>
      <span class="bs-sil-arm back"></span>
      <span class="bs-sil-arm front"></span>
      <span class="bs-sil-glove back"></span>
      <span class="bs-sil-glove front"></span>
      <span class="bs-sil-leg back"></span>
      <span class="bs-sil-leg front"></span>
    </div>
  `;
}

function fighterHtml(fighter, side) {
  const sourceFacingScale = fighter.facing === "left" ? -1 : 1;
  return `
    <div class="bs-fighter ${side}" data-bs-source-facing="${fighter.facing}" style="--bs-theme:${fighter.themeColor}; --bs-scale:${fighter.scale}">
      <div class="bs-fighter-visual">
        <div class="bs-sprite" style="display:none;"><div class="bs-sprite-art" style="--bs-source-facing-scale:${sourceFacingScale}"></div></div>
        ${silhouetteHtml()}
      </div>
    </div>
  `;
}

function sceneHtml(card) {
  const bg = card.background
    ? `<div class="bs-bg" style="background-image:url('${card.background}')"></div>`
    : `<div class="bs-bg bs-bg-fallback"></div>`;
  return `
    <div class="bs-arena" data-bs-arena role="button" tabindex="0" aria-label="試合演出。Enter、Space、クリックで結果までスキップ">
      ${bg}
      <div class="bs-hud">
        <div class="bs-status left">
          <div class="bs-name">${escapeText(card.left.name)}</div>
          <div class="bs-hp"><div class="bs-hp-fill left"></div></div>
        </div>
        <div class="bs-round-label">${escapeText(card.title ?? "")}</div>
        <div class="bs-status right">
          <div class="bs-name">${escapeText(card.right.name)}</div>
          <div class="bs-hp"><div class="bs-hp-fill right"></div></div>
        </div>
      </div>
      <div class="bs-fighters">
        ${fighterHtml(card.left, "left")}
        ${fighterHtml(card.right, "right")}
      </div>
      <div class="bs-fx-layer"></div>
      <div class="bs-impact-flash" aria-hidden="true"></div>
      <div class="bs-round-intro" style="display:none;" aria-hidden="true">
        <span>ROUND READY</span>
        <strong>FIGHT</strong>
      </div>
      <div class="bs-cutin" style="display:none;" aria-live="polite"></div>
      <div class="bs-decision-blackout" aria-hidden="true"></div>
      <div class="bs-spotlight" aria-hidden="true"></div>
      <img class="bs-victory-art" alt="" hidden>
      <div class="bs-revenge" hidden aria-live="polite"></div>
      <div class="bs-ko" style="display:none;">K.O.!</div>
      <div class="bs-banner" style="display:none;"></div>
      <div class="bs-skip-hint">タップ / クリック / Enter でスキップ</div>
    </div>
  `;
}

function escapeText(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---- 試合ログの自動合成アダプタ ------------------------------------------
// 育成モードの判定結果（ko/win/draw/lose）から、もっともらしい攻防を合成する。
// 手書きしたい場合は card.events を渡せばこの関数は使われない。
export function buildBattleLog({ leftId = "left", rightId = "right", result = "win" } = {}) {
  const L = leftId;
  const R = rightId;
  const jitter = (base) => Math.max(3, base + Math.floor(Math.random() * 5) - 2);
  const patterns = {
    win: [
      { actor: L, action: "jab", hit: true, damage: jitter(6) },
      { actor: R, action: "straight", hit: false },
      { actor: L, action: "straight", hit: true, damage: jitter(9) },
      { actor: R, action: "jab", hit: true, damage: jitter(5) },
      { actor: L, action: "body", hit: true, damage: jitter(7) },
      { actor: L, action: "straight", hit: true, damage: jitter(8) },
    ],
    ko: [
      { actor: L, action: "jab", hit: true, damage: jitter(6) },
      { actor: R, action: "jab", hit: false },
      { actor: L, action: "straight", hit: true, damage: jitter(9) },
      { actor: R, action: "straight", hit: true, damage: jitter(4) },
      { actor: L, action: "body", hit: true, damage: jitter(8) },
      { actor: L, action: "finisher" },
    ],
    draw: [
      { actor: L, action: "jab", hit: true, damage: jitter(5) },
      { actor: R, action: "jab", hit: true, damage: jitter(5) },
      { actor: L, action: "straight", hit: false },
      { actor: R, action: "straight", hit: false },
      { actor: L, action: "body", hit: true, damage: jitter(6) },
      { actor: R, action: "body", hit: true, damage: jitter(6) },
    ],
    lose: [
      { actor: R, action: "jab", hit: true, damage: jitter(6) },
      { actor: L, action: "jab", hit: false },
      { actor: R, action: "straight", hit: true, damage: jitter(8) },
      { actor: L, action: "straight", hit: true, damage: jitter(4) },
      { actor: R, action: "body", hit: true, damage: jitter(7) },
      { actor: R, action: "straight", hit: true, damage: jitter(8) },
    ],
  };
  return patterns[result] ?? patterns.win;
}

// Round-specific presentation is content data; it never changes the match result.
export function getRoundBattlePresentation(battle, roundId, result, knockoutWinner = null) {
  const { openingEvents, eventsByResult, basicFinishers, callouts, ...presentation } = battle?.presentationByRound?.[roundId] ?? {};
  // Mirror the existing KO log for a real player KO loss; never turn a decision loss into a KO here.
  if (knockoutWinner === "right") return { ...presentation, events: buildBattleLog({ result: "ko" })
    .map(event => ({ ...event, actor: event.actor === "left" ? "right" : "left" })) };
  const scripted = eventsByResult?.[result];
  const events = Array.isArray(scripted) && scripted.length ? scripted
    : Array.isArray(openingEvents) && openingEvents.length
      ? [...openingEvents, ...buildBattleLog({ result })] : null;
  return events ? { ...presentation, events: events.map((event) => {
    const callout = callouts?.[event.calloutId];
    return callout ? { ...event, speaker: callout.speaker, text: callout.text } : { ...event };
  }) } : presentation;
}

const RESULT_BANNERS = {
  ko: { main: "KO勝ち！", sub: "" },
  win: { main: "判定勝ち", sub: "JUDGES' DECISION" },
  draw: { main: "DRAW", sub: "引き分け" },
  lose: { main: "判定負け", sub: "JUDGES' DECISION" },
};

// ---- 再生エンジン ----------------------------------------------------------
export async function playBattleScene(app, card, onComplete) {
  unlockAudio();
  const left = normalizeFighter(card.left);
  const right = normalizeFighter(card.right);
  // Clear the preceding scene before awaiting assets, including exhibition/ending CGs.
  app.innerHTML = '<div class="bs-loading" role="status">リングへ……</div>';
  const prepared = await prepareSceneAssets(left, right, card.background, card.preloadImages);
  const scene = { ...card, left, right, background: prepared.background };
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const tempo = (card.tempo > 0 ? card.tempo : 1.0) * (reducedMotion ? 2.5 : 1);
  const manualEvents = Array.isArray(card.events) && card.events.length > 0;
  const events = manualEvents
    ? card.events
    : buildBattleLog({ leftId: left.id || "left", rightId: right.id || "right", result: card.result });

  app.innerHTML = sceneHtml(scene);
  const arena = app.querySelector("[data-bs-arena]");
  const els = {
    left: arena.querySelector(".bs-fighter.left"),
    right: arena.querySelector(".bs-fighter.right"),
    hpLeft: arena.querySelector(".bs-hp-fill.left"),
    hpRight: arena.querySelector(".bs-hp-fill.right"),
    fx: arena.querySelector(".bs-fx-layer"),
    impact: arena.querySelector(".bs-impact-flash"),
    roundIntro: arena.querySelector(".bs-round-intro"),
    cutin: arena.querySelector(".bs-cutin"),
    ko: arena.querySelector(".bs-ko"),
    banner: arena.querySelector(".bs-banner"),
    revenge: arena.querySelector(".bs-revenge"),
    victoryArt: arena.querySelector(".bs-victory-art"),
  };

  const state = { skip: false, impactCount: 0, hp: { left: 100, right: 100 } };
  const activeTimers = new Set();
  const pendingWaits = new Set();
  const schedule = (callback, ms) => {
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      callback();
    }, ms);
    activeTimers.add(timer);
    return timer;
  };
  const sideOf = (actor) => {
    if (actor === "left" || actor === left.id) return "left";
    if (actor === "right" || actor === right.id) return "right";
    return "left";
  };
  const fighterOf = (side) => (side === "left" ? left : right);
  const otherSide = (side) => (side === "left" ? "right" : "left");

  // スキップ: タップ / クリック / Enter・Space
  const requestSkip = () => {
    if (state.skip) return;
    state.skip = true;
    [...pendingWaits].forEach((finish) => finish());
  };
  const onKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      requestSkip();
    }
  };
  arena.addEventListener("pointerup", requestSkip);
  window.addEventListener("keydown", onKey);
  const cleanup = () => {
    arena.removeEventListener("pointerup", requestSkip);
    window.removeEventListener("keydown", onKey);
    activeTimers.forEach((timer) => clearTimeout(timer));
    activeTimers.clear();
  };

  const wait = (ms) => new Promise((resolve) => {
    if (state.skip) { resolve(); return; }
    let timer = null;
    const finish = () => {
      if (!pendingWaits.delete(finish)) return;
      if (timer) {
        clearTimeout(timer);
        activeTimers.delete(timer);
      }
      resolve();
    };
    pendingWaits.add(finish);
    timer = schedule(finish, ms / tempo);
  });

  const setPose = (side, poseKey) => {
    const el = els[side];
    const fighter = fighterOf(side);
    const sprite = el.querySelector(".bs-sprite");
    const spriteArt = el.querySelector(".bs-sprite-art");
    const silhouette = el.querySelector(".bs-silhouette");
    const { frame, substituteClass, usedKey } = resolvePose(fighter, poseKey, prepared.unavailableUrls);
    const presentation = usedKey ? (fighter.spritePresentation?.[usedKey] ?? {}) : {};
    const renderScale = normalizeSpriteScale(presentation.renderScale);
    el.dataset.bsPose = poseKey;
    el.dataset.bsResolvedPose = usedKey ?? "silhouette";
    el.dataset.bsRenderScale = String(renderScale);
    el.classList.remove("bs-sub-damage", "bs-sub-down", "bs-pose-attack");
    if (frame) {
      sprite.style.display = "";
      silhouette.style.display = "none";
      applyFrame(spriteArt, frame, presentation);
    } else {
      sprite.style.display = "none";
      silhouette.style.display = "";
      silhouette.className = `bs-silhouette bs-sil-pose-${poseKey in POSE_FALLBACKS ? poseKey : "stance"}`;
    }
    if (substituteClass) el.classList.add(substituteClass);
    if (poseKey === "jab" || poseKey === "straight" || poseKey === "body") {
      el.classList.add("bs-pose-attack");
    }
  };

  // Positions are relative to the actual contain-fit image, including per-pose scale.
  // Points describe a right-facing fighter; the right side mirrors them.
  const fighterPoint = (side, point) => {
    const fighter = fighterOf(side);
    const pose = els[side].dataset.bsPose;
    const { frame } = resolvePose(fighter, pose, prepared.unavailableUrls);
    const art = els[side].querySelector(frame ? ".bs-sprite-art" : ".bs-silhouette");
    const rect = art.getBoundingClientRect();
    const size = frame?.kind === "full" ? prepared.imageSizes.get(frame.url) : null;
    const width = size ? Math.min(rect.width, rect.height * size.width / size.height) : rect.width;
    const height = size ? width * size.height / size.width : rect.height;
    return {
      x: rect.left + (rect.width - width) / 2 + width * (side === "right" ? 1 - point[0] : point[0]),
      y: rect.bottom - height + height * point[1],
    };
  };
  const approach = (attSide, defSide, ms) => {
    const attacker = fighterOf(attSide);
    const key = els[attSide].dataset.bsResolvedPose;
    const point = attacker.spritePresentation?.[key]?.contactPoint ?? [0.86, 0.36];
    const glove = fighterPoint(attSide, point);
    const target = fighterPoint(defSide, [0.5, 0.32]);
    const arenaRect = arena.getBoundingClientRect();
    const previous = parseFloat(els[attSide].style.getPropertyValue("--bs-approach-x")) || 0;
    const offset = previous + target.x - glove.x;
    els[attSide].style.transition = reducedMotion ? "none" : `translate ${ms / tempo}ms ease-out`;
    els[attSide].style.setProperty("--bs-approach-x", offset + "px");
    els[attSide].style.translate = offset + "px 0";
    state.contactPoint = {
      x: target.x - arenaRect.left,
      y: (els[defSide].dataset.bsPose === "down" ? fighterPoint(defSide, [0.5, 0.72]).y : glove.y) - arenaRect.top,
    };
  };
  const resetApproach = (side, ms = 140) => {
    els[side].style.transition = reducedMotion ? "none" : `translate ${ms / tempo}ms ease-out`;
    els[side].style.setProperty("--bs-approach-x", "0");
    els[side].style.translate = "";
  };

  const pulseTimers = new WeakMap();
  const pulse = (el, className, ms = 400) => {
    const timers = pulseTimers.get(el) ?? new Map();
    const previousTimer = timers.get(className);
    if (previousTimer) {
      clearTimeout(previousTimer);
      activeTimers.delete(previousTimer);
    }
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    if (ms) {
      const timer = schedule(() => {
        el.classList.remove(className);
        timers.delete(className);
      }, ms / tempo);
      timers.set(className, timer);
      pulseTimers.set(el, timers);
    }
  };

  const showDamage = (side, amount, isMiss = false) => {
    const span = document.createElement("span");
    span.className = isMiss ? "bs-damage miss" : "bs-damage";
    span.textContent = isMiss ? "MISS" : amount;
    const rect = arena.getBoundingClientRect();
    const point = state.contactPoint ?? { x: rect.width / 2, y: rect.height * 0.45 };
    span.style.left = point.x + "px";
    span.style.top = Math.max(30, point.y - rect.height * 0.1) + "px";
    els.fx.appendChild(span);
    schedule(() => span.remove(), 900 / tempo);
    if (!isMiss) {
      // 通常打撃のHPは演出値。0は実際のKOフィニッシャーにだけ予約する。
      state.hp[side] = Math.max(10, state.hp[side] - amount * 3);
      const bar = side === "left" ? els.hpLeft : els.hpRight;
      bar.style.width = `${state.hp[side]}%`;
      if (card.lowHpEmphasis) {
        bar.closest(".bs-status").classList.toggle("bs-critical", state.hp[side] <= 25);
      }
    }
  };

  const showImpact = (side, heavy = false) => {
    state.impactCount += 1;
    arena.dataset.bsImpact = String(state.impactCount);
    els.impact.className = "bs-impact-flash " + side + (heavy ? " heavy" : "");
    pulse(els.impact, "bs-impact-flash-in", heavy ? 120 : 85);
    const burst = document.createElement("span");
    burst.className = "bs-impact-burst" + (heavy ? " heavy" : "");
    const rect = arena.getBoundingClientRect();
    const point = state.contactPoint ?? { x: rect.width / 2, y: rect.height * 0.45 };
    burst.style.left = point.x + "px";
    burst.style.top = point.y + "px";
    els.impact.style.setProperty("--bs-impact-x", point.x + "px");
    els.impact.style.setProperty("--bs-impact-y", point.y + "px");
    els.fx.appendChild(burst);
    schedule(() => burst.remove(), 360 / tempo);
  };

  const showBanner = (main, sub = "", reaction = "") => {
    els.banner.innerHTML = `<strong>${escapeText(main)}</strong>${sub ? `<span>${escapeText(sub)}</span>` : ""}${reaction ? `<p class="bs-winner-reaction">${escapeText(reaction)}</p>` : ""}`;
    els.banner.style.display = "";
    pulse(els.banner, "bs-banner-in", 0);
  };

  const playAttack = async (event) => {
    const attSide = sideOf(event.actor);
    const defSide = otherSide(attSide);
    const attacker = fighterOf(attSide);
    const feel = attacker.feel;
    setPose(attSide, event.action);
    approach(attSide, defSide, feel.anticipationMs);
    await wait(feel.anticipationMs);
    if (event.hit) {
      const damage = event.damage ?? 6;
      const damagePose = ATTACK_DAMAGE_POSE[event.action] ?? "damage_face";
      const heavy = Boolean(event.heavy) || damage >= feel.shakeThreshold;
      setPose(defSide, damagePose);
      playSfx("hit");
      pulse(els[defSide], "bs-knockback", feel.recoveryMs);
      showDamage(defSide, damage);
      showImpact(defSide, heavy);
      if (heavy) pulse(arena, "bs-shake");
      if (feel.hitStopMs > 0) {
        arena.classList.add("bs-hit-stop");
        await wait(feel.hitStopMs);
        arena.classList.remove("bs-hit-stop");
      }
    } else {
      setPose(defSide, "utility");
      pulse(els[defSide], "bs-dodge", feel.recoveryMs);
      showDamage(defSide, 0, true);
    }
    await wait(feel.recoveryMs);
    resetApproach(attSide, feel.resetMs);
    setPose(attSide, "stance");
    if (!event.keepDefender) setPose(defSide, "stance");
    await wait(feel.resetMs);
  };

  const showFinisherCutin = async (side, fighter) => {
    const moveName = fighter.finisher?.name;
    if (!moveName && !fighter.finisher?.cutinImage) return;
    els.cutin.className = `bs-cutin ${side}`;
    els.cutin.style.setProperty("--bs-cutin-theme", fighter.themeColor);
    els.cutin.innerHTML = `
      <span class="bs-cutin-call">SPECIAL MOVE</span>
      <span class="bs-cutin-fighter">${escapeText(fighter.name)}</span>
      <strong class="bs-cutin-move">${escapeText(moveName || fighter.finisher?.cutinLabel || "FINISH")}</strong>
    `;
    const cutinImage = fighter.finisher?.cutinImage;
    if (cutinImage && prepared.imageSizes.has(cutinImage)) {
      const call = els.cutin.querySelector(".bs-cutin-call");
      const image = new Image();
      image.className = "bs-cutin-image";
      image.alt = ""; // The adjacent fighter name already labels this image.
      image.onerror = () => {
        call.classList.remove("has-image");
        call.textContent = "SPECIAL MOVE";
      };
      call.classList.add("has-image");
      call.replaceChildren(image);
      image.src = cutinImage;
    }
    els.cutin.style.display = "";
    pulse(els.cutin, "bs-cutin-in", 0);
    await wait(620);
    els.cutin.classList.add("bs-cutin-out");
    await wait(140);
    els.cutin.style.display = "none";
  };

  const playBeat = async (event) => {
    if (state.skip) return;
    const side = sideOf(event.actor);
    setPose(side, event.pose ?? "stance");
    const text = fighterOf(side).finisher?.name ? event.text : event.fallbackText ?? event.text;
    arena.dataset.bsBeat = event.id ?? "";
    els.banner.classList.add("bs-beat");
    showBanner(text ?? "", event.speaker ?? "");
    await wait(event.holdMs ?? 800);
    els.banner.style.display = "none";
    els.banner.classList.remove("bs-beat");
    delete arena.dataset.bsBeat;
  };

  const showMouthpiece = (side, origin) => {
    if (state.skip || reducedMotion || state.mouthpieceShown || !card.koMouthpiece) return;
    state.mouthpieceShown = true;
    const rect = arena.getBoundingClientRect();
    const point = origin ?? fighterPoint(side, fighterOf(side).mouthPoint);
    const piece = document.createElement("span");
    piece.className = "bs-mouthpiece";
    piece.setAttribute("aria-hidden", "true");
    piece.style.left = `${point.x - rect.left}px`;
    piece.style.top = `${point.y - rect.top}px`;
    piece.style.setProperty("--bs-mouthpiece-dx", `${(side === "right" ? 1 : -1) * Math.min(100, rect.width * 0.18)}px`);
    piece.style.setProperty("--bs-mouthpiece-time", `${850 / tempo}ms`);
    els.fx.appendChild(piece);
    schedule(() => piece.remove(), 850 / tempo);
  };

  const playFinisher = async (event, knockout = true) => {
    const attSide = sideOf(event.actor);
    const defSide = otherSide(attSide);
    const attacker = fighterOf(attSide);
    const finisher = event.basic ? null : attacker.finisher;
    const background = arena.querySelector(".bs-bg");
    const previousBackground = background.style.backgroundImage;
    await wait(event.leadMs ?? 420);
    if (finisher && !event.skipCutin) await showFinisherCutin(attSide, attacker);
    if (event.skipCutin) arena.dataset.bsExhibitionPhase = "followup";
    if (finisher?.cornerRush) {
      const rush = finisher.cornerRush;
      resetApproach(attSide, 0);
      resetApproach(defSide, 0);
      for (const side of [attSide, defSide]) els[side].style.transition = reducedMotion ? "none" : `left ${rush.pushMs / tempo}ms ease-out, right ${rush.pushMs / tempo}ms ease-out`;
      arena.dataset.bsCorner = defSide;
      if (finisher.background && !prepared.unavailableUrls.has(finisher.background)) {
        background.style.backgroundImage = `url("${finisher.background}")`;
        background.classList.add("bs-corner-bg");
      }
      setPose(defSide, "damage_face");
      setPose(attSide, rush.frames[0]);
      await wait(rush.pushMs);
      for (let hit = 0; hit < rush.hits && !state.skip; hit++) {
        arena.dataset.bsRushHit = String(hit + 1);
        setPose(attSide, rush.frames[hit % rush.frames.length]);
        approach(attSide, defSide, rush.punchMs);
        await wait(rush.punchMs);
        playSfx("hit");
        setPose(defSide, "damage_face");
        showImpact(defSide);
        showDamage(defSide, 2);
        pulse(els[defSide], "bs-knockback", rush.recoveryMs);
        if (!reducedMotion) pulse(arena, "bs-shake", rush.recoveryMs);
        await wait(rush.recoveryMs);
      }
    }
    if (finisher?.counterLead) {
      const lead = finisher.counterLead;
      arena.dataset.bsCounterPhase = "evade";
      setPose(defSide, lead.attackPose ?? "straight");
      setPose(attSide, lead.evadePose ?? "utility");
      approach(defSide, attSide, 100);
      pulse(els[attSide], "bs-dodge", lead.evadeHoldMs);
      showDamage(attSide, 0, true);
      await wait(lead.evadeHoldMs);
      resetApproach(defSide, 0);
      setPose(defSide, "stance");
      arena.dataset.bsCounterPhase = "pause";
      await wait(lead.pauseMs);
      arena.dataset.bsCounterPhase = "counter";
    }
    const frames = finisher?.frames?.length ? finisher.frames : ["straight"];
    const defaultFrameDuration = finisher?.frameDuration ?? 180;
    const frameDurations = finisher?.frameDurations ?? {};
    const impactFrame = finisher?.impactFrame ?? frames[Math.min(1, frames.length - 1)];
    let impactApplied = false;
    const applyFinisherImpact = async () => {
      if (impactApplied) return;
      impactApplied = true;
      const finish = knockout ? card.koFinish : null;
      const origin = knockout ? fighterPoint(defSide, fighterOf(defSide).mouthPoint) : null;
      playSfx(knockout ? "ko" : "hit");
      arena.dataset.bsSpecial = knockout ? "ko" : "win";
      if (finish) arena.dataset.bsKoPhase = "impact";
      if (knockout && !finish) showMouthpiece(defSide, origin);
      setPose(defSide, knockout && !finish ? "down" : "damage_face");
      if (!finish) pulse(els[defSide], "bs-knockback", 520);
      showImpact(defSide, true);
      showDamage(defSide, knockout ? 50 : event.damage ?? 16);
      if (knockout) {
        state.hp[defSide] = 0;
        (defSide === "left" ? els.hpLeft : els.hpRight).style.width = "0%";
      }
      pulse(arena, "bs-shake", 600);
      arena.classList.add("bs-hit-stop");
      await wait(finish?.hitStopMs ?? Math.max(80, attacker.feel.hitStopMs));
      arena.classList.remove("bs-hit-stop");
      if (finish) {
        showMouthpiece(defSide, origin);
        arena.dataset.bsKoPhase = "stagger";
        els[defSide].style.setProperty("--bs-ko-stagger-time", `${finish.staggerMs / tempo}ms`);
        els[defSide].classList.add("bs-ko-stagger");
        await wait(finish.staggerMs);
        els[defSide].classList.remove("bs-ko-stagger");
        setPose(defSide, "down");
        arena.dataset.bsKoPhase = "fall";
        els[defSide].style.setProperty("--bs-ko-fall-time", `${finish.fallMs / tempo}ms`);
        els[defSide].classList.add("bs-ko-fall");
        await wait(finish.fallMs);
        els[defSide].classList.remove("bs-ko-fall");
        arena.dataset.bsKoPhase = "fallen";
      }
    };
    for (const frameKey of frames) {
      const frameDuration = frameDurations[frameKey] ?? defaultFrameDuration;
      setPose(attSide, frameKey);
      if (frameKey === impactFrame && !impactApplied) {
        const impactLead = Math.min(70, Math.max(30, frameDuration * 0.35));
        approach(attSide, defSide, impactLead);
        await wait(impactLead);
        await applyFinisherImpact();
        await wait(Math.max(0, frameDuration - impactLead));
      } else {
        await wait(frameDuration);
      }
    }
    if (!impactApplied) {
      approach(attSide, defSide, 0);
      await applyFinisherImpact();
    }
    if (!finisher?.cornerRush || !knockout) resetApproach(attSide);
    delete arena.dataset.bsCounterPhase;
    if (!knockout) {
      await wait(420);
      delete arena.dataset.bsCorner;
      delete arena.dataset.bsRushHit;
      background.style.backgroundImage = previousBackground;
      background.classList.remove("bs-corner-bg");
      setPose(attSide, "stance");
      setPose(defSide, "stance");
      return;
    }
    arena.dataset.bsKoPhase = "settled";
    // A real-time beat keeps the down pose readable even at the normal fast battle tempo.
    if (!state.skip) await new Promise(resolve => schedule(resolve, card.exhibition ? 200 : card.koFinish?.settleMs ?? 550));
    if (card.koFinish) arena.dataset.bsKoPhase = "verdict";
    els.ko.style.display = "";
    pulse(els.ko, "bs-ko-in", 0);
    await wait(900);
  };

  // Scripted exhibitions alone can hit after the KO, without restoring the defender.
  const playLateHit = async (event) => {
    const attSide = sideOf(event.actor);
    const defSide = otherSide(attSide);
    const feel = fighterOf(attSide).feel;
    els.ko.style.display = "none";
    setPose(defSide, "down");
    setPose(attSide, "jab");
    approach(attSide, defSide, feel.anticipationMs);
    await wait(feel.anticipationMs);
    playSfx("hit");
    showImpact(defSide, true);
    pulse(arena, "bs-shake");
    if (card.refereeWarning) {
      els.banner.classList.add("bs-warning");
      showBanner(card.refereeWarning.main, card.refereeWarning.sub);
    }
    await wait(700 * tempo);
    resetApproach(attSide);
    setPose(attSide, "stance");
    els.banner.style.display = "none";
    els.banner.classList.remove("bs-warning");
  };

  // ---- 再生本体 ----
  setPose("left", "stance");
  setPose("right", "stance");
  els.hpLeft.style.width = "100%";
  els.hpRight.style.width = "100%";
  arena.focus({ preventScroll: true });
  if (card.revenge && !card.exhibition) {
    arena.dataset.bsRevenge = "start";
    els.revenge.textContent = "リベンジ！";
    els.revenge.hidden = false;
    await wait(1000 * tempo);
    els.revenge.hidden = true;
    delete arena.dataset.bsRevenge;
  }
  els.roundIntro.querySelector("span").textContent = card.readyLabel ?? "ROUND READY";
  if (Number.isFinite(card.preBellMs) && card.preBellMs > 0) {
    els.roundIntro.querySelector("strong").textContent = "READY";
    els.roundIntro.style.display = "";
    await wait(card.preBellMs);
  }
  playSfx("bell");
  els.roundIntro.querySelector("strong").textContent = "FIGHT";
  els.roundIntro.style.display = "";
  pulse(els.roundIntro, "bs-round-intro-in", 0);
  const introMs = Number.isFinite(card.roundIntroMs) && card.roundIntroMs >= 0
    ? card.roundIntroMs : reducedMotion ? 220 : 700;
  await wait(introMs);
  els.roundIntro.style.display = "none";

  for (const event of events) {
    if (event.action === "beat") {
      await playBeat(event);
    } else if (event.action === "special" && ["win", "ko"].includes(card.result)) {
      const hasMove = Boolean(fighterOf(sideOf(event.actor)).finisher?.name);
      if (hasMove || card.result === "ko") {
        await playFinisher({ ...event, basic: !hasMove }, card.result === "ko");
      } else {
        await playAttack({ ...event, action: "straight", hit: true, heavy: true });
      }
    } else if (manualEvents && event.action === "stagger_hit") {
      const attSide = sideOf(event.actor), defSide = otherSide(attSide);
      await showFinisherCutin(attSide, fighterOf(attSide));
      await playAttack({ ...event, action: "straight", hit: true, heavy: true, keepDefender: true });
      setPose(defSide, "stagger");
      arena.dataset.bsExhibitionPhase = "stagger";
      await wait(event.holdMs ?? 520);
    } else if (manualEvents && event.action === "late_hit") {
      await playLateHit(event);
    } else if (manualEvents && event.action === "technique") {
      // A scripted scoring technique (either corner), never a knockout.
      await playFinisher(event, false);
    } else if (event.action === "finisher") {
      if (card.result === "ko" || card.knockoutWinner === "right") {
        await playFinisher(event);
      } else {
        // 手書きログが古い場合も、判定決着ではダウン・KO演出へ入れない。
        await playAttack({ ...event, action: "straight", hit: true, damage: event.damage ?? 8, heavy: true });
      }
    } else {
      await playAttack(event);
    }
  }

  // Read the confirmed winner. Legacy test cards use the already decided result enum.
  await wait(180);
  const banner = (manualEvents && card.resultBanner) || (card.knockoutWinner === "right" ? { main: "KO負け", sub: "" } : RESULT_BANNERS[card.result]) || RESULT_BANNERS.win;
  els.ko.style.display = "none";
  playSfx("result");
  const winnerSide = card.winnerSide ?? (card.result === "lose" ? "right" : card.result === "draw" ? null : "left");
  const decision = (card.finishType ?? (card.result === "ko" || card.knockoutWinner ? "ko" : "decision")) === "decision";
  if (decision && !card.exhibition && winnerSide) {
    arena.dataset.bsDecision = "blackout";
    await wait(280 * tempo);
    arena.dataset.bsWinner = winnerSide;
    arena.dataset.bsDecision = "spotlight";
    setPose(winnerSide, "win");
    showBanner(banner.main, `${fighterOf(winnerSide).name} 勝利`);
    await wait(700 * tempo);
  }
  // Some opponents (notably the KO-only challenger) celebrate after a knockout too.
  // The KO/down beat has already finished and its label is hidden before this image appears.
  if (!card.exhibition && winnerSide && (decision || fighterOf(winnerSide).victoryOnKnockout)) {
    const victoryImage = fighterOf(winnerSide).victoryImage;
    if (victoryImage && !prepared.unavailableUrls.has(victoryImage)) {
      const portrait = prepared.images.get(victoryImage);
      portrait.className = "bs-victory-art";
      portrait.alt = `${fighterOf(winnerSide).name} 勝利`;
      portrait.dataset.bsVictory = fighterOf(winnerSide).id;
      portrait.onerror = () => { portrait.hidden = true; };
      els.victoryArt.replaceWith(portrait);
      els.victoryArt = portrait;
    }
  }
  if (winnerSide) {
    setPose(winnerSide, "win");
    arena.classList.add("bs-result-" + winnerSide);
  } else {
    arena.classList.add("bs-result-draw");
  }
  showBanner(banner.main, winnerSide && !card.exhibition ? `${fighterOf(winnerSide).name} 勝利` : banner.sub,
    winnerSide === "right" && !card.exhibition ? right.victoryCaption : "");

  // スキップされていても結果は必ず見せる（実時間で待つ）
  const resultHoldMs = Number.isFinite(card.resultHoldMs) && card.resultHoldMs >= 0 ? card.resultHoldMs : 1400;
  await new Promise((resolve) => setTimeout(resolve, state.skip ? 700 : resultHoldMs / tempo));
  if (card.revenge && winnerSide === "left" && !card.exhibition) {
    els.banner.style.display = "none";
    arena.dataset.bsRevenge = "success";
    els.revenge.textContent = "リベンジ成功！";
    els.revenge.hidden = false;
    await wait(1000 * tempo);
  }
  cleanup();
  if (onComplete) onComplete();
}
