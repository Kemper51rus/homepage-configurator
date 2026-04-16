/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */
(function homepageRadioWidget() {
  if (typeof window.__homepageRadioWidgetCleanup === "function") {
    try {
      window.__homepageRadioWidgetCleanup();
    } catch {
      // Ignore cleanup failures from previous mounts.
    }
  }

  window.__homepageRadioWidgetInitialized = true;
  window.__homepageRadioWidgetCleanup = null;

  // Radio stations format:
  // Station name, stream URL
  // * Station name, stream URL  -> default station
  const stationList = `
    TNT, https://tntradio.hostingradio.ru:8027/tntradio128.mp3?6c8e
    * DFM, https://dfm.hostingradio.ru/dfm96.aacp
    Power, https://radio.dline-media.com/powerhit128
    Energy, https://pub0302.101.ru:8443/stream/air/aac/64/99
  `;

  function createStationKey(label, index) {
    return `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "station"}-${index}`;
  }

  function parseStations(definition) {
    return definition
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const isDefault = line.startsWith("*");
        const normalizedLine = isDefault ? line.slice(1).trim() : line;
        const separatorIndex = normalizedLine.indexOf(",");
        if (separatorIndex === -1) {
          return null;
        }

        const label = normalizedLine.slice(0, separatorIndex).trim();
        const url = normalizedLine.slice(separatorIndex + 1).trim();

        if (!label || !url) {
          return null;
        }

        return {
          key: createStationKey(label, index),
          isDefault,
          label,
          url,
        };
      })
      .filter(Boolean);
  }

  const stations = parseStations(stationList);
  const defaultStation = stations.find((station) => station.isDefault) ?? stations[0] ?? null;

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }

    callback();
  }

  function clampVolume(value) {
    return Math.min(1, Math.max(0, value));
  }

  function formatVolume(volume) {
    return String(Math.round(volume * 10));
  }

  function copyTextToClipboard(text) {
    if (!text) {
      return Promise.resolve(false);
    }

    if (navigator?.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.top = "-9999px";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    helper.setSelectionRange(0, helper.value.length);

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    helper.remove();
    return Promise.resolve(copied);
  }

  function withTimeout(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    return fetch(url, { signal: controller.signal }).finally(() => {
      window.clearTimeout(timeoutId);
    });
  }

  function flagUrlFromCountryCode(countryCode) {
    if (!countryCode) {
      return "";
    }

    return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
  }

  async function requestIpInfo() {
    const providers = [
      async () => {
        const response = await withTimeout("https://ipwho.is/");
        if (!response.ok) {
          throw new Error("ipwho.is request failed");
        }

        const payload = await response.json();
        if (!payload?.success || !payload.ip) {
          throw new Error("ipwho.is payload invalid");
        }

        return {
          ip: payload.ip,
          isp: payload.connection?.isp || payload.connection?.org || "",
          flagImg: payload.flag?.img || flagUrlFromCountryCode(payload.country_code),
        };
      },
      async () => {
        const response = await withTimeout("https://ipapi.co/json/");
        if (!response.ok) {
          throw new Error("ipapi.co request failed");
        }

        const payload = await response.json();
        if (!payload?.ip) {
          throw new Error("ipapi.co payload invalid");
        }

        return {
          ip: payload.ip,
          isp: payload.org || payload.org_name || payload.asn || "",
          flagImg: flagUrlFromCountryCode(payload.country_code),
        };
      },
      async () => {
        const response = await withTimeout("https://api.ipify.org?format=json");
        if (!response.ok) {
          throw new Error("api.ipify.org request failed");
        }

        const payload = await response.json();
        if (!payload?.ip) {
          throw new Error("api.ipify payload invalid");
        }

        return {
          ip: payload.ip,
          isp: "",
          flagImg: "",
        };
      },
    ];

    for (const provider of providers) {
      try {
        return await provider();
      } catch {
        // Try the next provider.
      }
    }

    throw new Error("All IP providers failed");
  }

  function removeExistingRoots() {
    document.getElementById("homepage-topbar-root")?.remove();
    document.getElementById("homepage-radio-root")?.remove();
    document.getElementById("homepage-ip-root")?.remove();
  }

  function getTopHost() {
    const informationWidgets = document.getElementById("information-widgets");
    if (informationWidgets?.parentElement) {
      return informationWidgets.parentElement;
    }

    return document.getElementById("page_wrapper") || document.body;
  }

  function createIpButton() {
    const button = document.createElement("button");
    button.id = "ip";
    button.className = "ipcheck";
    button.type = "button";
    button.title = "Скопировать IP";
    return button;
  }

  function createRadioMarkup() {
    return `
      <div class="hpradio">
        <div class="jexumnav">
          <ul class="jexummenu">
            <li id="lif">
              <button id="playlist" class="jexum swb" type="button">
                <img id="pl" class="imgmpx" src="/images/radio/pl.png" alt="">
                &ensp;
                <img id="down4" class="px" src="/images/radio/down.png" alt="">
              </button>
              <ul class="jexumsub">
                ${stations
                  .map(
                    (station) =>
                      `<li><button id="${station.key}" class="jexum jeniumMradio" type="button">${station.label}</button></li>`,
                  )
                  .join("")}
              </ul>
            </li>
            <li>
              <button id="plapau" class="jexum radiopx" type="button">
                <img id="imgplay" class="imgmpx" src="/images/radio/play.png" alt="">
              </button>
            </li>
            <li>
              <button id="volumedown" class="jexum radiopx" type="button">
                <img id="dvolume" class="imgmpx" src="/images/radio/volume-down.png" alt="">
              </button>
            </li>
            <li>
              <button id="volumeset" class="jexum radiopx" type="button">10</button>
            </li>
            <li>
              <button id="volumeup" class="jexum radiopx" type="button">
                <img id="uvolume" class="imgmpx" src="/images/radio/volume-up.png" alt="">
              </button>
            </li>
          </ul>
          <audio id="jexumaudio"></audio>
        </div>
      </div>
    `;
  }

  function mountRoots() {
    removeExistingRoots();
    const topHost = getTopHost();

    const topbarRoot = document.createElement("div");
    topbarRoot.id = "homepage-topbar-root";
    topHost.prepend(topbarRoot);

    const radioRoot = document.createElement("div");
    radioRoot.id = "homepage-radio-root";
    radioRoot.innerHTML = createRadioMarkup();
    topbarRoot.appendChild(radioRoot);

    const ipRoot = document.createElement("div");
    ipRoot.id = "homepage-ip-root";
    const ipButton = createIpButton();
    ipRoot.appendChild(ipButton);
    topbarRoot.prepend(ipRoot);

    return {
      topbarRoot,
      radioRoot,
      ipRoot,
      ipButton,
    };
  }

  function initializeWidget() {
    const { topbarRoot, radioRoot, ipRoot, ipButton } = mountRoots();

    if (!topbarRoot || !radioRoot || !ipRoot || !ipButton) {
      return;
    }

    const audio = radioRoot.querySelector("#jexumaudio");
    const playPauseButton = radioRoot.querySelector("#plapau");
    const playlistIcon = radioRoot.querySelector("#pl");
    const playPauseIcon = radioRoot.querySelector("#imgplay");
    const volumeDownButton = radioRoot.querySelector("#volumedown");
    const volumeUpButton = radioRoot.querySelector("#volumeup");
    const volumeButton = radioRoot.querySelector("#volumeset");
    const ipContainer = ipButton;

    if (
      !audio ||
      !playPauseButton ||
      !playlistIcon ||
      !playPauseIcon ||
      !volumeDownButton ||
      !volumeUpButton ||
      !volumeButton
    ) {
      removeExistingRoots();
      window.__homepageRadioWidgetInitialized = false;
      window.__homepageRadioWidgetCleanup = null;
      return;
    }

    const stationButtons = new Map(
      stations.map((station) => [station.key, radioRoot.querySelector(`#${station.key}`)]),
    );

    const state = {
      activeStation: null,
      pendingStationKey: null,
      muted: false,
    };
    let currentIpAddress = "";
    let placementFrameId = 0;
    let delayedPlacementTimeoutId = 0;
    let startRequestId = 0;
    let ipCopyFeedbackTimeoutId = 0;
    let isDisposed = false;
    const cleanupFns = [];

    function runCleanup() {
      if (isDisposed) {
        return;
      }

      isDisposed = true;
      startRequestId += 1;

      if (placementFrameId) {
        window.cancelAnimationFrame(placementFrameId);
        placementFrameId = 0;
      }

      if (delayedPlacementTimeoutId) {
        window.clearTimeout(delayedPlacementTimeoutId);
        delayedPlacementTimeoutId = 0;
      }

      if (ipCopyFeedbackTimeoutId) {
        window.clearTimeout(ipCopyFeedbackTimeoutId);
        ipCopyFeedbackTimeoutId = 0;
      }

      cleanupFns.splice(0).reverse().forEach((cleanup) => {
        try {
          cleanup();
        } catch {
          // Ignore cleanup failures to avoid blocking remount.
        }
      });

      removeExistingRoots();
      window.__homepageRadioWidgetCleanup = null;
      window.__homepageRadioWidgetInitialized = false;
    }

    window.__homepageRadioWidgetCleanup = runCleanup;

    function addManagedListener(target, type, handler, options) {
      if (!target) {
        return;
      }

      target.addEventListener(type, handler, options);
      cleanupFns.push(() => {
        target.removeEventListener(type, handler, options);
      });
    }

    function scheduleEnsureTopRootsPlacement() {
      if (isDisposed || placementFrameId) {
        return;
      }

      placementFrameId = window.requestAnimationFrame(() => {
        placementFrameId = 0;
        ensureTopRootsPlacement();
      });
    }

    function ensureTopRootsPlacement() {
      if (isDisposed) {
        return;
      }

      const topHost = getTopHost();
      if (!topHost || !topbarRoot || !ipRoot || !radioRoot) {
        return;
      }

      const fpsRoot = document.getElementById("homepage-fps-root");

      if (topbarRoot.parentElement !== topHost || topHost.firstElementChild !== topbarRoot) {
        topHost.prepend(topbarRoot);
      }

      if (fpsRoot?.parentElement === topbarRoot) {
        if (ipRoot.parentElement !== topbarRoot || fpsRoot.nextElementSibling !== ipRoot) {
          topbarRoot.insertBefore(ipRoot, fpsRoot.nextElementSibling);
        }
      } else if (ipRoot.parentElement !== topbarRoot || topbarRoot.firstElementChild !== ipRoot) {
        topbarRoot.prepend(ipRoot);
      }

      if (radioRoot.parentElement !== topbarRoot || radioRoot.previousElementSibling !== ipRoot) {
        topbarRoot.appendChild(radioRoot);
      }
    }

    audio.volume = 1;

    function updateVolumeLabel() {
      volumeButton.textContent = state.muted ? "0" : formatVolume(audio.volume);
    }

    function updatePlaybackIcons(isPlaying) {
      playPauseIcon.src = isPlaying ? "/images/radio/pause.png" : "/images/radio/play.png";
      playlistIcon.src = isPlaying ? "/images/radio/play.gif" : "/images/radio/pl.png";
    }

    function updateActiveStationClasses() {
      stationButtons.forEach((button, key) => {
        button?.classList.toggle("jenium", state.activeStation === key);
      });
    }

    function pausePlayback() {
      startRequestId += 1;
      state.pendingStationKey = null;
      audio.pause();
      updatePlaybackIcons(false);
    }

    function resetPlaybackState({ clearSource = true } = {}) {
      state.activeStation = null;
      state.pendingStationKey = null;

      if (!audio.paused) {
        audio.pause();
      }

      if (clearSource) {
        audio.removeAttribute("src");
        audio.load();
      }

      updateActiveStationClasses();
      updatePlaybackIcons(false);
    }

    function stopPlayback() {
      startRequestId += 1;
      resetPlaybackState({ clearSource: true });
    }

    function handlePlaybackFailure() {
      startRequestId += 1;
      resetPlaybackState({ clearSource: true });
    }

    async function resumePlayback() {
      const requestId = ++startRequestId;
      state.pendingStationKey = null;

      try {
        await audio.play();

        if (isDisposed || requestId !== startRequestId) {
          return false;
        }

        updatePlaybackIcons(true);
        return true;
      } catch {
        if (isDisposed || requestId !== startRequestId) {
          return false;
        }

        handlePlaybackFailure();
        return false;
      }
    }

    async function startStation(station) {
      if (!station || isDisposed) {
        return false;
      }

      const requestId = ++startRequestId;
      state.pendingStationKey = station.key;
      state.activeStation = null;
      updateActiveStationClasses();
      updatePlaybackIcons(false);

      if (audio.getAttribute("src") !== station.url) {
        audio.src = station.url;
      }

      try {
        await audio.play();

        if (isDisposed || requestId !== startRequestId) {
          return false;
        }

        state.pendingStationKey = null;
        state.activeStation = station.key;
        updateActiveStationClasses();
        updatePlaybackIcons(true);
        return true;
      } catch {
        if (isDisposed || requestId !== startRequestId) {
          return false;
        }

        handlePlaybackFailure();
        return false;
      }
    }

    function renderIpInfo(payload) {
      const fragment = document.createDocumentFragment();

      if (payload.flagImg) {
        const flag = document.createElement("img");
        flag.className = "ipimg";
        flag.src = payload.flagImg;
        flag.alt = "";
        fragment.appendChild(flag);
      }

      if (payload.ip) {
        const address = document.createElement("span");
        address.className = "ipcheck-address";
        address.textContent = payload.ip;
        fragment.appendChild(address);
      }

      if (payload.isp) {
        const provider = document.createElement("span");
        provider.className = "ipcheck-provider";
        provider.textContent = payload.isp;
        fragment.appendChild(provider);
      }

      ipContainer.replaceChildren(fragment);
    }

    function handleAudioError() {
      if (!state.pendingStationKey && !state.activeStation) {
        return;
      }

      handlePlaybackFailure();
    }

    function handleAudioPlay() {
      if (!state.activeStation || state.pendingStationKey) {
        return;
      }

      updatePlaybackIcons(true);
    }

    function handleAudioPause() {
      if (state.pendingStationKey) {
        return;
      }

      updatePlaybackIcons(false);
    }

    function handleAudioEnded() {
      if (!state.activeStation) {
        return;
      }

      handlePlaybackFailure();
    }

    stations.forEach((station) => {
      const stationButton = stationButtons.get(station.key);

      addManagedListener(stationButton, "click", async () => {
        if (state.pendingStationKey === station.key) {
          return;
        }

        if (state.activeStation === station.key) {
          if (audio.paused || audio.ended) {
            await resumePlayback();
            return;
          }

          stopPlayback();
          return;
        }

        await startStation(station);
      });
    });

    addManagedListener(playPauseButton, "click", async () => {
      if (state.pendingStationKey) {
        return;
      }

      if (!state.activeStation) {
        if (!defaultStation) {
          return;
        }

        await startStation(defaultStation);
        return;
      }

      if (audio.paused || audio.ended) {
        await resumePlayback();
        return;
      }

      pausePlayback();
    });

    addManagedListener(volumeDownButton, "click", () => {
      audio.volume = clampVolume(audio.volume - 0.1);
      if (audio.volume > 0 && state.muted) {
        audio.muted = false;
        state.muted = false;
      }
      updateVolumeLabel();
    });

    addManagedListener(volumeUpButton, "click", () => {
      audio.volume = clampVolume(audio.volume + 0.1);
      if (state.muted && audio.volume > 0) {
        audio.muted = false;
        state.muted = false;
      }
      updateVolumeLabel();
    });

    addManagedListener(volumeButton, "click", () => {
      state.muted = !state.muted;
      audio.muted = state.muted;
      updateVolumeLabel();
    });

    addManagedListener(audio, "play", handleAudioPlay);
    addManagedListener(audio, "pause", handleAudioPause);
    addManagedListener(audio, "ended", handleAudioEnded);
    addManagedListener(audio, "error", handleAudioError);
    addManagedListener(audio, "volumechange", updateVolumeLabel);

    updateVolumeLabel();
    updatePlaybackIcons(false);
    updateActiveStationClasses();
    ensureTopRootsPlacement();
    scheduleEnsureTopRootsPlacement();
    delayedPlacementTimeoutId = window.setTimeout(() => {
      scheduleEnsureTopRootsPlacement();
      delayedPlacementTimeoutId = 0;
    }, 300);

    addManagedListener(window, "load", scheduleEnsureTopRootsPlacement);

    const ipHostObserverTarget =
      document.getElementById("information-widgets") ||
      document.getElementById("page_wrapper") ||
      document.body;

    if (ipHostObserverTarget) {
      const observer = new MutationObserver(() => {
        scheduleEnsureTopRootsPlacement();
      });

      observer.observe(ipHostObserverTarget, { childList: true, subtree: true });
      cleanupFns.push(() => {
        observer.disconnect();
      });
    }

    addManagedListener(ipContainer, "click", async () => {
      if (!currentIpAddress) {
        return;
      }

      const copied = await copyTextToClipboard(currentIpAddress);
      if (copied) {
        ipContainer.classList.add("ipcheck-copied");

        if (ipCopyFeedbackTimeoutId) {
          window.clearTimeout(ipCopyFeedbackTimeoutId);
        }

        ipCopyFeedbackTimeoutId = window.setTimeout(() => {
          ipContainer.classList.remove("ipcheck-copied");
          ipCopyFeedbackTimeoutId = 0;
        }, 900);
      }
    });

    ipRoot.hidden = true;
    ipContainer.replaceChildren();
    currentIpAddress = "";

    requestIpInfo()
      .then((payload) => {
        if (isDisposed) {
          return;
        }

        currentIpAddress = payload.ip || "";
        renderIpInfo(payload);
        ipRoot.hidden = false;
      })
      .catch(() => {
        if (isDisposed) {
          return;
        }

        ipContainer.replaceChildren();
        currentIpAddress = "";
        ipRoot.hidden = true;
      });
  }

  ready(initializeWidget);
})();
/* <<< HOMEPAGE-EDITOR RADIO JS END <<< */
