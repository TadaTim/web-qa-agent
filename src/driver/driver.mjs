// Driver factory + shared base. Both drivers expose the same interface:
//   goto(url) | snapshot() | act(spec, action) | waitForQuiescence(ms)
//   screenshot(path) -> bool | currentUrl() | close()
// Navigation is restricted to the app origin: goto() to any other origin
// throws OriginBlockedError before any network activity.
import { HELPERS_SOURCE } from "./page-helpers.mjs";

export class OriginBlockedError extends Error {
  constructor(url, origin) {
    super(`Navigation to ${url} blocked: outside app origin ${origin}`);
    this.name = "OriginBlockedError";
    this.code = "ORIGIN_BLOCKED";
  }
}

export class DriverEnvironmentError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "DriverEnvironmentError";
    this.code = "ENVIRONMENT";
    if (cause) this.cause = cause;
  }
}

function signatureOf(snap) {
  return JSON.stringify([snap.hash, snap.elements.map((e) => [e.testId, e.role, e.name, e.text, e.visible])]);
}

export class BaseDriver {
  constructor(origin) {
    this.origin = origin;
    this.kind = "base";
    this.supportsScreenshots = false;
  }
  assertOrigin(url) {
    const u = new URL(url);
    if (u.origin !== this.origin) throw new OriginBlockedError(url, this.origin);
  }
  async _rawSnapshot() { throw new Error("not implemented"); }
  async snapshot() {
    const snap = await this._rawSnapshot();
    // Never leak helper internals; ensure plain serializable shape.
    return {
      url: snap.url, hash: snap.hash, title: snap.title,
      elements: snap.elements, pageText: snap.pageText, hiddenText: snap.hiddenText,
    };
  }
  // Poll until the DOM signature is stable across 3 consecutive polls.
  async waitForQuiescence(timeoutMs = 5000) {
    const start = Date.now();
    let last = null;
    let stable = 0;
    while (Date.now() - start < timeoutMs) {
      const snap = await this._rawSnapshot();
      const sig = signatureOf(snap);
      if (sig === last) {
        stable += 1;
        if (stable >= 3) return { quiesced: true, waitedMs: Date.now() - start };
      } else {
        stable = 0;
        last = sig;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    return { quiesced: false, waitedMs: Date.now() - start };
  }
}

export class PlaywrightDriver extends BaseDriver {
  constructor(origin) {
    super(origin);
    this.kind = "playwright";
    this.supportsScreenshots = true;
  }
  async init() {
    let chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch (e) {
      throw new DriverEnvironmentError("playwright package not available", e);
    }
    try {
      this.browser = await chromium.launch();
    } catch (e) {
      throw new DriverEnvironmentError(`chromium launch failed: ${String(e.message || e).split("\n")[0]}`, e);
    }
    this.context = await this.browser.newContext();
    await this.context.addInitScript(HELPERS_SOURCE);
    this.page = await this.context.newPage();
    return this;
  }
  async goto(url) {
    this.assertOrigin(url);
    try {
      await this.page.goto(url, { waitUntil: "load", timeout: 15000 });
    } catch (e) {
      throw new DriverEnvironmentError(`navigation failed: ${e.message}`, e);
    }
    await this.waitForQuiescence();
  }
  async _rawSnapshot() {
    return this.page.evaluate(() => window.__qaHelpers.snapshot());
  }
  async act(spec, action) {
    return this.page.evaluate(
      ([s, a]) => window.__qaHelpers.act(s, a),
      [spec, action]
    );
  }
  async screenshot(path) {
    await this.page.screenshot({ path });
    return true;
  }
  async currentUrl() { return this.page.url(); }
  async close() {
    try { await this.browser.close(); } catch { /* already closed */ }
  }
}

export class DomDriver extends BaseDriver {
  constructor(origin) {
    super(origin);
    this.kind = "dom";
    this.supportsScreenshots = false;
  }
  async init() {
    let JSDOM, CookieJar;
    try {
      ({ JSDOM, CookieJar } = await import("jsdom"));
    } catch (e) {
      throw new DriverEnvironmentError("jsdom package not available", e);
    }
    this._JSDOM = JSDOM;
    this._cookieJar = new CookieJar();
    return this;
  }
  async goto(url) {
    this.assertOrigin(url);
    const origin = this.origin;
    let dom;
    try {
      dom = await this._JSDOM.fromURL(url, {
        resources: "usable",
        runScripts: "dangerously",
        pretendToBeVisual: true,
        cookieJar: this._cookieJar,
        beforeParse(window) {
          // jsdom has no fetch: polyfill it against the real app origin so
          // the SPA's API calls hit the actual server over HTTP.
          window.fetch = (input, init) => {
            const target = new URL(String(input), origin);
            if (target.origin !== origin) {
              return Promise.reject(new Error(`fetch to ${target.origin} blocked`));
            }
            return fetch(target.href, init);
          };
        },
      });
    } catch (e) {
      throw new DriverEnvironmentError(`jsdom load failed: ${e.message}`, e);
    }
    this.dom = dom;
    await new Promise((resolve) => {
      if (dom.window.document.readyState === "complete") return resolve();
      dom.window.addEventListener("load", () => resolve());
      setTimeout(resolve, 5000);
    });
    dom.window.eval(HELPERS_SOURCE);
    await this.waitForQuiescence();
  }
  async _rawSnapshot() {
    return this.dom.window.__qaHelpers.snapshot();
  }
  async act(spec, action) {
    return this.dom.window.__qaHelpers.act(spec, action);
  }
  async screenshot() { return false; } // DOM driver cannot capture pixels.
  async currentUrl() { return this.dom.window.location.href; }
  async close() {
    try { this.dom.window.close(); } catch { /* noop */ }
  }
}

// kind: "playwright" (default) or "dom". QA_DRIVER env var also honored.
export async function createDriver({ kind, origin } = {}) {
  const chosen = kind || process.env.QA_DRIVER || "playwright";
  const driver = chosen === "dom" ? new DomDriver(origin) : new PlaywrightDriver(origin);
  await driver.init();
  return driver;
}
