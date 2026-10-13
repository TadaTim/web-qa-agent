# Broken mutation fixture

A copy of `app/` with exactly one behavior removed: **the expired-card
error path**.

- `server.mjs`: the expiry-date comparison in `cardError()` is deleted
  (marked with a `FIXTURE MUTATION` comment). Card-number and CVC checks
  remain.
- `public/app.js`: `clientCardError()` always returns `null` (marked with a
  `FIXTURE MUTATION` comment).

Net effect: checking out with an expired card now succeeds and lands on the
order-confirmation view instead of showing "Your card has expired."

Expected replay outcome: the compiled `checkout-expired` test fails, and
the failure must classify as **PRODUCT BUG**. All other compiled tests
should still pass.
