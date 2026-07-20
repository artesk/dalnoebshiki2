const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const contentScript = readFileSync(join(__dirname, "..", "content.js"), "utf8");

function createHarness({ href, sceneVisible = false }) {
  let intervalCallback;
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
    async tick() {
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
  assert.equal(overlay.children.length, 2);
  assert.equal(overlay.children[0].tagName, "div");
  assert.equal(overlay.children[1].tagName, "img");

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
