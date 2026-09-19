import { playSfx, playBgm, stopBgm } from "./audio.js?v=20260920-gallery-spoilers-a1";

export async function playActionSequence(app, sequenceData, onComplete) {
  app.innerHTML = renderSequence(sequenceData);

  const leftHpBar = app.querySelector(".seq-hp-fill.left");
  const rightHpBar = app.querySelector(".seq-hp-fill.right");
  const rightImage = app.querySelector(".seq-fighter-image.right");
  const leftImage = app.querySelector(".seq-fighter-image.left");
  const damageContainer = app.querySelector(".seq-damage-container");
  const titlePhase = app.querySelector("[data-seq-phase='title']");
  const fightPhase = app.querySelector("[data-seq-phase='fight']");
  const championPhase = app.querySelector("[data-seq-phase='champion']");
  const narrationPhase = app.querySelector("[data-seq-phase='narration']");
  const introPhase = app.querySelector("[data-seq-phase='intro']");
  const championImage = app.querySelector(".seq-champion-image");
  const championFallback = app.querySelector(".seq-champion-fallback");
  const introBackground = app.querySelector(".seq-intro-bg-image");
  const introFallback = app.querySelector(".seq-intro-fallback");
  const introSpeaker = app.querySelector(".seq-dialogue-speaker");
  const introText = app.querySelector(".seq-dialogue-text");
  const introHint = app.querySelector(".seq-dialogue-hint");
  const introLeftAvatar = app.querySelector(".seq-dialogue-avatar.left");
  const introRightAvatar = app.querySelector(".seq-dialogue-avatar.right");

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const arena = app.querySelector(".seq-arena");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const pulseTimers = new WeakMap();
  const pulse = (node, name) => {
    if (!node || reducedMotion) return;
    const timers = pulseTimers.get(node) ?? {};
    clearTimeout(timers[name]);
    node.classList.remove(name);
    void node.offsetWidth;
    node.classList.add(name);
    timers[name] = setTimeout(() => node.classList.remove(name), 420);
    pulseTimers.set(node, timers);
  };
  const impact = document.createElement("div");
  impact.className = "seq-hit-burst";
  impact.setAttribute("aria-hidden", "true");
  arena.appendChild(impact);
  const setup = sequenceData.setup;
  const openingText = sequenceData.openingText ?? {};
  let lastHitPosition = null;
  let lastHitSide = "right";
  const hitPosition = (step) => {
    const image = step.target === "left" ? leftImage : rightImage;
    const imageRect = image.getBoundingClientRect();
    const arenaRect = arena.getBoundingClientRect();
    const body = parseFloat(step.y) >= 45;
    return {
      x: imageRect.left - arenaRect.left + imageRect.width * .52,
      y: imageRect.top - arenaRect.top + imageRect.height * (body ? .5 : .24),
    };
  };
  // Prepare fighting frames before their short impact timings begin.
  const decode = (image) => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 5000);
    image.decode().then(() => { clearTimeout(timer); resolve(image.naturalWidth > 0); })
      .catch(() => { clearTimeout(timer); resolve(false); });
  });
  const frameSources = new Set([setup.leftSprite, setup.rightSprite,
    ...sequenceData.steps.filter(step => step.type === "updateSprite").map(step => step.src)]);
  arena.classList.add("seq-preparing");
  await Promise.all([...frameSources].map(src => { const image = new Image(); image.src = assetUrl(src); return decode(image); }));
  const updateFrame = async (side, src) => {
    const image = side === "left" ? leftImage : rightImage;
    if (!image) return;
    image.style.visibility = "hidden";
    image.src = assetUrl(src);
    const loaded = await decode(image);
    image.style.visibility = loaded ? "" : "hidden";
    image.parentElement.dataset.missing = String(!loaded);
  };
  await Promise.all([updateFrame("left", setup.leftSprite), updateFrame("right", setup.rightSprite)]);
  arena.classList.remove("seq-preparing");
  const startFight = () => { playBgm("battle"); playSfx("bell"); };
  if (!openingText.matchTitle?.title) startFight();

  let currentRightHp = setup.rightHpInitial ?? setup.rightHpMax;
  let currentLeftHp = setup.leftHpInitial ?? setup.leftHpMax;

  applyHp(leftHpBar, currentLeftHp, setup.leftHpMax);
  applyHp(rightHpBar, currentRightHp, setup.rightHpMax);

  for (const step of sequenceData.steps) {
    if (step.type === "wait") {
      await wait(step.duration);
    } else if (step.type === "showMatchTitle") {
      setActivePhase(titlePhase, fightPhase, championPhase, narrationPhase, introPhase, "title");
      await wait(step.duration ?? 1800);
      setActivePhase(titlePhase, fightPhase, championPhase, narrationPhase, introPhase, "fight");
      startFight();
      await wait(250);
    } else if (step.type === "updateSprite") {
      await updateFrame(step.target, step.src);
      if (/(jab|straight|body|uppercut_2)\.png$/.test(step.src)) {
        pulse(app.querySelector(`.seq-fighter-${step.target}`), "seq-step-in");
      }
    } else if (step.type === "impactSprite") {
      const image = step.target === "right" ? rightImage : leftImage;
      if (image && !reducedMotion) {
        const motionClass = step.motion === "lift-left-down" ? "seq-impact-lift-left-down" : "seq-impact-pop";
        image.classList.remove("seq-impact-pop", "seq-impact-lift-left-down");
        void image.offsetWidth;
        image.classList.add(motionClass);
      }
    } else if (step.type === "shakeScreen") {
      if (reducedMotion) continue;
      app.classList.remove("shake-screen");
      void app.offsetWidth;
      app.classList.add("shake-screen");
      setTimeout(() => app.classList.remove("shake-screen"), step.duration ?? 400);
    } else if (step.type === "damage") {
      lastHitSide = step.target;
      lastHitPosition = hitPosition(step);
      // Show damage number
      const dmgSpan = document.createElement("span");
      dmgSpan.className = "seq-damage-text";
      dmgSpan.textContent = step.amount;
      
      // Randomize position slightly
      const xOffset = Math.random() * 18 - 9;
      const yOffset = Math.random() * 16 - 8;
      dmgSpan.style.left = `${lastHitPosition.x + xOffset}px`;
      dmgSpan.style.top = `${lastHitPosition.y + yOffset - 20}px`;
      
      damageContainer.appendChild(dmgSpan);

      setTimeout(() => dmgSpan.remove(), 800);

      if (!step.noHpLoss) {
        if (step.target === "right" && rightHpBar) {
          currentRightHp = Math.max(0, currentRightHp - step.amount);
          applyHp(rightHpBar, currentRightHp, setup.rightHpMax);
        } else if (step.target === "left" && leftHpBar) {
          currentLeftHp = Math.max(0, currentLeftHp - step.amount);
          applyHp(leftHpBar, currentLeftHp, setup.leftHpMax);
        }
      }
      impact.style.left = `${lastHitPosition.x}px`;
      impact.style.top = `${lastHitPosition.y}px`;
      impact.classList.toggle("is-heavy", step.amount >= 20);
      pulse(impact, "is-hit");
      pulse(arena, "seq-strike-shake");
      pulse(app.querySelector(`.seq-fighter-${step.target}`), "seq-strike-recoil");
      playSfx("hit");
      arena.classList.add("seq-hitstop");
      await wait(reducedMotion ? 0 : step.amount >= 20 ? 100 : 65);
      arena.classList.remove("seq-hitstop");
    } else if (step.type === "mouthpiece") {
      const mouthPosition = hitPosition({ target: lastHitSide, y: "27%" });
      const mp = document.createElement("div");
      mp.className = "seq-mouthpiece" + (step.color ? ` ${step.color}` : "");
      mp.style.left = `${mouthPosition.x}px`;
      mp.style.top = `${mouthPosition.y}px`;
      if (step.direction === "left-down") {
        mp.classList.add("left-down");
      }
      
      damageContainer.appendChild(mp);
      setTimeout(() => mp.remove(), 1000);
    } else if (step.type === "blackout") {
      const overlay = document.createElement("div");
      overlay.className = "seq-blackout-overlay";
      app.appendChild(overlay);
      void overlay.offsetWidth;
      overlay.classList.add("is-active");
      await wait(step.duration || 1000);
    } else if (step.type === "showKO") {
      playSfx("ko");
      playSfx("result");
      const koEl = app.querySelector(".seq-ko-text");
      if (koEl) {
        koEl.style.display = "block";
        koEl.classList.add("seq-ko-anim");
      }
      await wait(850);
    } else if (step.type === "showChampionScene") {
      stopBgm();
      setActivePhase(titlePhase, fightPhase, championPhase, narrationPhase, introPhase, "champion");
      primeImage(championImage, championFallback);
      await wait(step.duration ?? 2500);
    } else if (step.type === "showNarration") {
      championPhase.classList.add("is-active");
      narrationPhase.classList.add("is-active");
      await waitForPointerAdvance(narrationPhase);
    } else if (step.type === "showIntroScene") {
      stopBgm();
      setActivePhase(titlePhase, fightPhase, championPhase, narrationPhase, introPhase, "intro");
      primeImage(introBackground, introFallback);

      const dialogues = openingText.introScene?.dialogues ?? [];
      const introLeftCharacter = app.querySelector(".seq-intro-character-image.left");
      const introRightCharacter = app.querySelector(".seq-intro-character-image.right");
      const introEffects = app.querySelector(".seq-intro-effects");
      for (let index = 0; index < dialogues.length; index += 1) {
        const line = dialogues[index];
        if (introSpeaker) introSpeaker.textContent = line.speaker;
        if (introText) introText.textContent = line.text;
        if (introHint) {
          introHint.textContent = `${index + 1} / ${dialogues.length} クリック・タップ・Enter で進む`;
        }
        if (line.leftImage && introLeftCharacter) {
          introLeftCharacter.src = assetUrl(line.leftImage);
        }
        if (line.rightImage && introRightCharacter) {
          introRightCharacter.src = assetUrl(line.rightImage);
        }
        updateDialogueAvatars(introLeftAvatar, introRightAvatar, line.speakerVisual);
        triggerIntroEffect(app, introEffects, line.effect);
        await waitForPointerAdvance(introPhase);
      }
    }
  }

  await wait(600);
  stopBgm();
  if (onComplete) onComplete();
}

function assetUrl(src) {
  if (!src) return "";
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}v=20260702-title-cg-1`;
}

function applyHp(bar, current, max) {
  if (!bar || !max) return;
  const ratio = Math.max(0, Math.min(1, current / max));
  bar.style.width = `${ratio * 100}%`;
}

function setActivePhase(titlePhase, fightPhase, championPhase, narrationPhase, introPhase, nextPhase) {
  const phaseMap = {
    title: titlePhase,
    fight: fightPhase,
    champion: championPhase,
    narration: narrationPhase,
    intro: introPhase,
  };

  Object.entries(phaseMap).forEach(([key, element]) => {
    if (!element) return;
    element.classList.toggle("is-active", key === nextPhase);
  });
}

function primeImage(image, fallback) {
  if (!image || !fallback) return;
  image.style.display = "";
  fallback.style.display = "none";
}

function waitForPointerAdvance(container) {
  return new Promise((resolve) => {
    if (!container) {
      resolve();
      return;
    }

    const cleanup = () => {
      container.removeEventListener("click", handleAdvance);
      window.removeEventListener("keydown", handleKeydown);
    };

    const handleAdvance = () => {
      cleanup();
      resolve();
    };

    const handleKeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      handleAdvance();
    };

    // Small delay prevents capturing immediately bubbling clicks from previous sequences
    setTimeout(() => {
      container.addEventListener("click", handleAdvance);
      window.addEventListener("keydown", handleKeydown);
    }, 50);
  });
}

function updateDialogueAvatars(leftAvatar, rightAvatar, activeSide) {
  if (leftAvatar) {
    leftAvatar.classList.toggle("is-active", activeSide === "left");
  }
  if (rightAvatar) {
    rightAvatar.classList.toggle("is-active", activeSide === "right");
  }
}

function triggerIntroEffect(app, container, effect) {
  if (!effect) {
    return;
  }

  if (effect === "shake") {
    app.classList.remove("shake-screen");
    void app.offsetWidth;
    app.classList.add("shake-screen");
    setTimeout(() => app.classList.remove("shake-screen"), 400);
    return;
  }

  if (!container) {
    return;
  }

  if (effect === "sweat") {
    spawnIntroFx(container, "seq-fx-sweat", { left: "16%", top: "21%" }, 900);
    return;
  }

  if (effect === "wobble") {
    ["~", "～", "〰"].forEach((mark, index) => {
      spawnIntroFx(container, "seq-fx-wobble", { left: `${73 + index * 5}%`, top: `${18 + index * 4}%` }, 1100, mark);
    });
    return;
  }

  if (effect === "sigh") {
    ["ふぅ", "…", "〜"].forEach((mark, index) => {
      spawnIntroFx(container, "seq-fx-sigh", { left: `${23 + index * 4}%`, top: `${23 - index * 2}%` }, 1200, mark);
    });
    return;
  }

  if (effect === "hearts") {
    ["❤", "❤", "❤"].forEach((mark, index) => {
      spawnIntroFx(container, "seq-fx-heart", { left: `${73 + index * 4}%`, top: `${20 + index * 5}%` }, 1300, mark);
    });
  }
}

function spawnIntroFx(container, className, position, duration, text = "") {
  const node = document.createElement("span");
  node.className = `seq-intro-fx ${className}`;
  node.textContent = text;
  node.style.left = position.left;
  node.style.top = position.top;
  container.appendChild(node);
  setTimeout(() => node.remove(), duration);
}

function renderSequence(sequenceData) {
  const setup = sequenceData.setup ?? {};
  const opening = sequenceData.openingText ?? {};
  const matchTitle = opening.matchTitle ?? {};
  const hasMatchTitle = Boolean(matchTitle.title);
  const champion = opening.championScene ?? {};
  const narration = opening.narration ?? {};
  const intro = opening.introScene ?? {};
  const introCharacters = intro.characters ?? {};
  const introLeft = introCharacters.left ?? {};
  const introRight = introCharacters.right ?? {};
  const initialDialogue = intro.dialogues?.[0] ?? { speaker: "", text: "" };

  return `
    <main class="screen sequence-screen cinematic-screen">
      <section class="seq-phase seq-phase-title${hasMatchTitle ? " is-active" : ""}" data-seq-phase="title">
        <div class="seq-title-card">
          <p class="seq-title-label">${matchTitle.label ?? ""}</p>
          <h2 class="seq-title-main">${matchTitle.title ?? ""}</h2>
          <p class="seq-title-sub">${matchTitle.subtitle ?? ""}</p>
        </div>
      </section>

      <section class="seq-phase seq-phase-fight${hasMatchTitle ? "" : " is-active"}" data-seq-phase="fight">
        <div class="seq-arena">
          <img class="seq-arena-bg" src="${assetUrl(setup.background)}" alt="Arena Setup">

          <div class="seq-hud">
            <div class="seq-status seq-status-left">
              <div class="seq-name">${setup.leftName}</div>
              <div class="seq-hp-bar">
                <div class="seq-hp-fill left"></div>
              </div>
            </div>
            <div class="seq-status seq-status-right">
              <div class="seq-name">${setup.rightName}</div>
              <div class="seq-hp-bar">
                <div class="seq-hp-fill right"></div>
              </div>
            </div>
          </div>

          <div class="seq-fighters">
            <div class="seq-fighter seq-fighter-left">
              <img class="seq-fighter-image left" src="${assetUrl(setup.leftSprite)}" alt="${setup.leftName}">
              <span class="seq-frame-fallback">${setup.leftName}</span>
            </div>
            <div class="seq-fighter seq-fighter-right">
              <img class="seq-fighter-image right" src="${assetUrl(setup.rightSprite)}" alt="${setup.rightName}">
              <span class="seq-frame-fallback">${setup.rightName}</span>
            </div>
          </div>

          <div class="seq-damage-container"></div>
          <div class="seq-ko-text" style="display: none;">K.O.!</div>
        </div>
      </section>

      <section class="seq-phase seq-phase-champion" data-seq-phase="champion">
        <div class="seq-story-card">
          <p class="seq-story-label">${champion.title ?? ""}</p>
          <div class="seq-story-media">
            <img
              class="seq-champion-image"
              src="${assetUrl(champion.image ?? "")}"
              alt="${champion.alt ?? ""}"
              onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
            >
            <div class="seq-story-fallback seq-champion-fallback" style="display:none;">
              <strong>${champion.placeholderTitle ?? "Champion Image"}</strong>
              <span>${champion.placeholderBody ?? ""}</span>
            </div>
          </div>
          <h2 class="seq-story-title">${champion.subtitle ?? ""}</h2>
        </div>
      </section>

      <section class="seq-phase seq-phase-narration" data-seq-phase="narration">
        <div class="seq-narration-layer">
          <div class="seq-narration-card">
            <p class="seq-story-label">${narration.label ?? ""}</p>
            <p class="seq-narration-text">${narration.text ?? ""}</p>
            <p class="seq-dialogue-hint" style="text-align: center;">クリック・タップ・Enter で進む</p>
          </div>
        </div>
      </section>

      <section class="seq-phase seq-phase-intro" data-seq-phase="intro">
        <div class="seq-intro-scene">
          <img
            class="seq-intro-bg-image"
            src="${assetUrl(intro.background ?? intro.image ?? "")}"
            alt="${intro.alt ?? ""}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
          >
          <div class="seq-story-fallback seq-intro-fallback" style="display:none;">
            <strong>${intro.placeholderTitle ?? "Intro Scene"}</strong>
            <span>${intro.placeholderBody ?? ""}</span>
          </div>

          <div class="seq-intro-characters">
            <div class="seq-intro-character left">
              <img
                class="seq-intro-character-image left"
                src="${assetUrl(introLeft.image ?? "")}"
                alt="${introLeft.alt ?? introLeft.name ?? "Left Character"}"
                onerror="this.style.display='none';"
              >
            </div>
            <div class="seq-intro-character right">
              <img
                class="seq-intro-character-image right"
                src="${assetUrl(introRight.image ?? "")}"
                alt="${introRight.alt ?? introRight.name ?? "Right Character"}"
                onerror="this.style.display='none';"
              >
            </div>
          </div>

          <div class="seq-intro-effects" aria-hidden="true"></div>

          <div class="seq-retro-dialogue">
            <div class="seq-retro-dialogue-header">
              <span>${intro.dialogueLabel ?? "TALK"}</span>
              <span>${intro.title ?? ""}</span>
            </div>
            <div class="seq-dialogue-avatars">
              <div class="seq-dialogue-avatar left${initialDialogue.speakerVisual === "left" ? " is-active" : ""}">
                <img
                  class="seq-dialogue-avatar-image"
                  src="${assetUrl(introLeft.image ?? "")}"
                  alt="${introLeft.alt ?? introLeft.name ?? "Left Character"}"
                  onerror="this.style.display='none';this.parentElement.textContent='L';"
                >
              </div>
              <div class="seq-dialogue-avatar right${initialDialogue.speakerVisual === "right" ? " is-active" : ""}">
                <img
                  class="seq-dialogue-avatar-image"
                  src="${assetUrl(introRight.image ?? "")}"
                  alt="${introRight.alt ?? introRight.name ?? "Right Character"}"
                  onerror="this.style.display='none';this.parentElement.textContent='R';"
                >
              </div>
            </div>
            <div class="seq-dialogue-speaker">${initialDialogue.speaker}</div>
            <div class="seq-dialogue-text">${initialDialogue.text}</div>
            <div class="seq-dialogue-hint">クリック・タップ・Enter で進む</div>
          </div>
        </div>
      </section>
    </main>
  `;
}
