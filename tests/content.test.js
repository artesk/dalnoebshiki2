const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const truckConfigScript = readFileSync(
  join(__dirname, "..", "trucks.config.js"),
  "utf8",
);
const contentScript = readFileSync(join(__dirname, "..", "content.js"), "utf8");

function createHarness({
  href,
  sceneVisible = false,
  streetViewInfo = null,
  withMinimap = false,
  truckConfig = null,
  storedTruckId = null,
  storedFuelByTruck = null,
}) {
  let intervalCallback;
  let currentTime = 0;
  const listeners = new Map();
  const storageValues = {};
  if (storedTruckId !== null) {
    storageValues["dalnoboyshiki2-selected-truck"] = storedTruckId;
  }
  if (storedFuelByTruck !== null) {
    storageValues["dalnoboyshiki2-fuel-by-truck"] = storedFuelByTruck;
  }

  class FakeHTMLElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.hidden = false;
      this.visible = true;
      this.id = "";
      this.className = "";
      this.textContent = "";
      this.attributes = {};
      this.listeners = new Map();
      this.focused = false;
      this.style = {
        properties: {},
        setProperty: (name, value) => {
          this.style.properties[name] = value;
        },
      };
    }

    appendChild(child) {
      if (child.parentNode) {
        child.parentNode.children = child.parentNode.children.filter(
          (sibling) => sibling !== child,
        );
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    insertBefore(child, referenceNode) {
      if (child.parentNode) {
        child.parentNode.children = child.parentNode.children.filter(
          (sibling) => sibling !== child,
        );
      }
      child.parentNode = this;
      const referenceIndex = this.children.indexOf(referenceNode);
      if (referenceIndex === -1) {
        this.children.push(child);
      } else {
        this.children.splice(referenceIndex, 0, child);
      }
      return child;
    }

    get nextSibling() {
      if (!this.parentNode) {
        return null;
      }
      const index = this.parentNode.children.indexOf(this);
      return this.parentNode.children[index + 1] ?? null;
    }

    get parentElement() {
      return this.parentNode;
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) ?? [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }

    dispatchEvent(event) {
      event.stopPropagation ??= () => {};
      for (const callback of this.listeners.get(event.type) ?? []) {
        callback(event);
      }
    }

    click() {
      this.dispatchEvent({ type: "click", stopPropagation() {} });
    }

    focus() {
      this.focused = true;
    }

    getClientRects() {
      return this.visible ? [{}] : [];
    }

    getBoundingClientRect() {
      return this.visible
        ? { left: 20, top: 72, width: 376, height: 139 }
        : { left: 0, top: 0, width: 0, height: 0 };
    }

    contains(target) {
      return this === target || this.children.some((child) => child.contains(target));
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
      const tagNames = selector
        .split(",")
        .map((part) => part.trim().match(/^h[12]$/i)?.[0]?.toLowerCase())
        .filter(Boolean);
      const matches = [];

      for (const child of this.children) {
        if (tagNames.includes(String(child.tagName).toLowerCase())) {
          matches.push(child);
        }
        matches.push(...child.querySelectorAll(selector));
      }

      return matches;
    }

    replaceChildren(...children) {
      this.children = [];
      for (const child of children) {
        this.appendChild(child);
      }
    }

    remove() {
      if (!this.parentNode) {
        return;
      }

      this.parentNode.children = this.parentNode.children.filter(
        (child) => child !== this,
      );
      this.parentNode = null;
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    getAttribute(name) {
      return this.attributes[name] ?? null;
    }

    removeAttribute(name) {
      delete this.attributes[name];
    }
  }

  const body = new FakeHTMLElement("body");
  const scene = new FakeHTMLElement("div");
  scene.visible = sceneVisible;
  let infoCard = null;
  if (streetViewInfo) {
    infoCard = new FakeHTMLElement("div");
    infoCard.setAttribute("role", "navigation");
    infoCard.appendChild(
      Object.assign(new FakeHTMLElement("h1"), {
        textContent: streetViewInfo.title,
      }),
    );
    infoCard.appendChild(
      Object.assign(new FakeHTMLElement("h2"), {
        textContent: streetViewInfo.subtitle,
      }),
    );
    body.appendChild(infoCard);
  }
  let minimapContainer = null;
  let minimapParent = null;
  let minimapOriginalParent = null;
  let minimapSurface = null;
  if (withMinimap) {
    const streetViewApp = new FakeHTMLElement("div");
    streetViewApp.setAttribute("role", "application");
    minimapParent = new FakeHTMLElement("div");
    minimapParent.className = "AbwhFc s7CGkb";
    minimapContainer = new FakeHTMLElement("div");
    minimapSurface = new FakeHTMLElement("div");
    minimapSurface.setAttribute("aria-label", "Интерактивная карта");
    minimapSurface.getBoundingClientRect = () => ({
      left: 22,
      top: 798,
      width: 218,
      height: 100,
    });
    minimapParent.getBoundingClientRect = () => ({
      left: 0,
      top: 900,
      width: 1280,
      height: 0,
    });
    minimapContainer.appendChild(minimapSurface);
    minimapParent.appendChild(minimapContainer);
    streetViewApp.appendChild(minimapParent);
    body.appendChild(streetViewApp);
    minimapOriginalParent = streetViewApp;
  }

  function findById(element, id) {
    if (element.id === id) {
      return element;
    }

    for (const child of element.children) {
      const match = findById(child, id);
      if (match) {
        return match;
      }
    }

    return null;
  }

  const document = {
    body,
    createElement: (tagName) => new FakeHTMLElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeHTMLElement(tagName),
    getElementById: (id) => findById(body, id),
    querySelectorAll: (selector) => {
      if (selector === ".widget-scene") {
        return scene.visible ? [scene] : [];
      }
      if (selector === '[role="navigation"], .widget-titlecard') {
        return infoCard ? [infoCard] : [];
      }
      if (
        selector ===
        '[aria-label="Интерактивная карта"], [aria-label="Interactive map"]'
      ) {
        return minimapSurface ? [minimapSurface] : [];
      }
      if (selector === '[role="application"] [aria-label]') {
        return minimapSurface ? [minimapSurface] : [];
      }
      return [];
    },
  };

  const window = {
    location: { href },
    innerHeight: 900,
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) ?? [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
    }),
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    setTimeout,
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {}
  }

  const context = vm.createContext({
    Array,
    DALNOBOYSHIKI2_TRUCK_CONFIG: truckConfig,
    Date: { now: () => currentTime },
    HTMLElement: FakeHTMLElement,
    MutationObserver: FakeMutationObserver,
    Number,
    URL,
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
      },
      storage: {
        local: {
          async get(key) {
            const keys = Array.isArray(key) ? key : [key];
            return Object.fromEntries(
              keys.map((storageKey) => [
                storageKey,
                storageValues[storageKey],
              ]),
            );
          },
          async set(values) {
            Object.assign(storageValues, values);
          },
        },
      },
    },
    document,
    setTimeout,
    window,
  });

  vm.runInContext(truckConfigScript, context);
  vm.runInContext(contentScript, context);

  return {
    body,
    document,
    infoCard,
    minimapContainer,
    minimapOriginalParent,
    minimapParent,
    scene,
    storageValues,
    dispatchHudUpdate(detail) {
      for (const callback of listeners.get("dalnoboyshiki2:hud-update") ?? []) {
        callback({ detail });
      }
    },
    setHref(nextHref) {
      window.location.href = nextHref;
    },
    async flush() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    async tick(elapsedMilliseconds = 500) {
      currentTime += elapsedMilliseconds;
      intervalCallback();
      await new Promise((resolve) => setTimeout(resolve, 75));
    },
  };
}

function overlayCount(harness) {
  return harness.body.children.filter(
    (child) => child.id === "dalnoboyshiki2-overlay",
  ).length;
}

test("mounts once on a direct Street View URL", async () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@59.9,30.3,3a,75y/data=!3m7!1e1!3m5!1stest",
  });

  assert.equal(overlayCount(harness), 1);
  const overlay = harness.document.getElementById("dalnoboyshiki2-overlay");
  assert.equal(overlay.children.length, 8);
  assert.equal(overlay.children[0].tagName, "div");
  assert.equal(overlay.children[1].tagName, "img");
  assert.equal(overlay.children[2].tagName, "aside");
  assert.equal(overlay.children[3].tagName, "section");
  assert.equal(overlay.children[4].tagName, "div");
  assert.equal(overlay.children[5].tagName, "button");
  assert.equal(overlay.children[6].tagName, "section");
  assert.equal(overlay.children[7].tagName, "section");

  await harness.tick();
  assert.equal(overlayCount(harness), 1);
});

test("switches truck skins, exposes fuel data and remembers the choice", async () => {
  const href =
    "https://www.google.com/maps/@59.9,30.3,3a,75y/data=!3m7!1e1!3m5!1stest";
  const harness = createHarness({ href });
  await harness.flush();

  const overlay = harness.document.getElementById("dalnoboyshiki2-overlay");
  const cabin = harness.document.getElementById("dalnoboyshiki2-cabin");
  const toggle = harness.document.getElementById("dalnoboyshiki2-garage-toggle");
  const panel = harness.document.getElementById("dalnoboyshiki2-garage-panel");
  const daf = harness.document.getElementById(
    "dalnoboyshiki2-truck-daf-95xf",
  );

  assert.match(cabin.src, /bottom-cabin@2x\.png$/);
  assert.equal(
    overlay.attributes["data-fuel-consumption-l-per-100-km"],
    "32",
  );
  assert.equal(overlay.attributes["data-fuel-tank-capacity-liters"], "500");

  toggle.click();
  assert.equal(panel.hidden, false);
  daf.click();

  assert.equal(panel.hidden, true);
  assert.match(cabin.src, /daf-95xf\.png$/);
  assert.equal(cabin.attributes["data-truck-id"], "daf-95xf");
  assert.equal(overlay.attributes["data-truck-id"], "daf-95xf");
  assert.equal(
    overlay.attributes["data-fuel-consumption-l-per-100-km"],
    "34",
  );
  assert.equal(overlay.attributes["data-fuel-tank-capacity-liters"], "355");
  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-garage-consumption")
      .textContent,
    "БАК 355 Л · 34 Л/100",
  );
  assert.equal(
    harness.storageValues["dalnoboyshiki2-selected-truck"],
    "daf-95xf",
  );

  const restoredHarness = createHarness({
    href,
    storedTruckId: "daf-95xf",
    storedFuelByTruck: { "daf-95xf": 100 },
  });
  await restoredHarness.flush();
  assert.match(
    restoredHarness.document.getElementById("dalnoboyshiki2-cabin").src,
    /daf-95xf\.png$/,
  );
  assert.equal(
    restoredHarness.document.getElementById("dalnoboyshiki2-overlay")
      .attributes["data-fuel-remaining-liters"],
    "100.000",
  );
});

test("mounts and removes during Maps soft navigation", async () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/place/Moscow",
  });

  assert.equal(overlayCount(harness), 0);

  harness.setHref(
    "https://www.google.com/maps/@55.7,37.6,3a,75y/data=!3m7!1e1!3m5!1stest",
  );
  await harness.tick();
  assert.equal(overlayCount(harness), 1);

  harness.setHref("https://www.google.com/maps/place/Moscow");
  await harness.tick();
  assert.equal(overlayCount(harness), 0);
});

test("uses a visible Street View scene as a DOM fallback", () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/place/Moscow",
    sceneVisible: true,
  });

  assert.equal(overlayCount(harness), 1);
});

test("recognizes the Street View layer query parameter", () => {
  const harness = createHarness({
    href: "https://www.google.com/maps?layer=c",
  });

  assert.equal(overlayCount(harness), 1);
});

test("supports the dedicated legacy Maps host", () => {
  const harness = createHarness({
    href: "https://maps.google.com/?layer=c",
  });

  assert.equal(overlayCount(harness), 1);
});

test("updates HTML HUD values without recreating the overlay", () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@59.9,30.3,3a,75y/data=!3m7!1e1!3m5!1stest",
  });

  harness.dispatchHudUpdate({
    time: "09:47",
    speedKmh: 87,
    gear: 4,
    rpm: 3150,
    fuelPercent: 12,
    engineWarning: true,
  });

  assert.equal(harness.document.getElementById("dalnoboyshiki2-hud-time").attributes["data-value"], "09:47");
  assert.equal(harness.document.getElementById("dalnoboyshiki2-hud-speed").attributes["data-value"], "87");
  assert.equal(harness.document.getElementById("dalnoboyshiki2-hud-gear").attributes["data-value"], "4");
  assert.equal(harness.document.getElementById("dalnoboyshiki2-hud-rpm").attributes["data-value"], "32");

  const hud = harness.document.getElementById("dalnoboyshiki2-hud");
  assert.equal(hud.style.properties["--dalnoboyshiki2-fuel-level"], "12%");
  assert.equal(hud.attributes["data-fuel-warning"], "true");
  assert.equal(hud.attributes["data-engine-warning"], "true");
  for (let index = 1; index <= 4; index += 1) {
    assert.equal(
      harness.document.getElementById(`dalnoboyshiki2-fuel-bar-${index}`)
        .attributes["data-active"],
      "false",
    );
  }
  const lastFuelBar = harness.document.getElementById(
    "dalnoboyshiki2-fuel-bar-5",
  );
  assert.equal(lastFuelBar.attributes["data-active"], "true");
  assert.equal(lastFuelBar.attributes["data-low"], "true");

  harness.dispatchHudUpdate({ fuelPercent: 55 });
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(
      (index) =>
        harness.document.getElementById(`dalnoboyshiki2-fuel-bar-${index}`)
          .attributes["data-active"],
    ),
    ["false", "false", "true", "true", "true"],
  );
  assert.equal(lastFuelBar.attributes["data-low"], "false");

  harness.document.getElementById("dalnoboyshiki2-refuel").click();
  assert.equal(hud.style.properties["--dalnoboyshiki2-fuel-level"], "100%");
  assert.equal(lastFuelBar.attributes["data-low"], "false");
  for (let index = 1; index <= 5; index += 1) {
    assert.equal(
      harness.document.getElementById(`dalnoboyshiki2-fuel-bar-${index}`)
        .attributes["data-active"],
      "true",
    );
  }
  assert.equal(overlayCount(harness), 1);
});

test("renders dynamic values as continuous postal-style SVG glyphs", () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@59.9,30.3,3a,75y/data=!3m7!1e1!3m5!1stest",
  });

  const speed = harness.document.getElementById("dalnoboyshiki2-hud-speed");
  const zero = speed.children[0];
  const glyph = zero.children[0];

  assert.equal(zero.attributes["data-digit"], "0");
  assert.equal(glyph.tagName, "svg");
  assert.equal(glyph.children.length, 1);
  assert.equal(glyph.children[0].tagName, "path");
  assert.equal(glyph.children[0].attributes.d, "M4 1H10L13 4V20L10 23H4L1 20V4Z");
});

test("replaces the Google Street View card with the game pager", async () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@48.57,19.12,3a,75y/data=!3m7!1e1!3m5!1stest",
    streetViewInfo: {
      title: "Dobronivská cesta",
      subtitle: "Зволен, Банскобистрицкий край",
    },
  });

  const pager = harness.document.getElementById("dalnoboyshiki2-pager");
  assert.equal(
    harness.infoCard.attributes[
      "data-dalnoboyshiki2-hidden-streetview-card"
    ],
    "true",
  );
  assert.equal(pager.hidden, false);
  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-pager-message").textContent,
    "Dobronivská cesta — Зволен, Банскобистрицкий край",
  );

  harness.setHref("https://www.google.com/maps/place/Zvolen");
  await harness.tick();
  assert.equal(
    harness.infoCard.attributes[
      "data-dalnoboyshiki2-hidden-streetview-card"
    ],
    undefined,
  );
});

test("moves the original Google minimap above the cabin and restores it", async () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@48.57,19.12,3a,75y/data=!3m7!1e1!3m5!1stest",
    withMinimap: true,
  });
  const slot = harness.document.getElementById("dalnoboyshiki2-minimap-slot");

  assert.equal(slot.hidden, false);
  assert.equal(harness.minimapParent.parentNode, slot);
  assert.equal(harness.minimapContainer.parentNode, harness.minimapParent);
  assert.match(harness.minimapParent.className, /\bs7CGkb\b/);
  assert.equal(
    harness.minimapParent.attributes[
      "data-dalnoboyshiki2-google-minimap"
    ],
    "true",
  );

  harness.setHref("https://www.google.com/maps/place/Zvolen");
  await harness.tick();
  assert.equal(harness.minimapContainer.parentNode, harness.minimapParent);
  assert.equal(harness.minimapParent.parentNode, harness.minimapOriginalParent);
  assert.equal(
    harness.minimapParent.attributes[
      "data-dalnoboyshiki2-google-minimap"
    ],
    undefined,
  );
});

test("shows one speeding ticket after crossing 100 km/h", async () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@59.9,30.3,3a,75y/data=!3m7!1e1!3m5!1stest",
  });
  const notice = harness.document.getElementById(
    "dalnoboyshiki2-speeding-notice",
  );

  assert.equal(notice.hidden, true);

  harness.dispatchHudUpdate({ speedKmh: 100 });
  assert.equal(notice.hidden, true);

  harness.dispatchHudUpdate({ speedKmh: 101 });
  assert.equal(notice.hidden, false);

  await harness.tick(5_000);
  assert.equal(notice.hidden, true);

  harness.dispatchHudUpdate({ speedKmh: 110 });
  assert.equal(notice.hidden, true);

  harness.dispatchHudUpdate({ speedKmh: 95 });
  harness.dispatchHudUpdate({ speedKmh: 101 });
  assert.equal(notice.hidden, false);
});

test("loads the YouTube playlist only after opening and stops it on close", () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@59.9,30.3,3a,75y/data=!3m7!1e1!3m5!1stest",
  });

  const music = harness.document.getElementById("dalnoboyshiki2-music");
  const toggle = harness.document.getElementById("dalnoboyshiki2-music-toggle");
  const panel = harness.document.getElementById("dalnoboyshiki2-music-panel");
  const frame = harness.document.getElementById("dalnoboyshiki2-music-frame");
  const close = harness.document.getElementById("dalnoboyshiki2-music-close");

  assert.equal(music.attributes["data-open"], "false");
  assert.equal(toggle.attributes["aria-expanded"], "false");
  assert.equal(panel.hidden, true);
  assert.equal(frame.attributes.src, undefined);

  toggle.click();
  assert.equal(music.attributes["data-open"], "true");
  assert.equal(toggle.attributes["aria-expanded"], "true");
  assert.equal(panel.hidden, false);
  assert.match(frame.attributes.src, /youtube\.com\/embed\/x2vnaAdm-Rg/);
  assert.match(frame.attributes.src, /PL50DEA6B792AFF6BE/);

  close.click();
  assert.equal(music.attributes["data-open"], "false");
  assert.equal(toggle.attributes["aria-expanded"], "false");
  assert.equal(panel.hidden, true);
  assert.equal(frame.attributes.src, undefined);
  assert.equal(toggle.focused, true);
});

test("tracks elapsed time, movement distance and speed from Street View coordinates", async () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@59.90000,30.30000,3a,75y/data=!3m7!1e1!3m5!1stest",
  });

  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-hud-time").attributes[
      "data-value"
    ],
    "00:00",
  );
  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-hud-speed").attributes[
      "data-value"
    ],
    "0",
  );

  await harness.tick(1_000);
  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-hud-time").attributes[
      "data-value"
    ],
    "00:01",
  );

  harness.setHref(
    "https://www.google.com/maps/@59.90005,30.30000,3a,75y/data=!3m7!1e1!3m5!1stest",
  );
  await harness.tick(500);

  const speed = Number(
    harness.document.getElementById("dalnoboyshiki2-hud-speed").attributes[
      "data-value"
    ],
  );
  assert.ok(speed > 0);
  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-hud-moves").textContent,
    "ХОДЫ 1",
  );
  assert.match(
    harness.document.getElementById("dalnoboyshiki2-hud-distance").textContent,
    /^[1-9]\d* м$/,
  );
  const overlay = harness.document.getElementById("dalnoboyshiki2-overlay");
  const remainingFuel = Number(
    overlay.attributes["data-fuel-remaining-liters"],
  );
  assert.ok(remainingFuel < 500 && remainingFuel > 499);
  assert.ok(
    harness.storageValues["dalnoboyshiki2-fuel-by-truck"].classic < 500,
  );

  harness.document.getElementById("dalnoboyshiki2-refuel").click();
  assert.equal(overlay.attributes["data-fuel-remaining-liters"], "500.000");
  assert.equal(
    harness.storageValues["dalnoboyshiki2-fuel-by-truck"].classic,
    500,
  );

  await harness.tick(2_000);
  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-hud-speed").attributes[
      "data-value"
    ],
    "0",
  );
});

test("ignores long coordinate jumps as relocations", async () => {
  const harness = createHarness({
    href: "https://www.google.com/maps/@59.90000,30.30000,3a,75y/data=!3m7!1e1!3m5!1stest",
  });

  harness.setHref(
    "https://www.google.com/maps/@60.90000,31.30000,3a,75y/data=!3m7!1e1!3m5!1stest",
  );
  await harness.tick(500);

  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-hud-moves").textContent,
    "ХОДЫ 0",
  );
  assert.equal(
    harness.document.getElementById("dalnoboyshiki2-hud-distance").textContent,
    "0 м",
  );
});
