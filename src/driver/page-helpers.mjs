// In-page helpers installed identically into both drivers (real Chromium via
// Playwright, or jsdom for the DOM fallback driver). The function below is
// stringified and evaluated inside the page, so it must be fully
// self-contained: no imports, no closure over module scope.
//
// It exposes window.__qaHelpers with:
//   snapshot()       -> serializable page state (interactive elements + text)
//   ground(spec)     -> multi-strategy element lookup with diagnostics
//   act(spec, action)-> ground + perform (click / fill), returns diagnostics
export function installQaHelpers() {
  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "submit" || t === "button") return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    return tag;
  }

  function nameOf(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return norm(aria);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      if (el.id) {
        const lab = document.querySelector('label[for="' + el.id + '"]');
        if (lab) return norm(lab.textContent);
      }
      let p = el.parentElement;
      while (p) {
        if (p.tagName === "LABEL") return norm(p.textContent);
        p = p.parentElement;
      }
      return norm(el.getAttribute("placeholder") || el.getAttribute("name") || "");
    }
    return norm(el.innerText || el.textContent || el.value || "");
  }

  function isVisible(el) {
    let node = el;
    while (node && node !== document.body) {
      const cs = window.getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && node.tagName) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (Array.prototype.indexOf.call(same, node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  const INTERACTIVE = "a[href], button, input, select, textarea, [role='button'], [data-testid]";

  function describe(el, i) {
    return {
      i: i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || null,
      role: roleOf(el),
      name: nameOf(el),
      text: norm(el.innerText || el.textContent || "").slice(0, 120),
      testId: el.getAttribute("data-testid") || null,
      id: el.id || null,
      placeholder: el.getAttribute("placeholder") || null,
      ariaHidden: el.getAttribute("aria-hidden") === "true",
      visible: isVisible(el),
      disabled: !!el.disabled,
      css: cssPath(el),
    };
  }

  function allInteractive() {
    return Array.prototype.slice.call(document.querySelectorAll(INTERACTIVE));
  }

  function snapshot() {
    const elements = allInteractive().map(describe);
    const hiddenBits = Array.prototype.map.call(
      document.querySelectorAll('[aria-hidden="true"], .visually-hidden'),
      (el) => norm(el.textContent)
    ).filter(Boolean);
    return {
      url: location.href,
      hash: location.hash,
      title: document.title,
      elements: elements,
      pageText: norm(document.body ? document.body.innerText || document.body.textContent : "").slice(0, 4000),
      hiddenText: hiddenBits.join(" ").slice(0, 2000),
    };
  }

  // Multi-strategy grounding. Returns {found, strategy, count, descriptor}
  // and remembers the resolved element for actuation via a WeakRef-free
  // approach: act() re-grounds immediately before acting.
  function ground(spec) {
    const els = allInteractive();
    const strategies = [];
    function attempt(name, matches) {
      const vis = matches.filter((el) => isVisible(el) && !el.disabled);
      strategies.push({ strategy: name, candidates: matches.length, usable: vis.length });
      return vis;
    }
    if (spec.testId) {
      const m = els.filter((el) => el.getAttribute("data-testid") === spec.testId);
      const usable = attempt("testid", m);
      if (usable.length === 1) return finish(usable[0], "testid", strategies);
      if (usable.length > 1) return { found: false, ambiguous: true, strategies: strategies };
    }
    if (spec.role && spec.name) {
      const target = norm(spec.name).toLowerCase();
      const m = els.filter((el) => roleOf(el) === spec.role && nameOf(el).toLowerCase() === target);
      const usable = attempt("role+name", m);
      if (usable.length === 1) return finish(usable[0], "role+name", strategies);
      if (usable.length > 1) return { found: false, ambiguous: true, strategies: strategies };
    }
    if (spec.text) {
      const target = norm(spec.text);
      const m = els.filter((el) => norm(el.innerText || el.textContent || "") === target);
      const usable = attempt("text", m);
      if (usable.length === 1) return finish(usable[0], "text", strategies);
      if (usable.length > 1) return { found: false, ambiguous: true, strategies: strategies };
    }
    if (spec.css) {
      let m = [];
      try { m = Array.prototype.slice.call(document.querySelectorAll(spec.css)); } catch (e) { m = []; }
      const usable = attempt("css", m);
      if (usable.length >= 1) return finish(usable[0], "css", strategies);
    }
    return { found: false, ambiguous: false, strategies: strategies };
  }

  function finish(el, strategy, strategies) {
    const all = allInteractive();
    return {
      found: true,
      strategy: strategy,
      strategies: strategies,
      descriptor: describe(el, all.indexOf(el)),
      _el: el,
    };
  }

  function act(spec, action) {
    const g = ground(spec);
    if (!g.found) return { ok: false, phase: "grounding", ambiguous: !!g.ambiguous, strategies: g.strategies };
    const el = g._el;
    try {
      if (action.kind === "click") {
        el.click();
      } else if (action.kind === "fill") {
        el.focus();
        el.value = action.value;
        el.dispatchEvent(new window.Event("input", { bubbles: true }));
        el.dispatchEvent(new window.Event("change", { bubbles: true }));
      } else {
        return { ok: false, phase: "action", error: "unknown action kind " + action.kind };
      }
    } catch (e) {
      return { ok: false, phase: "action", error: String(e && e.message || e), strategies: g.strategies };
    }
    return { ok: true, strategy: g.strategy, strategies: g.strategies, descriptor: g.descriptor };
  }

  window.__qaHelpers = { snapshot: snapshot, ground: ground, act: act };
}
export const HELPERS_SOURCE = "(" + installQaHelpers.toString() + ")();";
