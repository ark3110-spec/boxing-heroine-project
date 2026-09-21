import { playSfx } from "./audio.js?v=20260921-v110-yukito-a1";
// Additive arcade presentation. No game state, stats or save data lives here.
const VERSION = "20260921-v110-yukito-a1";
const enabled = new URLSearchParams(location.search).get("pixel") !== "0";
const url = (src) => `${src}${src.includes("?") ? "&" : "?"}v=${VERSION}`;
let catalog = null;
export const pixelReady = (async () => {
try {
  if (enabled) {
    const response = await fetch(url("assets/pixel/manifest.json"), { signal: AbortSignal.timeout(1800) });
    if (response.ok) catalog = await response.json();
  }
} catch { /* Existing image animations remain available. */ }
})();
const images = new Map();
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const mounted = new Set();
const mountedCanvases = new WeakSet();
function getImage(src) {
  if (!src) return null;
  if (!images.has(src)) {
    const image = new Image();
    image.dataset.state = "loading";
    image.onload = () => { image.dataset.state = "ready"; };
    image.onerror = () => { image.dataset.state = "error"; };
    image.src = url(src);
    images.set(src, image);
  }
  return images.get(src);
}
function animationFor(id, action) {
  const value = catalog?.characters?.[id]?.animations?.[action];
  return value && typeof value.sheet === "string" && Number.isInteger(value.row) && value.row >= 0
    && Number.isInteger(value.frames) && value.frames > 0 && value.frames <= 8
    && Array.isArray(value.durations) && value.durations.length === value.frames
    && value.durations.every((n) => Number.isFinite(n) && n > 0)
    && (value.sourceFrames === undefined || (Array.isArray(value.sourceFrames)
      && value.sourceFrames.length === value.frames
      && value.sourceFrames.every((n) => Number.isInteger(n) && n >= 0 && n < 8)))
    && (value.yOffsets === undefined || (Array.isArray(value.yOffsets)
      && value.yOffsets.length === value.frames
      && value.yOffsets.every((n) => Number.isInteger(n) && n >= -16 && n <= 16))) ? value : null;
}
function poseAt(animation, elapsed) {
  const durations = animation.durations;
  let phase = elapsed % durations.reduce((sum, n) => sum + n, 0);
  for (let frame = 0; frame < durations.length; frame++) {
    if (phase < durations[frame]) return frame;
    phase -= durations[frame];
  }
  return 0;
}
export function pixelActorMarkup(id, action = "idle", scene = "") {
  if (!animationFor(id, action)) return "";
  return `<span class="pixel-stage${scene ? " pixel-stage-wide" : ""}"><canvas class="pixel-canvas" width="${scene ? 288 : 96}" height="${scene ? 160 : 96}" data-pixel-character="${id}" data-pixel-action="${action}" data-pixel-scene="${scene}" aria-hidden="true"></canvas></span>`;
}
// Only tiny light clusters on the silhouette are matte residue. Large light
// regions (silver hair, skin and white clothing) and enclosed highlights stay.
const actorClips = new WeakMap();
function actorClip(sheet, colors, frame, row, matteSeeds = [], edgeInk) {
  if (!Array.isArray(colors)) colors = [];
  if (!colors.length && !Array.isArray(edgeInk)) return null;
  let clips = actorClips.get(sheet);
  if (!clips) { clips = new Map(); actorClips.set(sheet, clips); }
  const key = `${row}:${frame}`;
  if (clips.has(key)) return clips.get(key);
  const sample = document.createElement("canvas");
  sample.width = sample.height = 96;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(sheet, frame * 96, row * 96, 96, 96, 0, 0, 96, 96);
  let pixels;
  try { pixels = context.getImageData(0, 0, 96, 96).data; }
  catch { clips.set(key, null); return null; }
  const light = new Uint8Array(96 * 96), visited = new Uint8Array(96 * 96);
  for (let i = 0; i < light.length; i++) {
    light[i] = Number(pixels[i * 4 + 3] > 0 && colors.some(([r, g, b]) =>
      pixels[i * 4] === r && pixels[i * 4 + 1] === g && pixels[i * 4 + 2] === b));
  }
  const seeds = new Set((Array.isArray(matteSeeds) ? matteSeeds : []).filter((point) => Array.isArray(point) && point.length === 2
    && point.every((n) => Number.isInteger(n) && n >= 0 && n < 96))
    .map(([x, y]) => y * 96 + x));
  const removed = [];
  for (let i = 0; i < light.length; i++) {
    if (!light[i] || visited[i]) continue;
    const pending = [i], cluster = [];
    let touchesTransparency = false;
    while (pending.length) {
      const index = pending.pop();
      if (visited[index]) continue;
      visited[index] = 1; cluster.push(index);
      const x = index % 96, y = Math.floor(index / 96);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x < 95) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - 96);
      if (y < 95) neighbors.push(index + 96);
      for (const next of neighbors) {
        if (!pixels[next * 4 + 3]) touchesTransparency = true;
        else if (light[next] && !visited[next]) pending.push(next);
      }
    }
    if ((touchesTransparency && cluster.length <= 8) || cluster.some((index) => seeds.has(index))) {
      removed.push(...cluster);
    }
  }
  const clip = removed.length ? new Path2D() : null;
  if (clip) {
    clip.rect(0, 0, 96, 96);
    for (const index of removed) clip.rect(index % 96, Math.floor(index / 96), 1, 1);
  }
  // Pale pixels on the visible boundary become dark contour pixels. Interior
  // highlights, skin and garment trim keep their original color.
  let ink = null;
  if (Array.isArray(edgeInk) && edgeInk.length === 3) {
    const excluded = new Set(removed);
    const visible = (index) => index >= 0 && index < 96 * 96
      && pixels[index * 4 + 3] > 0 && !excluded.has(index);
    for (let index = 0; index < 96 * 96; index++) {
      if (!visible(index)) continue;
      const r = pixels[index * 4], g = pixels[index * 4 + 1], b = pixels[index * 4 + 2];
      if (Math.min(r, g, b) < 100 || r * .2126 + g * .7152 + b * .0722 < 145) continue;
      const x = index % 96, y = Math.floor(index / 96);
      if (x === 0 || x === 95 || y === 0 || y === 95
        || !visible(index - 1) || !visible(index + 1)
        || !visible(index - 96) || !visible(index + 96)
        || !visible(index - 97) || !visible(index - 95)
        || !visible(index + 95) || !visible(index + 97)) {
        ink ??= new Path2D();
        ink.rect(x, y, 1, 1);
      }
    }
  }
  const treatment = { clip, ink };
  clips.set(key, treatment);
  return treatment;
}
function drawActor(ctx, id, action, elapsed, x, y, canvas) {
  const animation = animationFor(id, action);
  if (!animation) return false;
  const sheet = getImage(animation.sheet);
  const frame = poseAt(animation, elapsed);
  if (canvas) { canvas.dataset.pixelFrame = String(frame); canvas.dataset.pixelLoad = sheet?.dataset.state ?? "error"; }
  if (sheet?.dataset.state !== "ready") return false;
  const sourceFrame = animation.sourceFrames?.[frame] ?? frame;
  const bob = (action === "running" && !reduced() ? [0,1,0,-1,0,1,0,-1][frame] : 0)
    + (animation.yOffsets?.[frame] ?? 0);
  const edgeInk = catalog.characters[id].edgeInk;
  const treatment = actorClip(sheet, animation.edgeMatteColors ?? catalog.characters[id].edgeMatteColors, sourceFrame, animation.row,
    animation.matteSeeds?.[frame], edgeInk);
  ctx.save();
  ctx.translate(Math.round(x - 48), Math.round(y - 88 + bob));
  if (treatment?.clip) ctx.clip(treatment.clip, "evenodd");
  ctx.drawImage(sheet, sourceFrame * 96, animation.row * 96, 96, 96, 0, 0, 96, 96);
  if (treatment?.ink) {
    ctx.fillStyle = `rgb(${edgeInk.join(",")})`;
    ctx.fill(treatment.ink);
  }
  ctx.restore();
  return true;
}
function drawProp(ctx, id, x, y, offset = 0) {
  const prop = catalog?.props?.[id];
  if (!prop) return;
  const image = getImage(prop.src);
  if (image?.dataset.state !== "ready") return;
  ctx.save();
  ctx.translate(Math.round(x + offset), y);
  if (id === "bag" && prop.src === "assets/pixel/prop_bag.png"
      && image.naturalWidth === 38 && image.naturalHeight === 110) {
    // The enclosed chain opening in this prop contains opaque background pixels.
    // Clip only that opening, in source-pixel coordinates, keeping metal highlights.
    ctx.scale(prop.width / 38, prop.height / 110);
    ctx.beginPath();
    ctx.rect(0, 0, 38, 110);
    for (const [left, top, width, height] of [
      [18, 17, 2, 4], [16, 21, 6, 3], [16, 24, 7, 1],
      [14, 25, 10, 4], [12, 29, 14, 3], [11, 32, 16, 1],
    ]) ctx.rect(left, top, width, height);
    ctx.clip("evenodd");
    ctx.drawImage(image, 0, 0);
  } else {
    ctx.drawImage(image, 0, 0, prop.width, prop.height);
  }
  ctx.restore();
}
function paint(canvas, elapsed) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const { pixelCharacter: id, pixelScene: scene } = canvas.dataset;
  let action = canvas.dataset.pixelAction;
  const sequence = canvas.dataset.pixelSequence?.split(",");
  if (sequence?.length && !reduced()) {
    const stepMs = Number(canvas.dataset.pixelStepMs) || 1100;
    const step = Math.floor(elapsed / stepMs);
    action = sequence[canvas.dataset.pixelSequenceOnce === "true" ? Math.min(step, sequence.length - 1) : step % sequence.length];
    const clip = animationFor(id, action);
    if (clip) elapsed = (elapsed % stepMs) / stepMs * clip.durations.reduce((a, b) => a + b, 0);
  }
  canvas.dataset.pixelActiveAction = action;
  if (!scene) { drawActor(ctx, id, action, elapsed, 48, 88, canvas); return; }
  ctx.fillStyle = "#253443"; ctx.fillRect(0, 0, 288, 160);
  const backgroundKey = scene === "roadwork" ? "riverside" : scene === "street" ? "street" : ["arena", "sparring"].includes(scene) ? "arena" : "gym";
  const background = getImage(catalog?.backgrounds?.[backgroundKey]);
  const running = scene === "roadwork" || scene === "street";
  if (background?.dataset.state === "ready") {
    ctx.drawImage(background, 0, 0, 288, 160);
    // Move only the lower road strip; buildings and horizon stay readable.
    if (running && !reduced()) {
      const offset = Math.floor(elapsed / 38) % 288;
      ctx.drawImage(background, 0, 132, 288, 28, -offset, 132, 288, 28);
      ctx.drawImage(background, 0, 132, 288, 28, 288-offset, 132, 288, 28);
    }
  }
  const animation = animationFor(id, action);
  const frame = animation ? poseAt(animation, elapsed) : 0;
  const hit = !reduced() && animation?.impactFrames?.includes(frame);
  const bag = scene === "sandbag";
  const mitt = scene === "mitt";
  const x = bag || mitt || scene === "sparring" ? 112 : 144;
  ctx.fillStyle = "#17253499"; ctx.fillRect(x-24, 139, 48, 3);
  if (bag) drawProp(ctx, "bag", 152, 26, hit ? 3 : frame===5 ? 5 : 0);
  if (mitt) drawProp(ctx, "mitts", 152, 83, hit ? 2 : 0);
  if (scene === "recover") {
    drawProp(ctx, "bench", 185, 121); drawProp(ctx, "bottle", 222, 98);
    drawProp(ctx, "towel", 185, 110); drawProp(ctx, "gloves", 253, 117);
  }
  if (scene === "sparring") {
    const rival = catalog.characters[canvas.dataset.pixelPartner] ? canvas.dataset.pixelPartner : Object.keys(catalog.characters).find((key) => key !== id);
    canvas.dataset.pixelPartner = rival ?? "";
    if (rival) {
      ctx.save(); ctx.translate(288, 0); ctx.scale(-1, 1);
      const reply = ["guard", "dodge"].includes(action)
        ? catalog.characters[rival].training?.sandbag?.[0] : animationFor(rival, "guard") ? "guard" : "stance";
      drawActor(ctx, rival, reply || "idle", elapsed, 106, 141);
      ctx.restore();
    }
  }
  const visible = drawActor(ctx, id, action, elapsed, x, 141, canvas);
  if (!visible) {
    ctx.fillStyle = "#fff3d5"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText(canvas.dataset.pixelLoad === "error" ? "TRAINING" : "READY", 144, 104);
  }
  if (hit && ["sandbag", "mitt", "sparring"].includes(scene)) {
    if (canvas.dataset.pixelSound === "true" && canvas.dataset.pixelWasHit !== "true") playSfx("hit");
    const impact = getImage(catalog?.props?.impact?.src);
    if (impact?.dataset.state === "ready") ctx.drawImage(impact, 154, 81, 32, 32);
  }
  canvas.dataset.pixelWasHit = String(Boolean(hit));
  if (scene === "arena") drawProp(ctx, "gong", 245, 122);
}
export function mountPixelActors(root = document) {
  for (const canvas of root.querySelectorAll(".pixel-canvas")) {
    if (mountedCanvases.has(canvas)) continue;
    mountedCanvases.add(canvas);
    let active = true, raf = 0;
    const start = performance.now();
    const scale = () => {
      const parentWidth = canvas.parentElement.clientWidth;
      const factor = Math.max(1, Math.floor(parentWidth / canvas.width));
      canvas.style.width = `${canvas.width * factor}px`;
      canvas.style.height = `${canvas.height * factor}px`;
    };
    const observer = new ResizeObserver(scale); observer.observe(canvas.parentElement); scale();
    const stop = () => { active = false; cancelAnimationFrame(raf); observer.disconnect(); mounted.delete(stop); mountedCanvases.delete(canvas); };
    mounted.add(stop);
    const tick = (now) => {
      if (!active || !canvas.isConnected) { stop(); return; }
      if (!document.hidden) paint(canvas, canvas.dataset.pixelElapsed !== undefined ? Number(canvas.dataset.pixelElapsed) : reduced() ? 0 : now-start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
}
export function clearPixelActors() { for (const stop of [...mounted]) stop(); }

// Reuse the result-card actor. This moment never owns campaign progress.
export function playPixelRevenge(parent, id, onComplete) {
  const reducedMotion = reduced();
  const rise = animationFor(id, "revenge_rise"), stance = animationFor(id, "stance");
  parent.classList.add("pixel-revenge");
  parent.dataset.revengePhase = "loading";
  parent.innerHTML = `${pixelActorMarkup(id, reducedMotion ? "stance" : "revenge_rise", "arena")}<strong class="pixel-revenge-banner" role="status" hidden>リベンジ</strong><button type="button" class="pixel-skip">演出をスキップ</button>`;
  const canvas = parent.querySelector("canvas"), banner = parent.querySelector(".pixel-revenge-banner"), skip = parent.querySelector("button");
  let finished = false;
  const timers = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    onComplete();
  };
  skip.addEventListener("click", event => { event.stopPropagation(); finish(); });
  parent.addEventListener("keydown", event => {
    if (["Enter", " ", "Escape"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); finish(); }
  });
  skip.focus({ preventScroll: true });
  parent.scrollIntoView({ block: "center", behavior: "instant" });
  const sources = [...new Set([rise?.sheet, stance?.sheet].filter(Boolean))];
  const ready = Promise.all(sources.map(src => getImage(src).decode().then(() => true, () => false)));
  Promise.race([ready, new Promise(resolve => timers.push(setTimeout(() => resolve([false]), 2000)))])
    .then(loaded => {
      if (finished || !parent.isConnected) return;
      const animate = canvas && rise && stance && loaded.every(Boolean);
      if (animate) {
        canvas.dataset.pixelSequence = "revenge_rise,stance";
        canvas.dataset.pixelSequenceOnce = "true";
        canvas.dataset.pixelStepMs = "700";
        mountPixelActors(parent);
      } else if (canvas) canvas.closest(".pixel-stage").remove();
      const riseMs = animate && !reducedMotion ? 700 : 0;
      parent.dataset.revengePhase = riseMs ? "rise" : "standing";
      const show = () => { parent.dataset.revengePhase = "standing"; banner.hidden = false; };
      if (riseMs) timers.push(setTimeout(show, riseMs)); else show();
      timers.push(setTimeout(finish, riseMs + (reducedMotion ? 650 : 900)));
    });
}
const training = {
  sandbag: { action: "punching_bag", scene: "sandbag", label: "サンドバッグ", cue: "BAG WORK" },
  roadwork: { action: "running", scene: "roadwork", label: "ロードワーク", cue: "ROAD WORK" },
  sparring: { action: "sparring", scene: "sparring", label: "スパーリング", cue: "SPARRING" },
  recover: { action: "tired", scene: "recover", label: "休養", cue: "RECOVERY" },
};
let roadworkRuns = 0;
export function playPixelTraining(parent, id, command, onComplete, partnerId = null) {
  const item = training[command];
  const sequence = catalog?.characters?.[id]?.training?.[command] ?? [item?.action];
  if (!item || !sequence.length || !sequence.every((action) => animationFor(id, action))) return false;
  const scene = command === "roadwork" ? (++roadworkRuns % 2 ? "street" : "roadwork") : item.scene;
  return playPixelMoment(parent, id, sequence[0], scene, item.label, item.cue, 3600, onComplete, command, sequence, partnerId);
}
function playPixelMoment(parent, id, action, scene, label, cue, duration, onComplete, command = "intro", sequence = [], partnerId = null) {
  const overlay = document.createElement("div");
  overlay.className = "pixel-overlay";
  overlay.dataset.trainingCommand = command;
  overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", label);
  overlay.innerHTML = `<section class="pixel-moment"><header><span>${cue}</span><strong>${label}</strong></header>${pixelActorMarkup(id, action, scene)}<footer><button type="button" class="pixel-skip">演出をスキップ</button></footer><div class="pixel-time"><span></span></div></section>`;
  parent.appendChild(overlay);
  const canvas = overlay.querySelector("canvas");
  if (partnerId && catalog.characters[partnerId]) {
    canvas.dataset.pixelPartner = partnerId;
    const pair = `${catalog.characters[id].name ?? id} / ${catalog.characters[partnerId].name ?? partnerId}`;
    overlay.querySelector("header strong").textContent = `${label} · ${pair}`;
    overlay.setAttribute("aria-label", `${label} ${pair}`);
  }
  if (sequence.length > 1) {
    canvas.dataset.pixelSequence = sequence.join(",");
    canvas.dataset.pixelStepMs = String(duration / sequence.length);
    canvas.dataset.pixelSound = "true";
    for (const clip of sequence) getImage(animationFor(id, clip).sheet);
  }
  mountPixelActors(overlay);
  const skip = overlay.querySelector("button");
  skip.focus({ preventScroll: true });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    overlay.remove(); onComplete();
  };
  const timer = setTimeout(finish, reduced() ? 650 : duration);
  overlay.style.setProperty("--pixel-duration", `${reduced() ? 650 : duration}ms`);
  skip.addEventListener("click", (event) => { event.stopPropagation(); finish(); });
  overlay.addEventListener("keydown", (event) => {
    if (["Escape", "Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); finish(); }
    if (event.key === "Tab") { event.preventDefault(); skip.focus(); }
  });
  return true;
}
