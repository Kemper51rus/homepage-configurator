(function homepageRadioWidget() {
  if (window.__homepageRadioWidgetInitialized) {
    return;
  }

  window.__homepageRadioWidgetInitialized = true;

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
                <li>
                  ${stations
                    .map(
                      (station) =>
                        `<button id="${station.key}" class="jexum jeniumMradio" type="button">${station.label}</button>`,
                    )
                    .join("")}
                </li>
              </ul>
            </li>
            <button id="plapau" class="jexum radiopx" type="button">
              <img id="imgplay" class="imgmpx" src="/images/radio/pause.png" alt="">
            </button>
            <button id="volumedown" class="jexum radiopx" type="button">
              <img id="dvolume" class="imgmpx" src="/images/radio/volume-down.png" alt="">
            </button>
            <button id="volumeset" class="jexum radiopx" type="button">10</button>
            <button id="volumeup" class="jexum radiopx" type="button">
              <img id="uvolume" class="imgmpx" src="/images/radio/volume-up.png" alt="">
            </button>
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
    ipRoot.innerHTML = '<div id="ip" class="ipcheck"></div>';
    topbarRoot.prepend(ipRoot);

    return {
      topbarRoot,
      radioRoot,
      ipRoot,
    };
  }

  function initializeWidget() {
    const { topbarRoot, radioRoot, ipRoot } = mountRoots();

    const audio = radioRoot.querySelector("#jexumaudio");
    const playPauseButton = radioRoot.querySelector("#plapau");
    const playlistIcon = radioRoot.querySelector("#pl");
    const playPauseIcon = radioRoot.querySelector("#imgplay");
    const volumeDownButton = radioRoot.querySelector("#volumedown");
    const volumeUpButton = radioRoot.querySelector("#volumeup");
    const volumeButton = radioRoot.querySelector("#volumeset");
    const ipContainer = document.getElementById("ip");

    const stationButtons = new Map(
      stations.map((station) => [station.key, radioRoot.querySelector(`#${station.key}`)]),
    );

    const state = {
      activeStation: null,
      muted: false,
    };

    function isRadioPlaybackActive() {
      return Boolean(state.activeStation) && !audio.paused && !audio.ended;
    }

    function ensureTopRootsPlacement() {
      const topHost = getTopHost();
      if (!topHost || !topbarRoot || !ipRoot || !radioRoot) {
        return;
      }

      if (topbarRoot.parentElement !== topHost || topHost.firstElementChild !== topbarRoot) {
        topHost.prepend(topbarRoot);
      }

      if (ipRoot.parentElement !== topbarRoot || topbarRoot.firstElementChild !== ipRoot) {
        topbarRoot.prepend(ipRoot);
      }

      if (radioRoot.parentElement !== topbarRoot || radioRoot.previousElementSibling !== ipRoot) {
        topbarRoot.appendChild(radioRoot);
      }
    }

    function handleLinkClickWhilePlaying(event) {
      if (!isRadioPlaybackActive()) {
        return;
      }

      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        return;
      }

      event.preventDefault();
      window.open(anchor.href, "_blank", "noopener,noreferrer");
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

    function stopPlayback() {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      state.activeStation = null;
      updateActiveStationClasses();
      updatePlaybackIcons(false);
    }

    async function startStation(station) {
      state.activeStation = station.key;
      updateActiveStationClasses();
      audio.src = station.url;

      try {
        await audio.play();
      } catch {
        updatePlaybackIcons(false);
      }
    }

    stations.forEach((station) => {
      stationButtons.get(station.key)?.addEventListener("click", async () => {
        if (state.activeStation === station.key) {
          stopPlayback();
          return;
        }

        await startStation(station);
      });
    });

    playPauseButton.addEventListener("click", async () => {
      if (!state.activeStation) {
        if (!defaultStation) {
          return;
        }

        await startStation(defaultStation);
        return;
      }

      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          updatePlaybackIcons(false);
        }
        return;
      }

      audio.pause();
    });

    volumeDownButton.addEventListener("click", () => {
      audio.volume = clampVolume(audio.volume - 0.1);
      if (audio.volume > 0 && state.muted) {
        audio.muted = false;
        state.muted = false;
      }
      updateVolumeLabel();
    });

    volumeUpButton.addEventListener("click", () => {
      audio.volume = clampVolume(audio.volume + 0.1);
      if (state.muted && audio.volume > 0) {
        audio.muted = false;
        state.muted = false;
      }
      updateVolumeLabel();
    });

    volumeButton.addEventListener("click", () => {
      state.muted = !state.muted;
      audio.muted = state.muted;
      updateVolumeLabel();
    });

    audio.addEventListener("play", () => updatePlaybackIcons(true));
    audio.addEventListener("pause", () => updatePlaybackIcons(false));
    audio.addEventListener("volumechange", updateVolumeLabel);

    updateVolumeLabel();
    updatePlaybackIcons(false);
    updateActiveStationClasses();
    ensureTopRootsPlacement();
    window.requestAnimationFrame(() => {
      ensureTopRootsPlacement();
    });
    window.setTimeout(() => {
      ensureTopRootsPlacement();
    }, 300);

    window.addEventListener("load", () => {
      ensureTopRootsPlacement();
    }, { once: true });

    const ipHostObserverTarget =
      document.getElementById("information-widgets") ||
      document.getElementById("page_wrapper") ||
      document.body;

    if (ipHostObserverTarget) {
      const observer = new MutationObserver(() => {
        window.requestAnimationFrame(ensureTopRootsPlacement);
      });

      observer.observe(ipHostObserverTarget, { childList: true, subtree: true });
    }

    document.addEventListener("click", handleLinkClickWhilePlaying, true);

    if (!ipContainer) {
      return;
    }

    ipRoot.hidden = true;
    ipContainer.textContent = "";

    requestIpInfo()
      .then((payload) => {
        const flagMarkup = payload.flagImg ? `<img class="ipimg" src="${payload.flagImg}" alt="">` : "";
        const providerText = payload.isp ? ` ${payload.isp}` : "";
        ipContainer.innerHTML = `${flagMarkup}${payload.ip}${providerText}`;
        ipRoot.hidden = false;
      })
      .catch(() => {
        ipContainer.textContent = "";
        ipRoot.hidden = true;
      });
  }

  ready(initializeWidget);
})();
