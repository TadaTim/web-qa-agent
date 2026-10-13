# Cosmetic mutation fixture

A copy of `app/` with **presentation-only** changes. Behavior, text content,
`data-testid` attributes, and API semantics are identical to the base app.

Changes applied:
- Every CSS class renamed (e.g. `site-header` → `top-bar`, `product-card` →
  `item-tile`, `visually-hidden` → `sr-only-clip`) across HTML, CSS, and JS
  templates.
- Extra wrapper elements: `<div class="shell-outer"><div class="shell-inner">`
  around the page in `index.html`; product cards gained `.tile-body` and
  `.tile-actions` wrapper divs.
- Product card element changed from `<article>` to `<div>` (recorded CSS
  paths and tag structure therefore differ from the base app).

Expected replay outcome: compiled tests still pass (locators ground via
test-id / role+name strategies), or — if a locator ever fails purely from
drift — the failure must classify as **TEST ROT**, never PRODUCT BUG.
