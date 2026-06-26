/* >>> HOMEPAGE-EDITOR PARTICLES JS START >>> */
/* ============================================================================
 * ============================================================================
 * START OF OLD /srv/start TRANSFER: INTERACTIVE BACKGROUND + FPS BUTTON
 * ----------------------------------------------------------------------------
 * Что это:
 * - интерактивный фон с частицами, реагирующий на мышь
 * - кнопка FPS в верхней панели
 *
 * Как отключить целиком:
 * - закомментировать или удалить весь блок до END OF OLD /srv/start TRANSFER
 * ============================================================================
 * ========================================================================== */

(function homepageInteractiveBackgroundAndFps() {
  const PARTICLE_ROOT_ID = "homepage-particles-root";
  const PARTICLE_CANVAS_ID = "homepage-particles-canvas";
  const EFFECTS_ROOT_ID = "homepage-effects-root";
  const FPS_ROOT_ID = "homepage-fps-root";
  const FPS_BUTTON_ID = "homepage-fps-button";
  const FPS_MENU_ID = "homepage-fps-menu";
  const backgroundEffectsEnabled = true;
  const DEFAULT_EFFECT = "rocket";
  const EFFECT_SESSION_KEY = "homepage-background-effects-v2";
  const PAUSE_SESSION_KEY = "homepage-background-paused";
  const BACKGROUND_EFFECTS = [
    ["particles", "Частицы"],
    ["stars", "Звёзды"],
    ["fog", "Туман"],
    ["rocket", "Ракета"],
    ["lava", "Лава"],
    ["meteor", "Метеор"],
  ];
  const PARTICLE_SETTINGS = {
    baseCount: 72,
    maxCount: 120,
    targetFps: 30,
    maxDpr: 1.5,
    pointOpacity: 0.46,
    lineOpacity: 0.28,
    lineDistance: 130,
    repulseDistance: 180,
    repulseVelocity: 45,
    clickAddCount: 4,
    velocityScale: 0.08, /* Скорость */
    maxRadius: 4,
    minVisibleRadius: 0.2,
  };
  const ROCKET_SETTINGS = {
    minCycleSeconds: 54,
    maxCycleSeconds: 92,
    initialLeadSeconds: 12,
  };

  if (!backgroundEffectsEnabled) {
    document.getElementById(PARTICLE_ROOT_ID)?.remove();
    document.getElementById(EFFECTS_ROOT_ID)?.remove();
    document.getElementById(FPS_ROOT_ID)?.remove();
    return;
  }

  if (window.__homepageInteractiveBackgroundInitialized) {
    return;
  }

  window.__homepageInteractiveBackgroundInitialized = true;

  const state = {
    animationFrameId: 0,
    fpsFrameId: 0,
    canvas: null,
    context: null,
    effectsRoot: null,
    fpsButton: null,
    fpsMenu: null,
    boundFpsButton: null,
    boundFpsMenu: null,
    paused: false,
    currentFps: 0,
    frameCount: 0,
    lastFpsTime: 0,
    lastFrameTime: 0,
    fpsFrameCount: 0,
    fpsLastTime: 0,
    particles: [],
    pointer: {
      active: false,
      x: 0,
      y: 0,
    },
    size: {
      width: 0,
      height: 0,
      dpr: 1,
    },
    selectedEffects: new Set([DEFAULT_EFFECT]),
    placementFrameId: 0,
    rocketPointerFrameId: 0,
    rocketPointer: {
      x: 0,
      y: 0,
    },
  };

  function ready(callback) {
    const run = () => setTimeout(callback, 200);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
      return;
    }

    run();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function getTopHost() {
    const topbarRoot = document.getElementById("homepage-topbar-root");
    if (topbarRoot) {
      return topbarRoot;
    }

    const informationWidgets = document.getElementById("information-widgets");
    if (informationWidgets?.parentElement) {
      return informationWidgets.parentElement;
    }

    return document.getElementById("page_wrapper") || document.body;
  }

  function ensureParticleRoot() {
    const host = document.getElementById("page_wrapper") || document.body;
    if (!host) {
      return null;
    }

    let root = document.getElementById(PARTICLE_ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = PARTICLE_ROOT_ID;
      root.innerHTML = `<canvas id="${PARTICLE_CANVAS_ID}"></canvas>`;
    }

    if (root.parentElement !== host) {
      host.prepend(root);
    }

    const canvas = root.querySelector(`#${PARTICLE_CANVAS_ID}`);
    if (!canvas) {
      return null;
    }

    state.canvas = canvas;
    state.context = canvas.getContext("2d");
    return root;
  }

  function ensureEffectsRoot() {
    const host = document.getElementById("page_wrapper") || document.body;
    if (!host) {
      return null;
    }

    let root = document.getElementById(EFFECTS_ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = EFFECTS_ROOT_ID;
      root.setAttribute("aria-hidden", "true");
      root.innerHTML = BACKGROUND_EFFECTS.filter(([effect]) => effect !== "particles")
        .map(([effect]) => {
          if (effect === "rocket") {
            return `<div class="homepage-background-effect homepage-effect-${effect}" data-effect="${effect}"><span class="homepage-rocket-flight" aria-hidden="true"></span></div>`;
          }

          return `<div class="homepage-background-effect homepage-effect-${effect}" data-effect="${effect}"></div>`;
        })
        .join("");
    }

    if (root.parentElement !== host) {
      const particleRoot = document.getElementById(PARTICLE_ROOT_ID);
      if (particleRoot?.parentElement === host) {
        host.insertBefore(root, particleRoot.nextSibling);
      } else {
        host.prepend(root);
      }
    }

    state.effectsRoot = root;
    const rocketLayer = root.querySelector('[data-effect="rocket"]');
    if (rocketLayer) {
      let rocketFlight = rocketLayer.querySelector(".homepage-rocket-flight");
      if (!rocketFlight) {
        rocketFlight = document.createElement("span");
        rocketFlight.className = "homepage-rocket-flight";
        rocketFlight.setAttribute("aria-hidden", "true");
        rocketLayer.appendChild(rocketFlight);
      }

      if (!rocketFlight.dataset.rocketIterationBound) {
        rocketFlight.dataset.rocketIterationBound = "true";
        rocketFlight.addEventListener("animationiteration", () => {
          configureRocketFlight(false);
        });
      }

      if (!rocketLayer.style.getPropertyValue("--rocket-cycle")) {
        configureRocketFlight(true);
      }
    }

    return root;
  }

  function ensureFpsButton() {
    const topHost = getTopHost();
    if (!topHost) {
      return null;
    }

    let fpsRoot = document.getElementById(FPS_ROOT_ID);
    if (!fpsRoot) {
      fpsRoot = document.createElement("div");
      fpsRoot.id = FPS_ROOT_ID;
      fpsRoot.innerHTML = `
        <button id="${FPS_BUTTON_ID}" type="button">FPS</button>
      `;
    }

    const ipRoot = document.getElementById("homepage-ip-root");

    if (fpsRoot.parentElement !== topHost) {
      if (ipRoot?.parentElement === topHost) {
        topHost.insertBefore(fpsRoot, ipRoot);
      } else {
        topHost.prepend(fpsRoot);
      }
    } else if (ipRoot?.parentElement === topHost && fpsRoot.nextElementSibling !== ipRoot) {
      topHost.insertBefore(fpsRoot, ipRoot);
    }

    const fpsButton = fpsRoot.querySelector(`#${FPS_BUTTON_ID}`);
    if (!fpsButton) {
      return null;
    }

    state.fpsButton = fpsButton;
    bindFpsControls();
    return fpsButton;
  }

  function bindFpsControls() {
    if (state.fpsButton && state.boundFpsButton !== state.fpsButton) {
      state.boundFpsButton = state.fpsButton;
      state.fpsButton.addEventListener("click", () => {
        state.paused = !state.paused;
        savePausedState();
        applyPauseState();
        updateFpsButtonLabel();
      });
    }
  }

  function updateFpsButtonLabel(fps = null) {
    if (!state.fpsButton) {
      return;
    }

    if (Number.isFinite(fps)) {
      state.currentFps = fps;
    }

    const pauseMarkup = state.paused
      ? '<img class="homepage-fps-icon" src="/images/radio/pause.png" alt="">'
      : "";

    state.fpsButton.innerHTML = `${pauseMarkup}<span class="homepage-fps-label">${state.currentFps} FPS</span>`;
    state.fpsButton.classList.toggle("is-paused", state.paused);
    state.fpsButton.setAttribute("aria-pressed", state.paused ? "true" : "false");
  }

  function applyPauseState() {
    const particleRoot = document.getElementById(PARTICLE_ROOT_ID);
    if (particleRoot) {
      particleRoot.classList.toggle("is-paused", state.paused);
    }

    const effectsRoot = document.getElementById(EFFECTS_ROOT_ID);
    if (effectsRoot) {
      effectsRoot.classList.toggle("is-paused", state.paused);
      effectsRoot.dataset.paused = state.paused ? "true" : "false";
    }

    syncParticleLoop();
  }

  function shouldRunParticleLoop() {
    return Boolean(state.context && isEffectEnabled("particles") && !state.paused && !document.hidden);
  }

  function resetFpsCounters() {
    state.frameCount = 0;
    state.lastFpsTime = 0;
    state.lastFrameTime = 0;
  }

  function startParticleLoop() {
    if (state.animationFrameId || !shouldRunParticleLoop()) {
      return;
    }

    resetFpsCounters();
    state.animationFrameId = window.requestAnimationFrame(drawFrame);
  }

  function stopParticleLoop() {
    if (state.animationFrameId) {
      window.cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = 0;
    }

    resetFpsCounters();
  }

  function syncParticleLoop() {
    if (shouldRunParticleLoop()) {
      startParticleLoop();
      return;
    }

    stopParticleLoop();
    if (state.canvas && state.context && !isEffectEnabled("particles")) {
      state.context.clearRect(0, 0, state.size.width, state.size.height);
    }
  }

  function resetFpsMeter() {
    state.fpsFrameCount = 0;
    state.fpsLastTime = 0;
  }

  function startFpsMeter() {
    if (state.fpsFrameId || document.hidden) {
      return;
    }

    resetFpsMeter();
    state.fpsFrameId = window.requestAnimationFrame(trackFps);
  }

  function stopFpsMeter() {
    if (state.fpsFrameId) {
      window.cancelAnimationFrame(state.fpsFrameId);
      state.fpsFrameId = 0;
    }

    resetFpsMeter();
  }

  function trackFps(timestamp) {
    if (document.hidden) {
      state.fpsFrameId = 0;
      resetFpsMeter();
      return;
    }

    if (!state.fpsLastTime) {
      state.fpsLastTime = timestamp;
    }

    state.fpsFrameCount += 1;

    if (timestamp >= state.fpsLastTime + 1000) {
      const elapsed = timestamp - state.fpsLastTime;
      updateFpsButtonLabel(Math.round((state.fpsFrameCount * 1000) / elapsed));
      state.fpsFrameCount = 0;
      state.fpsLastTime = timestamp;
    }

    state.fpsFrameId = window.requestAnimationFrame(trackFps);
  }

  function loadPausedState() {
    try {
      return window.sessionStorage.getItem(PAUSE_SESSION_KEY) === "true";
    } catch {
      return false;
    }
  }

  function savePausedState() {
    try {
      window.sessionStorage.setItem(PAUSE_SESSION_KEY, state.paused ? "true" : "false");
    } catch {
      // Ignore storage failures in private sessions.
    }
  }

  function getDefaultEffects() {
    return new Set([DEFAULT_EFFECT]);
  }

  function loadSelectedEffects() {
    try {
      const stored = window.sessionStorage.getItem(EFFECT_SESSION_KEY);
      if (!stored) {
        return getDefaultEffects();
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return getDefaultEffects();
      }

      const allowedEffects = new Set(BACKGROUND_EFFECTS.map(([effect]) => effect));
      return new Set(parsed.filter((effect) => allowedEffects.has(effect)));
    } catch {
      return getDefaultEffects();
    }
  }

  function saveSelectedEffects() {
    try {
      window.sessionStorage.setItem(EFFECT_SESSION_KEY, JSON.stringify([...state.selectedEffects]));
    } catch {
      // Ignore storage failures in private sessions.
    }
  }

  function isEffectEnabled(effect) {
    return state.selectedEffects.has(effect);
  }

  function applySelectedEffects() {
    const particleRoot = document.getElementById(PARTICLE_ROOT_ID);
    if (particleRoot) {
      particleRoot.hidden = !isEffectEnabled("particles");
    }

    if (state.canvas && !isEffectEnabled("particles")) {
      state.context?.clearRect(0, 0, state.size.width, state.size.height);
    }

    const effectsRoot = ensureEffectsRoot();
    effectsRoot?.querySelectorAll("[data-effect]").forEach((layer) => {
      layer.classList.toggle("is-active", isEffectEnabled(layer.dataset.effect));
    });

    applyPauseState();
    syncParticleLoop();
    applyRocketPointer();
    updateFpsButtonLabel();
  }

  function toggleEffect(effect) {
    if (isEffectEnabled(effect)) {
      state.selectedEffects.delete(effect);
    } else {
      state.selectedEffects.add(effect);
    }

    saveSelectedEffects();
    applySelectedEffects();
  }

  function buildParticle(position = null) {
    const radius = Math.max(PARTICLE_SETTINGS.minVisibleRadius, Math.random() * PARTICLE_SETTINGS.maxRadius);
    let x = position?.x ?? Math.random() * state.size.width;
    let y = position?.y ?? Math.random() * state.size.height;

    if (x > state.size.width - radius * 2) x -= radius;
    else if (x < radius * 2) x += radius;

    if (y > state.size.height - radius * 2) y -= radius;
    else if (y < radius * 2) y += radius;

    return {
      x,
      y,
      vx: (Math.random() - 0.5) * PARTICLE_SETTINGS.velocityScale * 2,
      vy: (Math.random() - 0.5) * PARTICLE_SETTINGS.velocityScale * 2,
      radius,
    };
  }

  function getParticleCount() {
    const viewportScale = clamp((state.size.width * state.size.height) / (1920 * 1080), 0.55, 1);
    return Math.round(PARTICLE_SETTINGS.baseCount * viewportScale);
  }

  function rebuildParticles() {
    const nextCount = getParticleCount();

    if (state.particles.length === nextCount) {
      return;
    }

    state.particles = Array.from({ length: nextCount }, () => buildParticle());
  }

  function addParticlesAt(x, y, amount = PARTICLE_SETTINGS.clickAddCount) {
    const nextParticles = [...state.particles];

    for (let index = 0; index < amount; index += 1) {
      nextParticles.push(buildParticle({ x, y }));
    }

    state.particles = nextParticles.slice(-PARTICLE_SETTINGS.maxCount);
  }

  function isFreeSpaceClick(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (
      target.closest(
        [
          "a",
          "button",
          "input",
          "textarea",
          "select",
          "label",
          "dialog",
          "[role='button']",
          "[role='menuitem']",
          "#homepage-topbar-root",
          "#information-widgets",
          "#bookmarks",
          "#services",
          ".service-card",
          ".bookmark",
        ].join(", "),
      )
    ) {
      return false;
    }

    return Boolean(target.closest("#page_wrapper, #inner_wrapper, body"));
  }

  function resizeCanvas() {
    if (!state.canvas || !state.context) {
      return;
    }

    const dpr = clamp(window.devicePixelRatio || 1, 1, PARTICLE_SETTINGS.maxDpr);
    const width = window.innerWidth;
    const height = window.innerHeight;

    state.size = { width, height, dpr };

    state.canvas.width = Math.round(width * dpr);
    state.canvas.height = Math.round(height * dpr);
    state.canvas.style.width = `${width}px`;
    state.canvas.style.height = `${height}px`;
    state.context.setTransform(dpr, 0, 0, dpr, 0, 0);

    rebuildParticles();
    syncParticleLoop();
  }

  function drawFrame(timestamp) {
    if (!shouldRunParticleLoop()) {
      state.animationFrameId = 0;
      return;
    }

    const frameInterval = 1000 / PARTICLE_SETTINGS.targetFps;
    if (state.lastFrameTime && timestamp - state.lastFrameTime < frameInterval) {
      state.animationFrameId = window.requestAnimationFrame(drawFrame);
      return;
    }

    const width = state.size.width;
    const height = state.size.height;
    const context = state.context;
    context.clearRect(0, 0, width, height);

    for (const particle of state.particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;

      if (particle.x < -particle.radius) {
        particle.x = width + particle.radius;
      } else if (particle.x > width + particle.radius) {
        particle.x = -particle.radius;
      }

      if (particle.y < -particle.radius) {
        particle.y = height + particle.radius;
      } else if (particle.y > height + particle.radius) {
        particle.y = -particle.radius;
      }

      if (state.pointer.active) {
        const dx = particle.x - state.pointer.x;
        const dy = particle.y - state.pointer.y;
        const distanceSquared = dx * dx + dy * dy;
        const repulseDistanceSquared = PARTICLE_SETTINGS.repulseDistance * PARTICLE_SETTINGS.repulseDistance;

        if (distanceSquared > 0 && distanceSquared < repulseDistanceSquared) {
          const distance = Math.sqrt(distanceSquared);
          const normalizedDistance = distance / PARTICLE_SETTINGS.repulseDistance;
          const repulseFactor = clamp(
            (1 - normalizedDistance * normalizedDistance) * PARTICLE_SETTINGS.repulseVelocity,
            0,
            18,
          );

          particle.x += (dx / distance) * repulseFactor;
          particle.y += (dy / distance) * repulseFactor;
        }
      }
    }

    const lineDistanceSquared = PARTICLE_SETTINGS.lineDistance * PARTICLE_SETTINGS.lineDistance;
    for (let i = 0; i < state.particles.length; i += 1) {
      const source = state.particles[i];

      context.beginPath();
      context.fillStyle = `rgba(255, 255, 255, ${PARTICLE_SETTINGS.pointOpacity})`;
      context.arc(source.x, source.y, source.radius, 0, Math.PI * 2);
      context.fill();

      for (let j = i + 1; j < state.particles.length; j += 1) {
        const target = state.particles[j];
        const dx = source.x - target.x;
        const dy = source.y - target.y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared > lineDistanceSquared) {
          continue;
        }

        const distance = Math.sqrt(distanceSquared);
        const opacity = (1 - distance / PARTICLE_SETTINGS.lineDistance) * PARTICLE_SETTINGS.lineOpacity;
        context.beginPath();
        context.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        context.lineWidth = 1;
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }
    }

    state.lastFrameTime = timestamp;
    state.animationFrameId = window.requestAnimationFrame(drawFrame);
  }

  function ensurePlacement() {
    ensureParticleRoot();
    ensureEffectsRoot();
    ensureFpsButton();
    applySelectedEffects();
  }

  function scheduleEnsurePlacement() {
    if (state.placementFrameId) {
      return;
    }

    state.placementFrameId = window.requestAnimationFrame(() => {
      state.placementFrameId = 0;
      ensurePlacement();
    });
  }

  function getRocketLayer() {
    return state.effectsRoot?.querySelector('[data-effect="rocket"]') ||
      document.getElementById(EFFECTS_ROOT_ID)?.querySelector('[data-effect="rocket"]') ||
      null;
  }

  function getRocketAngle(fromPoint, toPoint) {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const dx = (toPoint.x - fromPoint.x) * width / 100;
    const dy = (toPoint.y - fromPoint.y) * height / 100;

    return clamp(Math.atan2(dx, -dy) * 180 / Math.PI, -32, 32);
  }

  function configureRocketFlight(isInitial) {
    const rocketLayer = getRocketLayer();
    if (!rocketLayer) {
      return;
    }

    const startX = randomBetween(10, 90);
    let direction = Math.random() < 0.5 ? -1 : 1;
    const drift = randomBetween(18, 42);

    if (startX + direction * drift < 10 || startX + direction * drift > 90) {
      direction *= -1;
    }

    const endX = clamp(startX + direction * drift, 10, 90);
    const travelX = endX - startX;
    const point0 = { x: startX, y: 94 };
    const point1 = {
      x: clamp(startX + travelX * randomBetween(0.24, 0.42) + randomBetween(-4, 4), 8, 92),
      y: randomBetween(68, 78),
    };
    const point2 = {
      x: clamp(startX + travelX * randomBetween(0.58, 0.78) + randomBetween(-5, 5), 8, 92),
      y: randomBetween(28, 42),
    };
    const point3 = {
      x: endX,
      y: randomBetween(-38, -28),
    };
    const cycleSeconds = randomBetween(ROCKET_SETTINGS.minCycleSeconds, ROCKET_SETTINGS.maxCycleSeconds);
    const initialLead = randomBetween(3, ROCKET_SETTINGS.initialLeadSeconds);

    rocketLayer.style.setProperty("--rocket-cycle", `${cycleSeconds.toFixed(1)}s`);
    rocketLayer.style.setProperty("--rocket-x0", `${point0.x.toFixed(1)}vw`);
    rocketLayer.style.setProperty("--rocket-x1", `${point1.x.toFixed(1)}vw`);
    rocketLayer.style.setProperty("--rocket-x2", `${point2.x.toFixed(1)}vw`);
    rocketLayer.style.setProperty("--rocket-x3", `${point3.x.toFixed(1)}vw`);
    rocketLayer.style.setProperty("--rocket-y0", `${point0.y.toFixed(1)}vh`);
    rocketLayer.style.setProperty("--rocket-y1", `${point1.y.toFixed(1)}vh`);
    rocketLayer.style.setProperty("--rocket-y2", `${point2.y.toFixed(1)}vh`);
    rocketLayer.style.setProperty("--rocket-y3", `${point3.y.toFixed(1)}vh`);
    rocketLayer.style.setProperty("--rocket-a0", `${getRocketAngle(point0, point1).toFixed(1)}deg`);
    rocketLayer.style.setProperty("--rocket-a1", `${getRocketAngle(point1, point2).toFixed(1)}deg`);
    rocketLayer.style.setProperty("--rocket-a2", `${getRocketAngle(point2, point3).toFixed(1)}deg`);
    rocketLayer.style.setProperty("--rocket-a3", `${getRocketAngle(point2, point3).toFixed(1)}deg`);

    if (isInitial) {
      rocketLayer.style.setProperty("--rocket-delay", `${(-initialLead).toFixed(1)}s`);
    }
  }

  function applyRocketPointer() {
    state.rocketPointerFrameId = 0;

    const rocketLayer = getRocketLayer();
    if (!rocketLayer) {
      return;
    }

    const steerDegrees = state.rocketPointer.x * 7 + state.rocketPointer.y * 3;
    const driftVw = state.rocketPointer.x * 8;
    const liftVh = state.rocketPointer.y * -5;

    rocketLayer.style.setProperty("--rocket-steer", `${steerDegrees.toFixed(2)}deg`);
    rocketLayer.style.setProperty("--rocket-drift", `${driftVw.toFixed(2)}vw`);
    rocketLayer.style.setProperty("--rocket-lift", `${liftVh.toFixed(2)}vh`);
  }

  function scheduleRocketPointerUpdate(event) {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;

    state.rocketPointer.x = clamp(event.clientX / width - 0.5, -0.5, 0.5);
    state.rocketPointer.y = clamp(event.clientY / height - 0.5, -0.5, 0.5);

    if (!state.rocketPointerFrameId) {
      state.rocketPointerFrameId = window.requestAnimationFrame(applyRocketPointer);
    }
  }

  function resetRocketPointer() {
    state.rocketPointer.x = 0;
    state.rocketPointer.y = 0;

    if (!state.rocketPointerFrameId) {
      state.rocketPointerFrameId = window.requestAnimationFrame(applyRocketPointer);
    }
  }

  function initialize() {
    state.selectedEffects = loadSelectedEffects();
    state.paused = loadPausedState();
    ensurePlacement();
    resizeCanvas();
    updateFpsButtonLabel();
    startFpsMeter();

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("pointermove", (event) => {
      state.pointer.active = true;
      state.pointer.x = event.clientX;
      state.pointer.y = event.clientY;
      scheduleRocketPointerUpdate(event);
    });
    window.addEventListener("pointerleave", () => {
      state.pointer.active = false;
      resetRocketPointer();
    });
    window.addEventListener("click", (event) => {
      if (!isFreeSpaceClick(event.target)) {
        return;
      }

      if (!isEffectEnabled("particles")) {
        return;
      }

      addParticlesAt(event.clientX, event.clientY);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopFpsMeter();
        stopParticleLoop();
        return;
      }

      startFpsMeter();
      syncParticleLoop();
    });

    const observerTarget =
      document.getElementById("information-widgets") ||
      document.getElementById("page_wrapper") ||
      document.body;

    if (observerTarget) {
      const observer = new MutationObserver(() => {
        scheduleEnsurePlacement();
      });

      observer.observe(observerTarget, { childList: true, subtree: true });
    }

    syncParticleLoop();
  }

  ready(initialize);
})();

/* ============================================================================
 * ============================================================================
 * END OF OLD /srv/start TRANSFER: INTERACTIVE BACKGROUND + FPS BUTTON
 * ============================================================================
 * ========================================================================== */
/* <<< HOMEPAGE-EDITOR PARTICLES JS END <<< */
