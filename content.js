(() => {
  const OVERLAY_ID = "dalnoboyshiki2-overlay";
  const HUD_ID = "dalnoboyshiki2-hud";
  const MUSIC_ID = "dalnoboyshiki2-music";
  const GARAGE_ID = "dalnoboyshiki2-garage";
  const PAGER_ID = "dalnoboyshiki2-pager";
  const MINIMAP_SLOT_ID = "dalnoboyshiki2-minimap-slot";
  const GOOGLE_INFO_CARD_MARKER =
    "data-dalnoboyshiki2-hidden-streetview-card";
  const GOOGLE_MINIMAP_MARKER = "data-dalnoboyshiki2-google-minimap";
  const TRUCK_STORAGE_KEY = "dalnoboyshiki2-selected-truck";
  const FUEL_STORAGE_KEY = "dalnoboyshiki2-fuel-by-truck";
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

  const fallbackTruck = Object.freeze({
    id: "classic",
    name: "Классическая кабина",
    shortName: "КЛАССИКА",
    cabinImage: "images/bottom-cabin@2x.png",
    fuelTankCapacityLiters: 500,
    fuelConsumptionLitersPer100Km: 32,
  });
  const rawTruckConfig = globalThis.DALNOBOYSHIKI2_TRUCK_CONFIG;
  const configuredTrucks = Array.isArray(rawTruckConfig?.trucks)
    ? rawTruckConfig.trucks.filter((truck) => {
        return (
          truck &&
          /^[a-z0-9-]+$/i.test(truck.id) &&
          typeof truck.name === "string" &&
          typeof truck.shortName === "string" &&
          typeof truck.cabinImage === "string" &&
          Number.isFinite(truck.fuelTankCapacityLiters) &&
          truck.fuelTankCapacityLiters > 0 &&
          Number.isFinite(truck.fuelConsumptionLitersPer100Km) &&
          truck.fuelConsumptionLitersPer100Km > 0
        );
      })
    : [];
  const trucks = configuredTrucks.length > 0
    ? configuredTrucks
    : [fallbackTruck];
  const configuredDefaultTruck = trucks.find(
    (truck) => truck.id === rawTruckConfig?.defaultTruckId,
  );

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
  let hiddenGoogleInfoCard = null;
  let mountedGoogleMinimap = null;
  let selectedTruck = configuredDefaultTruck || trucks[0];
  const fuelLitersByTruck = {};

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
    fuelPercent: 100,
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

  function formatFuelConsumption(value) {
    const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return rounded.replace(".", ",");
  }

  function getTruckFuelLiters(truck = selectedTruck) {
    const storedValue = fuelLitersByTruck[truck.id];
    if (!Number.isFinite(storedValue)) {
      return truck.fuelTankCapacityLiters;
    }

    return Math.min(
      truck.fuelTankCapacityLiters,
      Math.max(0, storedValue),
    );
  }

  function persistFuelState() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage?.set) {
      return;
    }

    try {
      const operation = storage.set({
        [FUEL_STORAGE_KEY]: { ...fuelLitersByTruck },
      });
      operation?.catch?.(() => {});
    } catch {
      // Fuel consumption still works for the current page session.
    }
  }

  function setSelectedTruckFuelLiters(value, shouldPersist = false) {
    const fuelLiters = Math.min(
      selectedTruck.fuelTankCapacityLiters,
      Math.max(0, Number(value) || 0),
    );
    fuelLitersByTruck[selectedTruck.id] = fuelLiters;
    hudState.fuelPercent =
      (fuelLiters / selectedTruck.fuelTankCapacityLiters) * 100;

    const overlay = document.getElementById(OVERLAY_ID);
    overlay?.setAttribute(
      "data-fuel-remaining-liters",
      fuelLiters.toFixed(3),
    );

    const refuel = document.getElementById("dalnoboyshiki2-refuel");
    refuel?.setAttribute(
      "title",
      `Заправить ${selectedTruck.name}. Сейчас ${formatFuelConsumption(
        fuelLiters,
      )} из ${formatFuelConsumption(
        selectedTruck.fuelTankCapacityLiters,
      )} л`,
    );
    refuel?.setAttribute(
      "data-full",
      String(fuelLiters >= selectedTruck.fuelTankCapacityLiters),
    );

    if (shouldPersist) {
      persistFuelState();
    }
    return fuelLiters;
  }

  function consumeFuelForDistance(distanceMeters) {
    const consumedLiters =
      (distanceMeters / 1_000) *
      (selectedTruck.fuelConsumptionLitersPer100Km / 100);
    if (consumedLiters <= 0) {
      return;
    }

    setSelectedTruckFuelLiters(
      getTruckFuelLiters() - consumedLiters,
      true,
    );
  }

  function refuelSelectedTruck() {
    setSelectedTruckFuelLiters(
      selectedTruck.fuelTankCapacityLiters,
      true,
    );
    applyHudState();
  }

  function getTruckOptionId(truckId) {
    return `dalnoboyshiki2-truck-${truckId}`;
  }

  function applySelectedTruck() {
    setSelectedTruckFuelLiters(getTruckFuelLiters());
    const overlay = document.getElementById(OVERLAY_ID);
    const cabin = document.getElementById("dalnoboyshiki2-cabin");
    const currentName = document.getElementById(
      "dalnoboyshiki2-garage-current",
    );
    const consumption = document.getElementById(
      "dalnoboyshiki2-garage-consumption",
    );

    if (overlay) {
      overlay.setAttribute("data-truck-id", selectedTruck.id);
      overlay.setAttribute(
        "data-fuel-consumption-l-per-100-km",
        String(selectedTruck.fuelConsumptionLitersPer100Km),
      );
      overlay.setAttribute(
        "data-fuel-tank-capacity-liters",
        String(selectedTruck.fuelTankCapacityLiters),
      );
    }
    if (cabin) {
      cabin.src = chrome.runtime.getURL(selectedTruck.cabinImage);
      cabin.setAttribute("data-truck-id", selectedTruck.id);
    }
    if (currentName) {
      currentName.textContent = selectedTruck.shortName;
    }
    if (consumption) {
      consumption.textContent = `БАК ${formatFuelConsumption(
        selectedTruck.fuelTankCapacityLiters,
      )} Л · ${formatFuelConsumption(
        selectedTruck.fuelConsumptionLitersPer100Km,
      )} Л/100`;
    }

    for (const truck of trucks) {
      const option = document.getElementById(getTruckOptionId(truck.id));
      const isSelected = truck.id === selectedTruck.id;
      option?.setAttribute("aria-pressed", String(isSelected));
      option?.setAttribute("data-selected", String(isSelected));
    }

    const toggle = document.getElementById("dalnoboyshiki2-garage-toggle");
    toggle?.setAttribute(
      "title",
      `${selectedTruck.name}. Бак ${formatFuelConsumption(
        selectedTruck.fuelTankCapacityLiters,
      )} л. Расход ${formatFuelConsumption(
        selectedTruck.fuelConsumptionLitersPer100Km,
      )} л/100 км`,
    );
    applyHudState();
  }

  function persistSelectedTruck() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage?.set) {
      return;
    }

    try {
      const operation = storage.set({
        [TRUCK_STORAGE_KEY]: selectedTruck.id,
      });
      operation?.catch?.(() => {});
    } catch {
      // The selected truck still works for the current page session.
    }
  }

  function selectTruck(truckId, shouldPersist = true) {
    const truck = trucks.find((candidate) => candidate.id === truckId);
    if (!truck) {
      return false;
    }

    selectedTruck = truck;
    applySelectedTruck();
    if (shouldPersist) {
      persistSelectedTruck();
    }
    return true;
  }

  function restoreSelectedTruck() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage?.get) {
      return;
    }

    try {
      Promise.resolve(storage.get([TRUCK_STORAGE_KEY, FUEL_STORAGE_KEY]))
        .then((values) => {
          const storedFuel = values?.[FUEL_STORAGE_KEY];
          if (storedFuel && typeof storedFuel === "object") {
            for (const truck of trucks) {
              const fuelLiters = Number(storedFuel[truck.id]);
              if (Number.isFinite(fuelLiters)) {
                fuelLitersByTruck[truck.id] = fuelLiters;
              }
            }
          }

          if (!selectTruck(values?.[TRUCK_STORAGE_KEY], false)) {
            applySelectedTruck();
          }
        })
        .catch(() => {});
    } catch {
      // Keep the configured default when storage is unavailable.
    }
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
          consumeFuelForDistance(stepDistance);

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

    const leftBars = createElement(
      "span",
      "dalnoboyshiki2-hud__bars dalnoboyshiki2-hud__fuel-bars",
    );
    const rightBars = createElement("span", "dalnoboyshiki2-hud__bars");
    for (let index = 0; index < 5; index += 1) {
      const fuelBar = createElement("i", "dalnoboyshiki2-hud__bar");
      fuelBar.id = `dalnoboyshiki2-fuel-bar-${index + 1}`;
      leftBars.appendChild(fuelBar);
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

  function createRefuelButton() {
    const button = createElement(
      "button",
      "dalnoboyshiki2-refuel",
      "ЗАПРАВИТЬСЯ",
    );
    button.id = "dalnoboyshiki2-refuel";
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", "Заправить бак до ста процентов");
    button.setAttribute("data-full", "true");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      refuelSelectedTruck();
    });
    for (const eventName of ["pointerdown", "dblclick", "wheel"]) {
      button.addEventListener(eventName, (event) => event.stopPropagation());
    }
    return button;
  }

  function createGarage() {
    const garage = createElement("section", "dalnoboyshiki2-garage");
    garage.id = GARAGE_ID;
    garage.setAttribute("data-open", "false");
    garage.setAttribute("aria-label", "Выбор кабины грузовика");

    const toggle = createElement(
      "button",
      "dalnoboyshiki2-garage__toggle",
    );
    toggle.id = "dalnoboyshiki2-garage-toggle";
    toggle.setAttribute("type", "button");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "dalnoboyshiki2-garage-panel");

    const screen = createElement("span", "dalnoboyshiki2-garage__screen");
    const currentName = createElement(
      "span",
      "dalnoboyshiki2-garage__current",
      selectedTruck.shortName,
    );
    currentName.id = "dalnoboyshiki2-garage-current";
    const consumption = createElement(
      "span",
      "dalnoboyshiki2-garage__consumption",
      `БАК ${formatFuelConsumption(
        selectedTruck.fuelTankCapacityLiters,
      )} Л · ${formatFuelConsumption(
        selectedTruck.fuelConsumptionLitersPer100Km,
      )} Л/100`,
    );
    consumption.id = "dalnoboyshiki2-garage-consumption";
    appendChildren(
      screen,
      createElement("span", "dalnoboyshiki2-garage__label", "ГАРАЖ"),
      currentName,
      consumption,
    );
    appendChildren(
      toggle,
      createElement("span", "dalnoboyshiki2-garage__led"),
      screen,
    );

    const panel = createElement("div", "dalnoboyshiki2-garage__panel");
    panel.id = "dalnoboyshiki2-garage-panel";
    panel.hidden = true;

    const panelHeader = createElement(
      "div",
      "dalnoboyshiki2-garage__panel-header",
    );
    const close = createElement(
      "button",
      "dalnoboyshiki2-garage__close",
      "ЗАКР",
    );
    close.id = "dalnoboyshiki2-garage-close";
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Закрыть выбор кабины");
    appendChildren(
      panelHeader,
      createElement(
        "span",
        "dalnoboyshiki2-garage__panel-title",
        "ВЫБОР МАШИНЫ",
      ),
      close,
    );

    const list = createElement("div", "dalnoboyshiki2-garage__list");
    for (const truck of trucks) {
      const option = createElement(
        "button",
        "dalnoboyshiki2-garage__option",
      );
      option.id = getTruckOptionId(truck.id);
      option.setAttribute("type", "button");
      option.setAttribute("aria-pressed", String(truck.id === selectedTruck.id));
      option.setAttribute("data-selected", String(truck.id === selectedTruck.id));
      appendChildren(
        option,
        createElement(
          "span",
          "dalnoboyshiki2-garage__option-name",
          truck.name,
        ),
        createElement(
          "span",
          "dalnoboyshiki2-garage__option-consumption",
          `БАК ${formatFuelConsumption(
            truck.fuelTankCapacityLiters,
          )} Л · РАСХОД ${formatFuelConsumption(
            truck.fuelConsumptionLitersPer100Km,
          )} Л/100 КМ`,
        ),
      );
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        selectTruck(truck.id);
        setOpen(false);
        toggle.focus();
      });
      list.appendChild(option);
    }
    appendChildren(panel, panelHeader, list);
    appendChildren(garage, toggle, panel);

    function setOpen(isOpen) {
      garage.setAttribute("data-open", String(isOpen));
      toggle.setAttribute("aria-expanded", String(isOpen));
      panel.hidden = !isOpen;
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(garage.getAttribute("data-open") !== "true");
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
      garage.addEventListener(eventName, (event) => event.stopPropagation());
    }

    return garage;
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

  function createPager() {
    const pager = createElement("section", "dalnoboyshiki2-pager");
    pager.id = PAGER_ID;
    pager.hidden = true;
    pager.setAttribute("aria-live", "polite");
    pager.setAttribute("aria-label", "Текущее местоположение");

    const screen = createElement("div", "dalnoboyshiki2-pager__screen");
    const message = createElement(
      "output",
      "dalnoboyshiki2-pager__message",
    );
    message.id = "dalnoboyshiki2-pager-message";
    appendChildren(
      screen,
      createElement("span", "dalnoboyshiki2-pager__label", "МАРШРУТ:"),
      message,
    );
    appendChildren(
      pager,
      createElement("i", "dalnoboyshiki2-pager__signal"),
      screen,
    );
    return pager;
  }

  function createMinimapSlot() {
    const slot = createElement("div", "dalnoboyshiki2-minimap-slot");
    slot.id = MINIMAP_SLOT_ID;
    slot.hidden = true;
    return slot;
  }

  function getGoogleStreetViewInfoCard() {
    if (hiddenGoogleInfoCard?.parentNode) {
      return hiddenGoogleInfoCard;
    }

    hiddenGoogleInfoCard = null;
    const overlay = document.getElementById(OVERLAY_ID);
    const candidates = document.querySelectorAll(
      '[role="navigation"], .widget-titlecard',
    );

    for (const candidate of candidates) {
      if (overlay?.contains(candidate)) {
        continue;
      }

      const title = candidate.querySelector(
        'h1, [role="heading"][aria-level="1"]',
      );
      const subtitles = candidate.querySelectorAll(
        'h2, [role="heading"][aria-level="2"]',
      );
      const rect = candidate.getBoundingClientRect();
      const isStreetViewCard =
        title?.textContent?.trim() &&
        subtitles.length > 0 &&
        rect.width >= 180 &&
        rect.width <= 600 &&
        rect.height >= 70 &&
        rect.height <= 300 &&
        rect.left < 600 &&
        rect.top < 320;

      if (isStreetViewCard) {
        hiddenGoogleInfoCard = candidate;
        return candidate;
      }
    }

    return null;
  }

  function syncGoogleStreetViewInfoCard() {
    const pager = document.getElementById(PAGER_ID);
    if (!pager) {
      return;
    }

    const card = getGoogleStreetViewInfoCard();
    if (!card) {
      pager.hidden = true;
      return;
    }

    const title = card
      .querySelector('h1, [role="heading"][aria-level="1"]')
      ?.textContent?.trim();
    const subtitle = Array.from(
      card.querySelectorAll('h2, [role="heading"][aria-level="2"]'),
    )
      .map((element) => element.textContent?.trim())
      .find((text) => text && !/^Google\b/i.test(text));
    const messageText = [title, subtitle].filter(Boolean).join(" — ");
    const message = document.getElementById("dalnoboyshiki2-pager-message");

    if (!messageText || !message) {
      pager.hidden = true;
      return;
    }

    card.setAttribute(GOOGLE_INFO_CARD_MARKER, "true");
    if (message.textContent !== messageText) {
      message.textContent = messageText;
      pager.setAttribute("title", messageText);
    }
    pager.hidden = false;
  }

  function restoreGoogleStreetViewInfoCard() {
    hiddenGoogleInfoCard?.removeAttribute(GOOGLE_INFO_CARD_MARKER);
    hiddenGoogleInfoCard = null;
  }

  function getGoogleStreetViewMinimap() {
    if (
      mountedGoogleMinimap?.element?.parentNode?.id === MINIMAP_SLOT_ID
    ) {
      return mountedGoogleMinimap.element;
    }

    const overlay = document.getElementById(OVERLAY_ID);
    const labeledCandidates = document.querySelectorAll(
      '[aria-label="Интерактивная карта"], [aria-label="Interactive map"]',
    );
    const fallbackCandidates = document.querySelectorAll(
      '[role="application"] [aria-label]',
    );
    const candidates = [...labeledCandidates, ...fallbackCandidates];
    const viewportHeight = window.innerHeight || 900;

    for (const candidate of candidates) {
      if (overlay?.contains(candidate)) {
        continue;
      }

      const rect = candidate.getBoundingClientRect();
      const label = candidate.getAttribute("aria-label") || "";
      const hasKnownLabel = /^(Интерактивная карта|Interactive map)$/i.test(
        label,
      );
      const hasMapContent = Boolean(
        candidate.querySelector('img[role="presentation"], canvas'),
      );
      const isBottomLeftMap =
        rect.width >= 120 &&
        rect.width <= 500 &&
        rect.height >= 70 &&
        rect.height <= 300 &&
        rect.left < 100 &&
        rect.top > viewportHeight * 0.4;

      if ((hasKnownLabel || hasMapContent) && isBottomLeftMap) {
        const minimapContainer = candidate.parentElement || candidate;
        const interactionHost = minimapContainer.parentElement;
        const hostRect = interactionHost?.getBoundingClientRect();
        const isDedicatedInteractionHost =
          interactionHost &&
          interactionHost !== document.body &&
          hostRect.width >= rect.width &&
          hostRect.height <= 10;

        return isDedicatedInteractionHost
          ? interactionHost
          : minimapContainer;
      }
    }

    return null;
  }

  function syncGoogleStreetViewMinimap() {
    const slot = document.getElementById(MINIMAP_SLOT_ID);
    if (!slot) {
      return;
    }

    if (mountedGoogleMinimap?.element?.parentNode === slot) {
      slot.hidden = false;
      return;
    }

    const minimap = getGoogleStreetViewMinimap();
    if (!minimap || !minimap.parentNode) {
      slot.hidden = true;
      return;
    }

    mountedGoogleMinimap = {
      element: minimap,
      originalParent: minimap.parentNode,
      originalNextSibling: minimap.nextSibling,
    };
    minimap.setAttribute(GOOGLE_MINIMAP_MARKER, "true");
    slot.appendChild(minimap);
    slot.hidden = false;
  }

  function restoreGoogleStreetViewMinimap() {
    if (!mountedGoogleMinimap) {
      return;
    }

    const { element, originalParent, originalNextSibling } =
      mountedGoogleMinimap;
    element.removeAttribute(GOOGLE_MINIMAP_MARKER);
    if (originalParent?.parentNode) {
      const referenceNode =
        originalNextSibling?.parentNode === originalParent
          ? originalNextSibling
          : null;
      originalParent.insertBefore(element, referenceNode);
    }
    mountedGoogleMinimap = null;
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
    const activeFuelBars =
      hudState.fuelPercent > 0 ? Math.ceil(hudState.fuelPercent / 20) : 0;
    for (let index = 0; index < 5; index += 1) {
      const bar = document.getElementById(`dalnoboyshiki2-fuel-bar-${index + 1}`);
      const isActive = index >= 5 - activeFuelBars;
      const isLastRemaining = activeFuelBars === 1 && index === 4;
      bar?.setAttribute("data-active", String(isActive));
      bar?.setAttribute("data-low", String(isLastRemaining));
    }
    hud.setAttribute(
      "data-fuel-warning",
      String(hudState.fuelPercent > 0 && hudState.fuelPercent <= 20),
    );
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
    overlay.setAttribute("data-truck-id", selectedTruck.id);
    overlay.setAttribute(
      "data-fuel-consumption-l-per-100-km",
      String(selectedTruck.fuelConsumptionLitersPer100Km),
    );
    overlay.setAttribute(
      "data-fuel-tank-capacity-liters",
      String(selectedTruck.fuelTankCapacityLiters),
    );

    overlay.appendChild(createHud());
    const cabin = createImage(
      "dalnoboyshiki2-overlay__cabin",
      selectedTruck.cabinImage,
    );
    cabin.id = "dalnoboyshiki2-cabin";
    cabin.setAttribute("data-truck-id", selectedTruck.id);
    overlay.appendChild(cabin);
    overlay.appendChild(createSpeedingNotice());
    overlay.appendChild(createPager());
    overlay.appendChild(createMinimapSlot());
    overlay.appendChild(createRefuelButton());
    overlay.appendChild(createGarage());
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
    applySelectedTruck();
    applyHudState();
  }

  function removeOverlay() {
    restoreGoogleStreetViewInfoCard();
    restoreGoogleStreetViewMinimap();
    document.getElementById(OVERLAY_ID)?.remove();
    stopTelemetrySession();
  }

  function syncOverlay() {
    syncTimer = null;
    lastLocation = window.location.href;

    if (isStreetViewActive()) {
      ensureOverlay();
      syncGoogleStreetViewInfoCard();
      syncGoogleStreetViewMinimap();
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
      syncGoogleStreetViewInfoCard();
      syncGoogleStreetViewMinimap();
    }

    if (locationChanged || overlayIsMounted !== streetViewIsActive) {
      scheduleSync();
    }
  }, LOCATION_CHECK_INTERVAL_MS);

  restoreSelectedTruck();
  syncOverlay();
})();
