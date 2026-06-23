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

  const ipProviderList = `
    ipwho.is, https://ipwho.is/, ip
    ipapi.co, https://ipapi.co/json/, ip
    api.ip.sb, https://api.ip.sb/ip
    api.ipify.org, https://api.ipify.org?format=json, ip
  `;
  const ipHideOnError = true;
  const radioButtonsStyle = "classic";
  const radioIconSize = 10;
  const radioButtonSize = 18;
  const linkIpFpsSizes = false;
  const radioEnabled = true;
  const ipEnabled = true;

  function parseIpProviders(definition) {
    return definition
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const separatorIndex = line.indexOf(",");
        if (separatorIndex === -1) return null;
        const label = line.slice(0, separatorIndex).trim();
        const rest = line.slice(separatorIndex + 1).trim();
        
        const secondSep = rest.indexOf(",");
        let url = rest;
        let jsonKey = "";
        if (secondSep !== -1) {
          url = rest.slice(0, secondSep).trim();
          jsonKey = rest.slice(secondSep + 1).trim();
        }
        
        if (!label || !url) return null;
        return {
          key: `provider-${index}`,
          label,
          url,
          jsonKey,
        };
      })
      .filter(Boolean);
  }

  // Radio stations format:
  // Station name, stream URL
  // * Station name, stream URL  -> default station
  const stationList = `
    TNT, https://tntradio.hostingradio.ru:8027/tntradio128.mp3?6c8e
    DFM, https://dfm.hostingradio.ru/dfm96.aacp
    Power, https://radio.dline-media.com/powerhit128
    Energy, https://pub0302.101.ru:8443/stream/air/aac/64/99
    * Hakuran, https://hfm.hakuran.ru/listen/hfm/radio.mp3, true, https://hfm.hakuran.ru/api/nowplaying/1, now_playing.song.text
  `;

  // Order of radio buttons: trackinfo, like, dislike, playlist, plapau, volumedown, volumeset, volumeup
  const radioButtonsOrder = `
    trackinfo
    like
    dislike
    playlist
    plapau
    volumedown
    volumeset
    volumeup
  `;

  function parseRadioButtonsOrder(definition) {
    return definition
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

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
        const parts = normalizedLine.split(",").map(p => p.trim());
        if (parts.length < 2) return null;

        const label = parts[0];
        const url = parts[1];
        const showTrackInfo = parts[2] === "true";
        const trackInfoUrl = parts[3] || "";
        const trackInfoKey = parts[4] || "";

        return {
          key: createStationKey(label, index),
          isDefault,
          label,
          url,
          showTrackInfo,
          trackInfoUrl,
          trackInfoKey,
        };
      })
      .filter(Boolean);
  }

  const stations = parseStations(stationList);
  const defaultStation = stations.find((station) => station.isDefault) ?? stations[0] ?? null;
  const stationByKey = new Map(stations.map((station) => [station.key, station]));
  const PLAYER_SESSION_KEY = "homepage-radio-player-state";

  function ready(callback) {
    const run = () => setTimeout(callback, 200);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
      return;
    }

    run();
  }

  function clampVolume(value) {
    return Math.min(1, Math.max(0, value));
  }

  function formatVolume(volume) {
    return String(Math.round(volume * 10));
  }

  function loadPlayerState() {
    try {
      const stored = window.sessionStorage.getItem(PLAYER_SESSION_KEY);
      if (!stored) {
        return null;
      }

      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return {
        stationKey: stationByKey.has(parsed.stationKey) ? parsed.stationKey : defaultStation?.key ?? null,
        shouldPlay: parsed.shouldPlay === true,
        volume: Number.isFinite(parsed.volume) ? clampVolume(parsed.volume) : 1,
        muted: parsed.muted === true,
      };
    } catch {
      return null;
    }
  }

  function savePlayerState(payload) {
    try {
      window.sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures in private sessions.
    }
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
    const providers = parseIpProviders(ipProviderList);

    for (const provider of providers) {
      try {
        const url = provider.url;
        // Check for built-in overrides
        if (url.includes("ipwho.is")) {
          const response = await withTimeout(url);
          if (!response.ok) throw new Error("ipwho.is failed");
          const payload = await response.json();
          if (!payload?.success || !payload.ip) throw new Error("ipwho.is invalid payload");
          return {
            ip: payload.ip,
            isp: payload.connection?.isp || payload.connection?.org || "",
            flagImg: payload.flag?.img || flagUrlFromCountryCode(payload.country_code),
          };
        }

        if (url.includes("ipapi.co")) {
          const response = await withTimeout(url);
          if (!response.ok) throw new Error("ipapi.co failed");
          const payload = await response.json();
          if (!payload?.ip) throw new Error("ipapi.co invalid payload");
          return {
            ip: payload.ip,
            isp: payload.org || payload.org_name || payload.asn || "",
            flagImg: flagUrlFromCountryCode(payload.country_code),
          };
        }

        // Custom json or text provider
        const response = await withTimeout(url);
        if (!response.ok) throw new Error(`Provider ${provider.label} failed`);

        if (provider.jsonKey) {
          const payload = await response.json();
          const ip = provider.jsonKey.split('.').reduce((o, k) => (o || {})[k], payload);
          if (!ip || typeof ip !== "string") throw new Error("JSON key not found or not string");
          return { ip, isp: "", flagImg: "" };
        } else {
          const text = (await response.text()).trim();
          if (!/^[0-9a-fA-F.:]+$/.test(text)) throw new Error("Response is not a valid IP address");
          return { ip: text, isp: "", flagImg: "" };
        }
      } catch (err) {
        // Try the next provider
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
    const buttonsMap = {
      trackinfo: `<li id="track-info-container" class="track-info-container" style="display: none;">
              <div class="track-info-marquee" id="track-info-marquee">
                <span id="track-info-text"></span>
              </div>
            </li>`,
      like: `<li id="like-container">
              <button id="like" class="jexum radiopx" type="button" title="Нравится">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-like-dislike">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                </svg>
              </button>
            </li>`,
      dislike: `<li id="dislike-container">
              <button id="dislike" class="jexum radiopx" type="button" title="Не нравится">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-like-dislike" style="transform: scaleY(-1);">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                </svg>
              </button>
            </li>`,
      playlist: `<li id="lif">
              <button id="playlist" class="jexum swb" type="button" style="${radioButtonsStyle === "modern" ? "display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 0 8px;" : ""}">
                ${radioButtonsStyle === "modern" ? `
                <svg id="pl" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-radio-icon" style="margin: 0;">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
                <svg id="down4" xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-radio-icon" style="margin: 0; opacity: 0.7;">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                ` : `
                <img id="pl" class="imgmpx" src="/images/radio/pl.png" alt="">
                &ensp;
                <img id="down4" class="px" src="/images/radio/down.png" alt="">
                `}
              </button>
              <ul class="jexumsub">
                ${stations
                  .map(
                    (station) =>
                      `<li><button id="${station.key}" class="jexum jeniumMradio" type="button">${station.label}</button></li>`,
                  )
                  .join("")}
              </ul>
            </li>`,
      plapau: `<li>
              <button id="plapau" class="jexum radiopx" type="button">
                ${radioButtonsStyle === "modern" ? `
                <svg id="imgplay" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-radio-icon">
                  <path id="imgplay-path" d="M5 3l14 9-14 9V3z"/>
                </svg>
                ` : `
                <img id="imgplay" class="imgmpx" src="/images/radio/play.png" alt="">
                `}
              </button>
            </li>`,
      volumedown: `<li>
              <button id="volumedown" class="jexum radiopx" type="button">
                ${radioButtonsStyle === "modern" ? `
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-radio-icon">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                </svg>
                ` : `
                <img id="dvolume" class="imgmpx" src="/images/radio/volume-down.png" alt="">
                `}
              </button>
            </li>`,
      volumeset: `<li>
              <button id="volumeset" class="jexum radiopx" type="button">10</button>
            </li>`,
      volumeup: `<li>
              <button id="volumeup" class="jexum radiopx" type="button">
                ${radioButtonsStyle === "modern" ? `
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-radio-icon">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
                ` : `
                <img id="uvolume" class="imgmpx" src="/images/radio/volume-up.png" alt="">
                `}
              </button>
            </li>`
    };

    const order = parseRadioButtonsOrder(radioButtonsOrder);
    const buttonsMarkup = order.map((key) => buttonsMap[key] || "").join("");

    return `
      <div class="hpradio">
        <div class="jexumnav">
          <ul class="jexummenu">
            ${buttonsMarkup}
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

    let radioRoot = null;
    if (radioEnabled) {
      radioRoot = document.createElement("div");
      radioRoot.id = "homepage-radio-root";
      radioRoot.innerHTML = createRadioMarkup();
      topbarRoot.appendChild(radioRoot);
    }

    let ipRoot = null;
    let ipButton = null;
    if (ipEnabled) {
      ipRoot = document.createElement("div");
      ipRoot.id = "homepage-ip-root";
      ipButton = createIpButton();
      ipRoot.appendChild(ipButton);
      topbarRoot.prepend(ipRoot);
    }

    return {
      topbarRoot,
      radioRoot,
      ipRoot,
      ipButton,
    };
  }

  function initializeWidget() {
    let currentIpAddress = "";
    let placementFrameId = 0;
    let delayedPlacementTimeoutId = 0;
    let restorePlaybackTimeoutId = 0;
    let startRequestId = 0;
    let ipCopyFeedbackTimeoutId = 0;
    let isPageLeaving = false;
    let shouldRestoreAfterPageLeave = false;
    let isDisposed = false;
    const cleanupFns = [];

    const { topbarRoot, radioRoot, ipRoot, ipButton } = mountRoots();

    if (!topbarRoot) {
      return;
    }

    topbarRoot.style.setProperty('--radio-icon-size', `${radioIconSize}px`);
    topbarRoot.style.setProperty('--radio-button-size', `${radioButtonSize}px`);

    if (linkIpFpsSizes) {
      topbarRoot.classList.add("hplink-sizes");
    }

    const audio = radioRoot ? radioRoot.querySelector("#jexumaudio") : null;
    const playPauseButton = radioRoot ? radioRoot.querySelector("#plapau") : null;
    const playlistIcon = radioRoot ? radioRoot.querySelector("#pl") : null;
    const playPauseIcon = radioRoot ? radioRoot.querySelector("#imgplay") : null;
    const volumeDownButton = radioRoot ? radioRoot.querySelector("#volumedown") : null;
    const volumeUpButton = radioRoot ? radioRoot.querySelector("#volumeup") : null;
    const volumeButton = radioRoot ? radioRoot.querySelector("#volumeset") : null;
    const likeButton = radioRoot ? radioRoot.querySelector("#like") : null;
    const dislikeButton = radioRoot ? radioRoot.querySelector("#dislike") : null;
    const ipContainer = ipButton;

    const isRadioInitialized = radioEnabled && radioRoot && audio && playPauseButton && playlistIcon && playPauseIcon && volumeDownButton && volumeUpButton && volumeButton && likeButton && dislikeButton;
    const isIpInitialized = ipEnabled && ipRoot && ipButton;

    if (!isRadioInitialized && !isIpInitialized) {
      removeExistingRoots();
      window.__homepageRadioWidgetInitialized = false;
      window.__homepageRadioWidgetCleanup = null;
      return;
    }

    let currentSongId = "";
    let nowPlayingIntervalId = 0;
    let trackInfoIntervalId = 0;
    let lastTrackText = "";

    function getJsonValue(obj, keyPath) {
      if (!keyPath) return obj;
      return keyPath.split('.').reduce((acc, part) => {
        return acc && acc[part] !== undefined ? acc[part] : undefined;
      }, obj);
    }

    function updateMarqueeText(text) {
      const marqueeEl = radioRoot.querySelector("#track-info-marquee");
      if (!marqueeEl) return;

      marqueeEl.innerHTML = "";
      
      const span = document.createElement("span");
      span.textContent = text;
      span.style.display = "inline-block";
      span.style.whiteSpace = "nowrap";
      span.style.paddingRight = "40px";
      marqueeEl.appendChild(span);

      let attempts = 0;
      function measure() {
        if (isDisposed) return;
        const containerWidth = marqueeEl.clientWidth || marqueeEl.offsetWidth || 0;
        const textWidth = span.offsetWidth;

        if (containerWidth === 0 || textWidth === 0) {
          if (attempts < 20) {
            attempts++;
            setTimeout(measure, 250);
          }
          return;
        }

        if (textWidth > containerWidth + 10) {
          marqueeEl.querySelectorAll("span:not(:first-child)").forEach(el => el.remove());
          
          const clone = span.cloneNode(true);
          marqueeEl.appendChild(clone);

          const duration = textWidth / 25;
          span.style.animation = `marquee-scroll ${duration}s linear infinite`;
          clone.style.animation = `marquee-scroll ${duration}s linear infinite`;
          marqueeEl.style.justifyContent = "flex-start";
        } else {
          marqueeEl.style.justifyContent = "center";
          span.style.paddingRight = "0";
          span.style.animation = "none";
        }
      }

      setTimeout(measure, 150);
    }

    function startTrackInfoPolling(station) {
      if (trackInfoIntervalId) {
        window.clearInterval(trackInfoIntervalId);
      }

      async function poll() {
        const url = station.trackInfoUrl || "https://hfm.hakuran.ru/api/nowplaying/1";
        const key = station.trackInfoKey || "now_playing.song.text";

        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("Fetch failed");
          
          let trackText = "";
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json") || url.endsWith(".json") || url.includes("api/nowplaying")) {
            const data = await res.json();
            if (url.includes("hfm.hakuran.ru")) {
              if (data?.now_playing?.song?.id) {
                currentSongId = data.now_playing.song.id;
              }
            }
            const val = getJsonValue(data, key);
            trackText = typeof val === "string" ? val : (val ? String(val) : "");
          } else {
            trackText = (await res.text()).trim();
          }

          if (trackText && trackText !== lastTrackText) {
            lastTrackText = trackText;
            updateMarqueeText(trackText);
          }
        } catch (err) {
          console.error("Failed to poll track info:", err);
        }
      }

      poll();
      trackInfoIntervalId = window.setInterval(poll, 15005);
    }

    function stopTrackInfoPolling() {
      if (trackInfoIntervalId) {
        window.clearInterval(trackInfoIntervalId);
        trackInfoIntervalId = 0;
      }
      lastTrackText = "";
      const textEl = radioRoot.querySelector("#track-info-text");
      if (textEl) {
        textEl.innerHTML = "";
      }
    }

    function updateTrackInfoVisibility() {
      const trackContainer = radioRoot.querySelector("#track-info-container");
      if (!trackContainer) return;

      const currentStation = state.activeStation ? stationByKey.get(state.activeStation) : null;
      const isPlaying = !audio.paused && !audio.ended && state.activeStation;
      const shouldShow = isPlaying && currentStation && currentStation.showTrackInfo;

      if (shouldShow) {
        trackContainer.style.display = "";
        startTrackInfoPolling(currentStation);
      } else {
        trackContainer.style.display = "none";
        stopTrackInfoPolling();
      }
    }

    function fetchNowPlaying() {
      fetch("https://hfm.hakuran.ru/api/nowplaying/1")
        .then(r => r.json())
        .then(data => {
          if (data?.now_playing?.song?.id) {
            currentSongId = data.now_playing.song.id;
          }
        })
        .catch(err => {
          console.error("Failed to fetch nowplaying info:", err);
        });
    }

    fetchNowPlaying();
    nowPlayingIntervalId = window.setInterval(fetchNowPlaying, 15000);

    addManagedListener(likeButton, "click", () => {
      if (!currentSongId) {
        console.warn("No song ID available for vote");
        return;
      }
      
      const originalColor = likeButton.style.color;
      likeButton.style.color = "#56fd3c";
      
      const url = `https://hakuran.ru/custom-api/vote?api_key=t3MohWJWoicuOFvYUr2HpfCHlwg5u1dqtHTQji9VOEbtXxy1K1eEmZ&song_id=${encodeURIComponent(currentSongId)}&type=up`;
      fetch(url)
        .then(r => {
          if (r.ok) {
            console.log("Liked song", currentSongId);
          } else {
            console.error("Like API failed with status", r.status);
            likeButton.style.color = originalColor;
          }
        })
        .catch(err => {
          console.error("Like API request failed:", err);
          likeButton.style.color = originalColor;
        });
        
      setTimeout(() => {
        likeButton.style.color = originalColor;
      }, 1500);
    });

    addManagedListener(dislikeButton, "click", () => {
      if (!currentSongId) {
        console.warn("No song ID available for vote");
        return;
      }
      
      const originalColor = dislikeButton.style.color;
      dislikeButton.style.color = "#ff4a4a";
      
      const url = `https://hakuran.ru/custom-api/vote?api_key=t3MohWJWoicuOFvYUr2HpfCHlwg5u1dqtHTQji9VOEbtXxy1K1eEmZ&song_id=${encodeURIComponent(currentSongId)}&type=down`;
      fetch(url)
        .then(r => {
          if (r.ok) {
            console.log("Disliked song", currentSongId);
          } else {
            console.error("Dislike API failed with status", r.status);
            dislikeButton.style.color = originalColor;
          }
        })
        .catch(err => {
          console.error("Dislike API request failed:", err);
          dislikeButton.style.color = originalColor;
        });
        
      setTimeout(() => {
        dislikeButton.style.color = originalColor;
      }, 1500);
    });

    const stationButtons = new Map(
      stations.map((station) => [station.key, radioRoot.querySelector(`#${station.key}`)]),
    );
    const savedPlayerState = loadPlayerState();
    const savedStation = savedPlayerState?.stationKey ? stationByKey.get(savedPlayerState.stationKey) : null;

    const state = {
      activeStation: savedStation?.key ?? null,
      pendingStationKey: null,
      lastStationKey: savedStation?.key ?? defaultStation?.key ?? null,
      restoringStationKey: null,
      muted: savedPlayerState?.muted === true,
    };

    function runCleanup() {
      if (isDisposed) {
        return;
      }

      isDisposed = true;
      if (nowPlayingIntervalId) {
        window.clearInterval(nowPlayingIntervalId);
        nowPlayingIntervalId = 0;
      }
      if (trackInfoIntervalId) {
        window.clearInterval(trackInfoIntervalId);
        trackInfoIntervalId = 0;
      }
      startRequestId += 1;

      if (placementFrameId) {
        window.cancelAnimationFrame(placementFrameId);
        placementFrameId = 0;
      }

      if (delayedPlacementTimeoutId) {
        window.clearTimeout(delayedPlacementTimeoutId);
        delayedPlacementTimeoutId = 0;
      }

      if (restorePlaybackTimeoutId) {
        window.clearTimeout(restorePlaybackTimeoutId);
        restorePlaybackTimeoutId = 0;
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
      if (!topHost || !topbarRoot) {
        return;
      }

      const fpsRoot = document.getElementById("homepage-fps-root");

      if (topbarRoot.parentElement !== topHost || topHost.firstElementChild !== topbarRoot) {
        topHost.prepend(topbarRoot);
      }

      if (isIpInitialized) {
        if (fpsRoot?.parentElement === topbarRoot) {
          if (ipRoot.parentElement !== topbarRoot || fpsRoot.nextElementSibling !== ipRoot) {
            topbarRoot.insertBefore(ipRoot, fpsRoot.nextElementSibling);
          }
        } else if (ipRoot.parentElement !== topbarRoot || topbarRoot.firstElementChild !== ipRoot) {
          topbarRoot.prepend(ipRoot);
        }
      }

      if (isRadioInitialized) {
        if (isIpInitialized) {
          if (radioRoot.parentElement !== topbarRoot || radioRoot.previousElementSibling !== ipRoot) {
            topbarRoot.appendChild(radioRoot);
          }
        } else {
          if (radioRoot.parentElement !== topbarRoot || topbarRoot.firstElementChild !== radioRoot) {
            topbarRoot.prepend(radioRoot);
          }
        }
      }
    }

    if (isRadioInitialized) {
      audio.volume = savedPlayerState?.volume ?? 1;
      audio.muted = state.muted;
      if (savedStation) {
        audio.src = savedStation.url;
      }
    }

    function updateVolumeLabel() {
      if (!isRadioInitialized) return;
      volumeButton.textContent = state.muted ? "0" : formatVolume(audio.volume);
    }

    function updatePlaybackIcons(isPlaying) {
      if (!isRadioInitialized) return;
      if (radioButtonsStyle === "modern") {
        const pathEl = radioRoot.querySelector("#imgplay-path");
        if (pathEl) {
          pathEl.setAttribute("d", isPlaying ? "M6 4h4v16H6zm8 0h4v16h-4z" : "M5 3l14 9-14 9V3z");
        }
        if (playlistIcon) {
          playlistIcon.style.color = isPlaying ? "#56fd3c" : "";
        }
      } else {
        if (playPauseIcon) playPauseIcon.src = isPlaying ? "/images/radio/pause.png" : "/images/radio/play.png";
        if (playlistIcon) playlistIcon.src = isPlaying ? "/images/radio/play.gif" : "/images/radio/pl.png";
      }
      updateTrackInfoVisibility();
    }

    function updateLikesVisibility() {
      if (!isRadioInitialized) return;
      const hakuranStation = stations.find((s) => s.label.toLowerCase() === "hakuran");
      const hakuranKey = hakuranStation ? hakuranStation.key : null;
      
      const currentStationKey = state.activeStation || state.lastStationKey;
      const shouldShow = (currentStationKey === hakuranKey);
      
      const likeLi = radioRoot.querySelector("#like-container");
      const dislikeLi = radioRoot.querySelector("#dislike-container");
      
      if (likeLi) {
        likeLi.style.display = shouldShow ? "" : "none";
      }
      if (dislikeLi) {
        dislikeLi.style.display = shouldShow ? "" : "none";
      }
    }

    function updateActiveStationClasses() {
      if (!isRadioInitialized) return;
      stationButtons.forEach((button, key) => {
        button?.classList.toggle("jenium", state.activeStation === key);
      });
      updateLikesVisibility();
      updateTrackInfoVisibility();
    }

    function saveCurrentPlayerState(shouldPlayOverride = null) {
      if (!isRadioInitialized) return;
      const stationKey = state.activeStation || state.pendingStationKey || state.lastStationKey || defaultStation?.key || null;
      savePlayerState({
        stationKey,
        shouldPlay: typeof shouldPlayOverride === "boolean"
          ? shouldPlayOverride
          : Boolean(stationKey && !audio.paused && !audio.ended),
        volume: audio.volume,
        muted: state.muted || audio.muted,
      });
    }

    function rememberPlaybackBeforePageLeave() {
      if (!isRadioInitialized) return;
      const stationKey = state.activeStation || state.pendingStationKey || state.lastStationKey;
      shouldRestoreAfterPageLeave = Boolean(stationKey && !audio.paused && !audio.ended);
      isPageLeaving = true;
      saveCurrentPlayerState(shouldRestoreAfterPageLeave);
    }

    function pausePlayback({ persist = true } = {}) {
      if (!isRadioInitialized) return;
      startRequestId += 1;
      state.pendingStationKey = null;
      audio.pause();
      updatePlaybackIcons(false);
      if (persist) {
        saveCurrentPlayerState(false);
      }
    }

    function resetPlaybackState({ clearSource = true } = {}) {
      if (!isRadioInitialized) return;
      state.activeStation = null;
      state.pendingStationKey = null;
      state.restoringStationKey = null;

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
      if (!isRadioInitialized) return;
      startRequestId += 1;
      resetPlaybackState({ clearSource: true });
      saveCurrentPlayerState(false);
    }

    function handlePlaybackFailure({ persist = true } = {}) {
      if (!isRadioInitialized) return;
      startRequestId += 1;
      resetPlaybackState({ clearSource: true });
      if (persist) {
        saveCurrentPlayerState(false);
      }
    }

    async function resumePlayback({ persistOnFailure = true } = {}) {
      if (!isRadioInitialized) return false;
      const requestId = ++startRequestId;
      state.pendingStationKey = null;

      try {
        await audio.play();

        if (isDisposed || requestId !== startRequestId) {
          return false;
        }

        updatePlaybackIcons(true);
        saveCurrentPlayerState(true);
        return true;
      } catch {
        if (isDisposed || requestId !== startRequestId) {
          return false;
        }

        if (persistOnFailure) {
          handlePlaybackFailure({ persist: true });
        } else {
          updatePlaybackIcons(false);
          saveCurrentPlayerState(true);
        }
        return false;
      }
    }

    async function startStation(station, { persistOnFailure = true } = {}) {
      if (!isRadioInitialized || !station || isDisposed) {
        return false;
      }

      const requestId = ++startRequestId;
      state.lastStationKey = station.key;
      state.restoringStationKey = persistOnFailure ? null : station.key;
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
        state.restoringStationKey = null;
        updateActiveStationClasses();
        updatePlaybackIcons(true);
        saveCurrentPlayerState(true);
        return true;
      } catch {
        if (isDisposed || requestId !== startRequestId) {
          return false;
        }

        if (persistOnFailure) {
          handlePlaybackFailure({ persist: true });
        } else {
          state.pendingStationKey = null;
          state.activeStation = station.key;
          state.restoringStationKey = null;
          updateActiveStationClasses();
          updatePlaybackIcons(false);
          saveCurrentPlayerState(true);
        }
        return false;
      }
    }

    function renderIpInfo(payload) {
      if (!isIpInitialized) return;
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
      if (!isRadioInitialized) return;
      if (!state.pendingStationKey && !state.activeStation) {
        return;
      }

      if (state.restoringStationKey) {
        const station = stationByKey.get(state.restoringStationKey);
        if (station) {
          state.pendingStationKey = null;
          state.activeStation = station.key;
          state.lastStationKey = station.key;
          state.restoringStationKey = null;
          if (audio.getAttribute("src") !== station.url) {
            audio.src = station.url;
          }
          updateActiveStationClasses();
          updatePlaybackIcons(false);
          saveCurrentPlayerState(true);
          return;
        }
      }

      handlePlaybackFailure();
    }

    function handleAudioPlay() {
      if (!isRadioInitialized) return;
      if (!state.activeStation || state.pendingStationKey) {
        return;
      }

      updatePlaybackIcons(true);
      saveCurrentPlayerState(true);
      updateLikesVisibility();
    }

    function handleAudioPause() {
      if (!isRadioInitialized) return;
      if (state.pendingStationKey) {
        return;
      }

      updatePlaybackIcons(false);
      if (isPageLeaving) {
        saveCurrentPlayerState(shouldRestoreAfterPageLeave);
        return;
      }

      saveCurrentPlayerState(false);
      updateLikesVisibility();
    }

    function handleAudioEnded() {
      if (!isRadioInitialized) return;
      if (!state.activeStation) {
        return;
      }

      handlePlaybackFailure();
    }

    function handlePlayableLinkClick(event) {
      if (!isRadioInitialized) return;
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !state.activeStation ||
        audio.paused ||
        audio.ended
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest(".bookmark a[href], .service-card a[href]");
      if (!link) {
        return;
      }

      const href = link.getAttribute("href");
      if (!href || href === "#") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.open(link.href, "_blank", "noopener,noreferrer");
    }

    if (isRadioInitialized) {
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
        saveCurrentPlayerState();
      });

      addManagedListener(volumeUpButton, "click", () => {
        audio.volume = clampVolume(audio.volume + 0.1);
        if (state.muted && audio.volume > 0) {
          audio.muted = false;
          state.muted = false;
        }
        updateVolumeLabel();
        saveCurrentPlayerState();
      });

      addManagedListener(volumeButton, "click", () => {
        state.muted = !state.muted;
        audio.muted = state.muted;
        updateVolumeLabel();
        saveCurrentPlayerState();
      });

      addManagedListener(audio, "play", handleAudioPlay);
      addManagedListener(audio, "pause", handleAudioPause);
      addManagedListener(audio, "ended", handleAudioEnded);
      addManagedListener(audio, "error", handleAudioError);
      addManagedListener(audio, "volumechange", updateVolumeLabel);
      addManagedListener(document, "click", handlePlayableLinkClick, true);
      addManagedListener(window, "pagehide", rememberPlaybackBeforePageLeave);
      addManagedListener(window, "beforeunload", rememberPlaybackBeforePageLeave);

      updateVolumeLabel();
      updatePlaybackIcons(false);
      updateActiveStationClasses();
      if (savedStation && savedPlayerState?.shouldPlay) {
        restorePlaybackTimeoutId = window.setTimeout(() => {
          restorePlaybackTimeoutId = 0;
          if (!isDisposed) {
            startStation(savedStation, { persistOnFailure: false });
          }
        }, 0);
      }
    }

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

    if (isIpInitialized) {
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

      ipRoot.style.display = "none";
      ipContainer.replaceChildren();
      currentIpAddress = "";

      requestIpInfo()
        .then((payload) => {
          if (isDisposed) {
            return;
          }

          currentIpAddress = payload.ip || "";
          renderIpInfo(payload);
          ipRoot.style.display = "flex";
        })
        .catch(() => {
          if (isDisposed) {
            return;
          }

          ipContainer.replaceChildren();
          currentIpAddress = "";
          
          if (typeof ipHideOnError === "boolean" && !ipHideOnError) {
            const errorSpan = document.createElement("span");
            errorSpan.className = "ipcheck-address";
            errorSpan.textContent = "Неизвестно";
            errorSpan.style.color = "#ff4a4a";
            ipContainer.appendChild(errorSpan);
            ipRoot.style.display = "flex";
          } else {
            ipRoot.style.display = "none";
          }
        });
    }
  }

  ready(initializeWidget);
})();
/* <<< HOMEPAGE-EDITOR RADIO JS END <<< */
