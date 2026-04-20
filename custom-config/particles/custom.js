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
  if (window.__homepageInteractiveBackgroundInitialized) {
    return;
  }

  window.__homepageInteractiveBackgroundInitialized = true;

  const PARTICLE_ROOT_ID = "homepage-particles-root";
  const PARTICLE_CANVAS_ID = "homepage-particles-canvas";
  const EFFECTS_ROOT_ID = "homepage-effects-root";
  const FPS_ROOT_ID = "homepage-fps-root";
  const FPS_BUTTON_ID = "homepage-fps-button";
  const FPS_MENU_ID = "homepage-fps-menu";
  const EFFECT_SESSION_KEY = "homepage-background-effects";
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
    baseCount: 100,
    pointOpacity: 0.5,
    lineOpacity: 0.4,
    lineDistance: 150,
    repulseDistance: 200,
    repulseVelocity: 100,
    clickAddCount: 4,
    velocityScale: 0.08, /* Скорость */
    maxRadius: 5,
    minVisibleRadius: 0.2,
  };

  const state = {
    animationFrameId: 0,
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
    selectedEffects: new Set(["particles"]),
  };

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }

    callback();
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
        .map(([effect]) => `<div class="homepage-background-effect homepage-effect-${effect}" data-effect="${effect}"></div>`)
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
        <button id="${FPS_BUTTON_ID}" type="button" aria-haspopup="true" aria-controls="${FPS_MENU_ID}">FPS</button>
        <div id="${FPS_MENU_ID}" class="homepage-fps-menu" role="menu"></div>
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
    state.fpsMenu = fpsRoot.querySelector(`#${FPS_MENU_ID}`);
    bindFpsControls();
    renderEffectsMenu();
    return fpsButton;
  }

  function bindFpsControls() {
    if (state.fpsButton && state.boundFpsButton !== state.fpsButton) {
      state.boundFpsButton = state.fpsButton;
      state.fpsButton.addEventListener("click", () => {
        state.paused = !state.paused;
        savePausedState();
        updateFpsButtonLabel();
      });
    }

    if (state.fpsMenu && state.boundFpsMenu !== state.fpsMenu) {
      state.boundFpsMenu = state.fpsMenu;
      state.fpsMenu.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        const button = target?.closest("[data-effect]");
        if (!button) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        toggleEffect(button.dataset.effect);
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
    applyPauseState();
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

  function loadSelectedEffects() {
    try {
      const stored = window.sessionStorage.getItem(EFFECT_SESSION_KEY);
      if (!stored) {
        return new Set(["particles"]);
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return new Set(["particles"]);
      }

      const allowedEffects = new Set(BACKGROUND_EFFECTS.map(([effect]) => effect));
      return new Set(parsed.filter((effect) => allowedEffects.has(effect)));
    } catch {
      return new Set(["particles"]);
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
    renderEffectsMenu();
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

  function renderEffectsMenu() {
    if (!state.fpsMenu) {
      return;
    }

    state.fpsMenu.innerHTML = BACKGROUND_EFFECTS.map(([effect, label]) => {
      const active = isEffectEnabled(effect);
      return `
        <button
          type="button"
          class="homepage-fps-menu-item${active ? " is-active" : ""}"
          data-effect="${effect}"
          role="menuitemcheckbox"
          aria-checked="${active ? "true" : "false"}"
        >
          <span>${label}</span>
        </button>
      `;
    }).join("");
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
    return PARTICLE_SETTINGS.baseCount;
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

    state.particles = nextParticles;
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

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    state.size = { width, height, dpr };

    state.canvas.width = Math.round(width * dpr);
    state.canvas.height = Math.round(height * dpr);
    state.canvas.style.width = `${width}px`;
    state.canvas.style.height = `${height}px`;
    state.context.setTransform(dpr, 0, 0, dpr, 0, 0);

    rebuildParticles();
  }

  function drawFrame(timestamp) {
    if (!state.context) {
      return;
    }

    const width = state.size.width;
    const height = state.size.height;
    const context = state.context;
    context.clearRect(0, 0, width, height);

    if (!isEffectEnabled("particles")) {
      if (!state.lastFpsTime) {
        state.lastFpsTime = timestamp;
      }

      state.frameCount += 1;

      if (timestamp >= state.lastFpsTime + 1000) {
        const elapsed = timestamp - state.lastFpsTime;
        const fps = Math.round((state.frameCount * 1000) / elapsed);
        updateFpsButtonLabel(fps);
        state.frameCount = 0;
        state.lastFpsTime = timestamp;
      }

      state.animationFrameId = window.requestAnimationFrame(drawFrame);
      return;
    }

    for (const particle of state.particles) {
      if (!state.paused) {
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
          const distance = Math.hypot(dx, dy);

          if (distance > 0 && distance < PARTICLE_SETTINGS.repulseDistance) {
            const repulseFactor = clamp(
              (1 / PARTICLE_SETTINGS.repulseDistance) *
                (-1 * Math.pow(distance / PARTICLE_SETTINGS.repulseDistance, 2) + 1) *
                PARTICLE_SETTINGS.repulseDistance *
                PARTICLE_SETTINGS.repulseVelocity,
              0,
              50,
            );

            particle.x += (dx / distance) * repulseFactor;
            particle.y += (dy / distance) * repulseFactor;
          }
        }
      }
    }

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
        const distance = Math.hypot(dx, dy);

        if (distance > PARTICLE_SETTINGS.lineDistance) {
          continue;
        }

        const opacity = (1 - distance / PARTICLE_SETTINGS.lineDistance) * PARTICLE_SETTINGS.lineOpacity;
        context.beginPath();
        context.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        context.lineWidth = 1;
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }
    }

    if (!state.lastFpsTime) {
      state.lastFpsTime = timestamp;
    }

    state.frameCount += 1;

    if (timestamp >= state.lastFpsTime + 1000) {
      const elapsed = timestamp - state.lastFpsTime;
      const fps = Math.round((state.frameCount * 1000) / elapsed);
      updateFpsButtonLabel(fps);
      state.frameCount = 0;
      state.lastFpsTime = timestamp;
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

  function initialize() {
    state.selectedEffects = loadSelectedEffects();
    state.paused = loadPausedState();
    ensurePlacement();
    resizeCanvas();
    updateFpsButtonLabel();

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("pointermove", (event) => {
      state.pointer.active = true;
      state.pointer.x = event.clientX;
      state.pointer.y = event.clientY;
    });
    window.addEventListener("pointerleave", () => {
      state.pointer.active = false;
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
        window.cancelAnimationFrame(state.animationFrameId);
        state.animationFrameId = 0;
        return;
      }

      if (!state.animationFrameId) {
        state.animationFrameId = window.requestAnimationFrame(drawFrame);
      }
    });

    const observerTarget =
      document.getElementById("information-widgets") ||
      document.getElementById("page_wrapper") ||
      document.body;

    if (observerTarget) {
      const observer = new MutationObserver(() => {
        window.requestAnimationFrame(ensurePlacement);
      });

      observer.observe(observerTarget, { childList: true, subtree: true });
    }

    state.animationFrameId = window.requestAnimationFrame(drawFrame);
  }

  ready(initialize);
})();

/* ============================================================================
 * ============================================================================
 * END OF OLD /srv/start TRANSFER: INTERACTIVE BACKGROUND + FPS BUTTON
 * ============================================================================
 * ========================================================================== */
/* <<< HOMEPAGE-EDITOR PARTICLES JS END <<< */
