(() => {
  const OVERLAY_ID = "dalnoboyshiki2-overlay";
  const HUD_ID = "dalnoboyshiki2-hud";
  const MUSIC_ID = "dalnoboyshiki2-music";
  const HUD_UPDATE_EVENT = "dalnoboyshiki2:hud-update";
  const LOCATION_CHECK_INTERVAL_MS = 500;
  const EARTH_RADIUS_METERS = 6_371_000;
  const MIN_TRACKED_STEP_METERS = 1;
  const MAX_TRACKED_STEP_METERS = 500;
  const MAX_TRACKED_SPEED_KMH = 180;
  const SPEED_IDLE_TIMEOUT_MS = 2_000;
  const SPEEDING_LIMIT_KMH = 100;
  const SPEEDING_REARM_KMH = 95;
  const SPEEDING_NOTICE_DURATION_MS = 5_000;
  const MUSIC_PLAYLIST_URL =
    "https://www.youtube.com/watch?v=x2vnaAdm-Rg&list=PL50DEA6B792AFF6BE";
  const MUSIC_EMBED_URL =
    "https://www.youtube.com/embed/x2vnaAdm-Rg?list=PL50DEA6B792AFF6BE&playsinline=1&loop=1";

  const STREET_VIEW_SCENE_SELECTORS = [
    ".widget-scene",
    ".widget-scene-canvas",
    "[data-testid='street-view-panorama']",
  ];
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const POSTAL_GLYPHS = {
    0: ["M4 1H10L13 4V20L10 23H4L1 20V4Z"],
    1: ["M2 6L7 1V23", "M2 23H12"],
    2: ["M1 4L4 1H10L13 4V9L1 20V23H13"],
    3: ["M1 1H10L13 4V9L9 12L13 15V20L10 23H1"],
    4: ["M11 23V1L1 14H13"],
    5: ["M13 1H1V11H10L13 14V20L10 23H1"],
    6: ["M12 2H5L1 6V19L5 23H10L13 20V14L10 11H1"],
    7: ["M1 1H13L5 23"],
    8: ["M4 1H10L13 4V9L10 12L13 15V20L10 23H4L1 20V15L4 12L1 9V4Z"],
    9: ["M13 13H4L1 10V4L4 1H10L13 4V18L8 23H2"],
    D: ["M1 1H8L13 6V18L8 23H1Z"],
    N: ["M1 23V1L13 23V1"],
    P: ["M1 23V1H9L13 5V10L9 14H1"],
    R: ["M1 23V1H9L13 5V10L9 14H1M8 14L13 23"],
  };

  let lastLocation = window.location.href;
  let syncTimer = null;

  const telemetryState = {
    startedAt: null,
    lastCoordinate: null,
    lastCoordinateAt: null,
    lastMovementAt: null,
    distanceMeters: 0,
    movementCount: 0,
  };

  const speedingNoticeState = {
    armed: true,
    visibleUntil: 0,
  };

  const hudState = {
    time: "00:00",
    speedKmh: 22,
    gear: "2",
    rpm: 2200,
    fuelPercent: 30,
    engineWarning: false,
    distanceMeters: 0,
    movementCount: 0,
  };

  function hasStreetViewUrlSignature(href) {
    try {
      const url = new URL(href);
      const usesDedicatedMapsHost = url.hostname === "maps.google.com";

      if (!usesDedicatedMapsHost && !url.pathname.startsWith("/maps")) {
        return false;
      }

      if (url.searchParams.get("layer") === "c") {
        return true;
      }

      const route = `${url.pathname}${url.search}${url.hash}`;
      const hasPanoramaCamera = /(?:^|[,/])3a(?:[,!/]|$)/.test(route);
      const hasPanoramaData = /!1e1(?:!|$)/.test(route);

      return hasPanoramaData || (hasPanoramaCamera && route.includes("/data="));
    } catch {
      return false;
    }
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || element.hidden) {
      return false;
    }

    const style = window.getComputedStyle(element);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      element.getClientRects().length > 0
    );
  }

  function hasStreetViewDomSignature() {
    return STREET_VIEW_SCENE_SELECTORS.some((selector) => {
      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    });
  }

  function isStreetViewActive() {
    return (
      hasStreetViewUrlSignature(window.location.href) ||
      hasStreetViewDomSignature()
    );
  }

  function createImage(className, path) {
    const image = document.createElement("img");
    image.className = className;
    image.src = chrome.runtime.getURL(path);
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    return image;
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;

    if (text !== undefined) {
      element.textContent = text;
    }

    return element;
  }

  function appendChildren(parent, ...children) {
    for (const child of children) {
      parent.appendChild(child);
    }

    return parent;
  }

  function readStreetViewCoordinate(href) {
    const match = String(href).match(
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/)/,
    );

    if (!match) {
      return null;
    }

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return null;
    }

    return { latitude, longitude };
  }

  function distanceBetweenCoordinates(from, to) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const latitudeDelta = toRadians(to.latitude - from.latitude);
    const longitudeDelta = toRadians(to.longitude - from.longitude);
    const fromLatitude = toRadians(from.latitude);
    const toLatitude = toRadians(to.latitude);
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(fromLatitude) *
        Math.cos(toLatitude) *
        Math.sin(longitudeDelta / 2) ** 2;

    return (
      2 *
      EARTH_RADIUS_METERS *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  }

  function formatElapsedTime(elapsedMilliseconds) {
    const totalSeconds = Math.max(0, Math.floor(elapsedMilliseconds / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatDistance(distanceMeters) {
    if (distanceMeters < 1_000) {
      return `${Math.round(distanceMeters)} м`;
    }

    return `${(distanceMeters / 1_000).toFixed(1)} км`;
  }

  function startTelemetrySession(now = Date.now()) {
    telemetryState.startedAt = now;
    telemetryState.lastCoordinate = readStreetViewCoordinate(
      window.location.href,
    );
    telemetryState.lastCoordinateAt = telemetryState.lastCoordinate ? now : null;
    telemetryState.lastMovementAt = null;
    telemetryState.distanceMeters = 0;
    telemetryState.movementCount = 0;
    hudState.time = "00:00";
    hudState.speedKmh = 0;
    hudState.distanceMeters = 0;
    hudState.movementCount = 0;
    speedingNoticeState.armed = true;
    speedingNoticeState.visibleUntil = 0;
  }

  function stopTelemetrySession() {
    telemetryState.startedAt = null;
    telemetryState.lastCoordinate = null;
    telemetryState.lastCoordinateAt = null;
    telemetryState.lastMovementAt = null;
    speedingNoticeState.armed = true;
    speedingNoticeState.visibleUntil = 0;
  }

  function updateTelemetry(now = Date.now()) {
    if (telemetryState.startedAt === null) {
      return;
    }

    let stateChanged = false;
    const elapsedTime = formatElapsedTime(now - telemetryState.startedAt);
    if (hudState.time !== elapsedTime) {
      hudState.time = elapsedTime;
      stateChanged = true;
    }

    const coordinate = readStreetViewCoordinate(window.location.href);
    if (coordinate && !telemetryState.lastCoordinate) {
      telemetryState.lastCoordinate = coordinate;
      telemetryState.lastCoordinateAt = now;
    } else if (coordinate && telemetryState.lastCoordinate) {
      const stepDistance = distanceBetweenCoordinates(
        telemetryState.lastCoordinate,
        coordinate,
      );

      if (stepDistance >= MIN_TRACKED_STEP_METERS) {
        const elapsedSinceCoordinate = Math.max(
          0.25,
          (now - telemetryState.lastCoordinateAt) / 1_000,
        );
        telemetryState.lastCoordinate = coordinate;
        telemetryState.lastCoordinateAt = now;

        if (stepDistance <= MAX_TRACKED_STEP_METERS) {
          telemetryState.distanceMeters += stepDistance;
          telemetryState.movementCount += 1;
          telemetryState.lastMovementAt = now;

          const instantaneousSpeed = Math.min(
            MAX_TRACKED_SPEED_KMH,
            (stepDistance / elapsedSinceCoordinate) * 3.6,
          );
          hudState.speedKmh =
            hudState.speedKmh > 0
              ? hudState.speedKmh * 0.35 + instantaneousSpeed * 0.65
              : instantaneousSpeed;
          hudState.distanceMeters = telemetryState.distanceMeters;
          hudState.movementCount = telemetryState.movementCount;
          stateChanged = true;
        } else {
          telemetryState.lastMovementAt = null;
          if (hudState.speedKmh !== 0) {
            hudState.speedKmh = 0;
            stateChanged = true;
          }
        }
      }
    }

    if (
      telemetryState.lastMovementAt !== null &&
      now - telemetryState.lastMovementAt >= SPEED_IDLE_TIMEOUT_MS &&
      hudState.speedKmh !== 0
    ) {
      hudState.speedKmh = 0;
      stateChanged = true;
    }

    if (stateChanged) {
      applyHudState();
    }
  }

  function renderDigitalValue(display, value) {
    const stringValue = String(value);
    if (display.getAttribute("data-value") === stringValue) {
      return;
    }

    display.replaceChildren();
    display.setAttribute("data-value", stringValue);

    for (const character of stringValue) {
      if (character === ":") {
        const colon = createElement("span", "dalnoboyshiki2-hud__colon");
        colon.appendChild(createElement("i", "dalnoboyshiki2-hud__dot"));
        colon.appendChild(createElement("i", "dalnoboyshiki2-hud__dot"));
        display.appendChild(colon);
        continue;
      }

      const normalizedCharacter = character.toUpperCase();
      const digit = createElement("span", "dalnoboyshiki2-hud__digit");
      const glyph = document.createElementNS(SVG_NAMESPACE, "svg");
      glyph.setAttribute("class", "dalnoboyshiki2-hud__glyph");
      glyph.setAttribute("viewBox", "-1 -1 16 26");
      glyph.setAttribute("preserveAspectRatio", "none");
      glyph.setAttribute("aria-hidden", "true");
      glyph.setAttribute("focusable", "false");
      digit.setAttribute("data-digit", normalizedCharacter);

      for (const pathData of POSTAL_GLYPHS[normalizedCharacter] ?? []) {
        const path = document.createElementNS(SVG_NAMESPACE, "path");
        path.setAttribute("d", pathData);
        glyph.appendChild(path);
      }

      digit.appendChild(glyph);
      display.appendChild(digit);
    }
  }

  function createDigitalOutput(id, className, value) {
    const output = createElement("output", className);
    output.id = id;
    renderDigitalValue(output, value);
    return output;
  }

  function createHud() {
    const hud = createElement("div", "dalnoboyshiki2-hud");
    hud.id = HUD_ID;
    hud.setAttribute("aria-hidden", "true");

    const timeCell = createElement(
      "section",
      "dalnoboyshiki2-hud__cell dalnoboyshiki2-hud__time",
    );
    const timeValue = createDigitalOutput(
      "dalnoboyshiki2-hud-time",
      "dalnoboyshiki2-hud__digits dalnoboyshiki2-hud__time-value",
      hudState.time,
    );
    appendChildren(
      timeCell,
      createElement("span", "dalnoboyshiki2-hud__label", "ВРЕМЯ"),
      timeValue,
    );

    const speedCell = createElement("div", "dalnoboyshiki2-hud__speed");
    const speedValue = createDigitalOutput(
      "dalnoboyshiki2-hud-speed",
      "dalnoboyshiki2-hud__digits dalnoboyshiki2-hud__speed-value",
      hudState.speedKmh,
    );
    appendChildren(
      speedCell,
      speedValue,
      createElement("span", "dalnoboyshiki2-hud__unit", "км/ч"),
    );

    const rpmCell = createElement("div", "dalnoboyshiki2-hud__rpm");
    const transmission = createElement(
      "div",
      "dalnoboyshiki2-hud__transmission",
    );
    const gearValue = createDigitalOutput(
      "dalnoboyshiki2-hud-gear",
      "dalnoboyshiki2-hud__gear",
      hudState.gear,
    );
    appendChildren(
      transmission,
      createElement("span", "dalnoboyshiki2-hud__label", "АКПП"),
      gearValue,
    );

    const rpmLine = createElement("div", "dalnoboyshiki2-hud__rpm-line");
    const rpmValue = createDigitalOutput(
      "dalnoboyshiki2-hud-rpm",
      "dalnoboyshiki2-hud__digits dalnoboyshiki2-hud__rpm-value",
      Math.round(hudState.rpm / 100),
    );
    appendChildren(
      rpmLine,
      rpmValue,
      createElement("span", "dalnoboyshiki2-hud__factor", "x100"),
      createElement("span", "dalnoboyshiki2-hud__unit", "об/м"),
    );
    appendChildren(rpmCell, transmission, rpmLine);

    const driveCell = createElement(
      "section",
      "dalnoboyshiki2-hud__cell dalnoboyshiki2-hud__drive",
    );
    appendChildren(driveCell, speedCell, rpmCell);

    const statusCell = createElement(
      "section",
      "dalnoboyshiki2-hud__cell dalnoboyshiki2-hud__status",
    );
    const fuelGauge = createElement("div", "dalnoboyshiki2-hud__fuel-gauge");
    appendChildren(
      fuelGauge,
      createElement("span", "dalnoboyshiki2-hud__fuel-level"),
      createElement("span", "dalnoboyshiki2-hud__fuel-cap"),
    );

    const pump = createImage(
      "dalnoboyshiki2-hud__status-icon dalnoboyshiki2-hud__pump",
      "images/hud-fuel-icon.png",
    );
    const engine = createImage(
      "dalnoboyshiki2-hud__status-icon dalnoboyshiki2-hud__engine",
      "images/hud-engine-icon.png",
    );

    const leftBars = createElement("span", "dalnoboyshiki2-hud__bars");
    const rightBars = createElement("span", "dalnoboyshiki2-hud__bars");
    for (let index = 0; index < 5; index += 1) {
      leftBars.appendChild(createElement("i", "dalnoboyshiki2-hud__bar"));
      rightBars.appendChild(createElement("i", "dalnoboyshiki2-hud__bar"));
    }
    appendChildren(statusCell, fuelGauge, pump, leftBars, engine, rightBars);

    const tripCell = createElement(
      "section",
      "dalnoboyshiki2-hud__cell dalnoboyshiki2-hud__blank dalnoboyshiki2-hud__trip",
    );
    const tripDistance = createElement(
      "output",
      "dalnoboyshiki2-hud__trip-distance",
      formatDistance(hudState.distanceMeters),
    );
    tripDistance.id = "dalnoboyshiki2-hud-distance";
    const tripMoves = createElement(
      "span",
      "dalnoboyshiki2-hud__trip-moves",
      `ХОДЫ ${hudState.movementCount}`,
    );
    tripMoves.id = "dalnoboyshiki2-hud-moves";
    appendChildren(
      tripCell,
      createElement("span", "dalnoboyshiki2-hud__trip-label", "ПУТЬ"),
      tripDistance,
      tripMoves,
    );

    appendChildren(hud, timeCell, driveCell, statusCell, tripCell);
    hud.style.setProperty("--dalnoboyshiki2-fuel-level", `${hudState.fuelPercent}%`);
    hud.setAttribute("data-fuel-warning", String(hudState.fuelPercent <= 15));
    hud.setAttribute("data-engine-warning", String(hudState.engineWarning));
    return hud;
  }

  function createMusicPlayer() {
    const music = createElement("section", "dalnoboyshiki2-music");
    music.id = MUSIC_ID;
    music.setAttribute("data-open", "false");
    music.setAttribute("aria-label", "Фирменная музыка Дальнобойщиков 2");

    const toggle = createElement(
      "button",
      "dalnoboyshiki2-music__toggle",
    );
    toggle.id = "dalnoboyshiki2-music-toggle";
    toggle.setAttribute("type", "button");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "dalnoboyshiki2-music-panel");
    toggle.setAttribute("title", "Открыть фирменный саундтрек");

    const screen = createElement("span", "dalnoboyshiki2-music__screen");
    appendChildren(
      screen,
      createElement("span", "dalnoboyshiki2-music__station", "FM RADIO"),
    );
    appendChildren(
      toggle,
      createElement("span", "dalnoboyshiki2-music__led"),
      screen,
      createElement("span", "dalnoboyshiki2-music__cassette"),
    );

    const panel = createElement("div", "dalnoboyshiki2-music__panel");
    panel.id = "dalnoboyshiki2-music-panel";
    panel.hidden = true;

    const panelHeader = createElement(
      "div",
      "dalnoboyshiki2-music__panel-header",
    );
    const close = createElement(
      "button",
      "dalnoboyshiki2-music__close",
      "ВЫКЛ",
    );
    close.id = "dalnoboyshiki2-music-close";
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Закрыть проигрыватель и остановить музыку");
    appendChildren(
      panelHeader,
      createElement(
        "span",
        "dalnoboyshiki2-music__panel-title",
        "ФИРМЕННЫЙ САУНДТРЕК",
      ),
      close,
    );

    const frame = createElement("iframe", "dalnoboyshiki2-music__frame");
    frame.id = "dalnoboyshiki2-music-frame";
    frame.setAttribute("title", "Плейлист Дальнобойщики 2 на YouTube");
    frame.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    );
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

    const externalLink = createElement(
      "a",
      "dalnoboyshiki2-music__external",
      "ОТКРЫТЬ НА YOUTUBE ↗",
    );
    externalLink.setAttribute("href", MUSIC_PLAYLIST_URL);
    externalLink.setAttribute("target", "_blank");
    externalLink.setAttribute("rel", "noopener noreferrer");

    appendChildren(panel, panelHeader, frame, externalLink);
    appendChildren(music, toggle, panel);

    function setOpen(isOpen) {
      music.setAttribute("data-open", String(isOpen));
      toggle.setAttribute("aria-expanded", String(isOpen));
      panel.hidden = !isOpen;

      if (isOpen) {
        frame.setAttribute("src", MUSIC_EMBED_URL);
      } else {
        frame.removeAttribute("src");
      }
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(music.getAttribute("data-open") !== "true");
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(false);
      toggle.focus();
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.focus();
      }
    });
    for (const eventName of ["pointerdown", "click", "dblclick", "wheel"]) {
      music.addEventListener(eventName, (event) => event.stopPropagation());
    }

    return music;
  }

  function createSpeedingNotice() {
    const notice = createElement("aside", "dalnoboyshiki2-speeding-notice");
    notice.id = "dalnoboyshiki2-speeding-notice";
    notice.hidden = true;
    notice.setAttribute("role", "alert");
    notice.setAttribute(
      "aria-label",
      "Превышение скорости зафиксировано камерой слежения. Штраф 250.",
    );

    const image = createImage(
      "dalnoboyshiki2-speeding-notice__image",
      "images/speeding-ticket.png",
    );
    image.alt = "";
    notice.appendChild(image);
    return notice;
  }

  function applySpeedingNotice(now = Date.now()) {
    const notice = document.getElementById("dalnoboyshiki2-speeding-notice");
    if (!notice) {
      return;
    }

    if (hudState.speedKmh <= SPEEDING_REARM_KMH) {
      speedingNoticeState.armed = true;
    }

    if (
      speedingNoticeState.armed &&
      hudState.speedKmh > SPEEDING_LIMIT_KMH
    ) {
      speedingNoticeState.armed = false;
      speedingNoticeState.visibleUntil = now + SPEEDING_NOTICE_DURATION_MS;
    }

    notice.hidden = now >= speedingNoticeState.visibleUntil;
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(maximum, Math.max(minimum, number))
      : fallback;
  }

  function applyHudState(hud = document.getElementById(HUD_ID)) {
    if (!hud) {
      return;
    }

    renderDigitalValue(document.getElementById("dalnoboyshiki2-hud-time"), hudState.time);
    renderDigitalValue(
      document.getElementById("dalnoboyshiki2-hud-speed"),
      Math.round(hudState.speedKmh),
    );
    renderDigitalValue(document.getElementById("dalnoboyshiki2-hud-gear"), hudState.gear);
    renderDigitalValue(
      document.getElementById("dalnoboyshiki2-hud-rpm"),
      Math.round(hudState.rpm / 100),
    );
    hud.style.setProperty("--dalnoboyshiki2-fuel-level", `${hudState.fuelPercent}%`);
    hud.setAttribute("data-fuel-warning", String(hudState.fuelPercent <= 15));
    hud.setAttribute("data-engine-warning", String(hudState.engineWarning));

    const distance = document.getElementById("dalnoboyshiki2-hud-distance");
    const moves = document.getElementById("dalnoboyshiki2-hud-moves");
    if (distance) {
      distance.textContent = formatDistance(hudState.distanceMeters);
    }
    if (moves) {
      moves.textContent = `ХОДЫ ${hudState.movementCount}`;
    }

    applySpeedingNotice();
  }

  function updateHud(patch) {
    if (!patch || typeof patch !== "object") {
      return;
    }

    if (typeof patch.time === "string" && /^\d{1,3}:[0-5]\d$/.test(patch.time)) {
      hudState.time = patch.time;
    }
    if (patch.speedKmh !== undefined) {
      hudState.speedKmh = clampNumber(patch.speedKmh, 0, 999, hudState.speedKmh);
    }
    if (patch.rpm !== undefined) {
      hudState.rpm = clampNumber(patch.rpm, 0, 9999, hudState.rpm);
    }
    if (patch.fuelPercent !== undefined) {
      hudState.fuelPercent = clampNumber(
        patch.fuelPercent,
        0,
        100,
        hudState.fuelPercent,
      );
    }
    if (
      (typeof patch.gear === "string" || typeof patch.gear === "number") &&
      /^[0-9NPRD]$/i.test(String(patch.gear))
    ) {
      hudState.gear = String(patch.gear).toUpperCase();
    }
    if (typeof patch.engineWarning === "boolean") {
      hudState.engineWarning = patch.engineWarning;
    }

    applyHudState();
  }

  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    overlay.appendChild(createHud());
    overlay.appendChild(
      createImage(
        "dalnoboyshiki2-overlay__cabin",
        "images/bottom-cabin@2x.png",
      ),
    );
    overlay.appendChild(createSpeedingNotice());
    overlay.appendChild(createMusicPlayer());

    return overlay;
  }

  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID) || !document.body) {
      return;
    }

    if (telemetryState.startedAt === null) {
      startTelemetrySession();
    }

    document.body.appendChild(createOverlay());
    applyHudState();
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    stopTelemetrySession();
  }

  function syncOverlay() {
    syncTimer = null;
    lastLocation = window.location.href;

    if (isStreetViewActive()) {
      ensureOverlay();
    } else {
      removeOverlay();
    }
  }

  function scheduleSync() {
    if (syncTimer !== null) {
      return;
    }

    syncTimer = window.setTimeout(syncOverlay, 50);
  }

  const pageObserver = new MutationObserver(scheduleSync);
  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("hashchange", scheduleSync);
  window.addEventListener("popstate", scheduleSync);
  window.addEventListener("pageshow", scheduleSync);
  window.addEventListener(HUD_UPDATE_EVENT, (event) => updateHud(event.detail));

  window.setInterval(() => {
    const locationChanged = lastLocation !== window.location.href;
    const overlayIsMounted = document.getElementById(OVERLAY_ID) !== null;
    const streetViewIsActive = isStreetViewActive();

    if (streetViewIsActive && overlayIsMounted) {
      updateTelemetry();
    }

    if (locationChanged || overlayIsMounted !== streetViewIsActive) {
      scheduleSync();
    }
  }, LOCATION_CHECK_INTERVAL_MS);

  syncOverlay();
})();
