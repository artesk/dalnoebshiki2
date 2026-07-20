(() => {
  const OVERLAY_ID = "dalnoboyshiki2-overlay";
  const HUD_ID = "dalnoboyshiki2-hud";
  const HUD_UPDATE_EVENT = "dalnoboyshiki2:hud-update";
  const LOCATION_CHECK_INTERVAL_MS = 500;

  const STREET_VIEW_SCENE_SELECTORS = [
    ".widget-scene",
    ".widget-scene-canvas",
    "[data-testid='street-view-panorama']",
  ];
  const SEVEN_SEGMENTS = ["a", "b", "c", "d", "e", "f", "g"];
  const ACTIVE_SEGMENTS = {
    0: "abcdef",
    1: "bc",
    2: "abdeg",
    3: "abcdg",
    4: "bcfg",
    5: "acdfg",
    6: "acdefg",
    7: "abc",
    8: "abcdefg",
    9: "abcdfg",
    D: "bcdeg",
    N: "ceg",
    P: "abefg",
    R: "eg",
  };

  let lastLocation = window.location.href;
  let syncTimer = null;

  const hudState = {
    time: "00:00",
    speedKmh: 22,
    gear: "2",
    rpm: 2200,
    fuelPercent: 30,
    engineWarning: false,
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

  function renderDigitalValue(display, value) {
    const stringValue = String(value);
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

      const digit = createElement("span", "dalnoboyshiki2-hud__digit");
      const normalizedCharacter = character.toUpperCase();
      const activeSegments = ACTIVE_SEGMENTS[normalizedCharacter] ?? "";
      digit.setAttribute("data-digit", normalizedCharacter);
      for (const segment of SEVEN_SEGMENTS) {
        digit.appendChild(
          createElement(
            "i",
            `dalnoboyshiki2-hud__segment dalnoboyshiki2-hud__segment--${segment}${activeSegments.includes(segment) ? " dalnoboyshiki2-hud__segment--active" : ""}`,
          ),
        );
      }
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
      createElement("span", "dalnoboyshiki2-hud__label", "ОСТ.ВРЕМЯ"),
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

    const blankCell = createElement(
      "section",
      "dalnoboyshiki2-hud__cell dalnoboyshiki2-hud__blank",
    );

    appendChildren(hud, timeCell, driveCell, statusCell, blankCell);
    hud.style.setProperty("--dalnoboyshiki2-fuel-level", `${hudState.fuelPercent}%`);
    hud.setAttribute("data-fuel-warning", String(hudState.fuelPercent <= 15));
    hud.setAttribute("data-engine-warning", String(hudState.engineWarning));
    return hud;
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
    overlay.setAttribute("aria-hidden", "true");

    overlay.appendChild(createHud());
    overlay.appendChild(
      createImage(
        "dalnoboyshiki2-overlay__cabin",
        "images/bottom-cabin@2x.png",
      ),
    );

    return overlay;
  }

  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID) || !document.body) {
      return;
    }

    document.body.appendChild(createOverlay());
    applyHudState();
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
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

    if (locationChanged || overlayIsMounted !== isStreetViewActive()) {
      scheduleSync();
    }
  }, LOCATION_CHECK_INTERVAL_MS);

  syncOverlay();
})();
