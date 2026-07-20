const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const contentScript = readFileSync(join(__dirname, "..", "content.js"), "utf8");

function createHarness({ href, sceneVisible = false }) {
  let intervalCallback;
  let currentTime = 0;
  const listeners = new Map();

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
      child.parentNode = this;
      this.children.push(child);
      return child;
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
      return selector === ".widget-scene" && scene.visible ? [scene] : [];
    },
  };

  const window = {
    location: { href },
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
    Date: { now: () => currentTime },
    HTMLElement: FakeHTMLElement,
    MutationObserver: FakeMutationObserver,
    Number,
    URL,
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
      },
    },
    document,
    setTimeout,
    window,
  });

  vm.runInContext(contentScript, context);

  return {
    body,
    document,
    scene,
    dispatchHudUpdate(detail) {
      for (const callback of listeners.get("dalnoboyshiki2:hud-update") ?? []) {
        callback({ detail });
      }
    },
    setHref(nextHref) {
      window.location.href = nextHref;
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
  assert.equal(overlay.children.length, 3);
  assert.equal(overlay.children[0].tagName, "div");
  assert.equal(overlay.children[1].tagName, "img");
  assert.equal(overlay.children[2].tagName, "section");

  await harness.tick();
  assert.equal(overlayCount(harness), 1);
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
