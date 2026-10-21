# Project rules

## Source requirements

This project implements slide 32 of Lab 02: a Vietnam Mega-Sale with a deadline-based countdown, finite inventory reservations, reservation expiry, checkout, and an AI failure audit. Slides 2, 3, 5, and 29 apply as shared engineering rules.

## Engineering constraints

- Keep the implementation in small modules. Specify TypeScript contracts before implementing behavior.
- Use React, strict TypeScript, Vite, and plain CSS. Use semantic HTML and React's event system; never use raw HTML injection or inline HTML event attributes.
- Do not use `var`, `setInterval`, or a decrementing timer counter. Derive time from an absolute deadline and `Date.now()` through requestAnimationFrame.
- Put the one-product sale configuration in one easy-to-find module.
- Treat the in-memory inventory service as the authority for availability, reservation, expiry, and checkout. Mutations must be synchronous once admitted to the service's critical section.
- Keep stable operation IDs, reject stale UI responses, and use inventory versions to ignore out-of-order snapshots.
- Check sale and reservation deadlines at the service boundary. UI countdown values are presentation only.
- Preserve `available + reserved + sold = initialStock`; each count must remain non-negative.
- Clean up animation frames, DOM listeners, and reservation timers. Keep the service stable across React StrictMode effect replay.
- Do not add backend, database, authentication, real payment, multi-item cart, cross-tab sync, or deployment.
- Add tests only for the requested verification matrix. Record only results that were actually run.
- Keep `node_modules`, `dist`, and secrets out of Git.

## Demo configuration

One product, VND price, initial stock 5, one unit per reservation, sale duration 120 seconds, and reservation duration 15 seconds. The sale begins when the in-memory service is initialized in the browser.

## Delivery checks

Before push: run strict typecheck, relevant deterministic timer/state/service tests, a production build, and a browser purchase/checkout/expiry walkthrough. Create at least eight meaningful Conventional Commits and push the complete `main` branch to the public GitHub repository.
