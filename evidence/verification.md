# HW3 verification record

Verification performed on 2026-10-21 in the local checkout. Commands below ran from the repository root.

## Automated checks

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | Exit 0 (`tsc -b`) |
| `npm test` | Exit 0; 4 test files, 25 tests passed |
| `npm run lint` | Exit 0; oxlint reported no warnings or errors after fixes |
| `npm run build` | Exit 0; TypeScript project build and Vite 8.3.5 production build completed |
| `npm run verify:browser` | Exit 0; Chrome delayed-response regression, expiry/retry/checkout and unchanged newer reservation passed |

The inventory test submits 100 distinct reservation requests concurrently to one service with stock 5: exactly 5 succeed, available is 0, reserved is 5, sold is 0, and the invariant holds. Other service tests cover duplicate reservation IDs, sale-end rejection, deadline jumps, exactly-once expiry, stale callbacks, checkout just before/at expiry, repeated checkout, checkout after sale close, and the checkout/expiry race. Timer tests cover skipped frames, visibility refresh, non-negative values, and RAF/listener cleanup. Reducer tests cover stale request and attempt IDs. UI tests cover StrictMode, checkout, background-resume expiry, and unmount cleanup.

## Browser preview walkthrough

Reproduction command:

```bash
npm run preview -- --host 127.0.0.1
```

The production preview was opened at `http://127.0.0.1:4174/` because port 4173 was already occupied. Browser observations:

1. Initial page: available 5, reserved 0, sold 0; sale countdown started just under 120 seconds.
2. Click **Mua ngay**: available 4, reserved 1, sold 0; hold countdown appeared near 15 seconds and **Thanh toán** became available.
3. Click **Thanh toán**: available 4, reserved 0, sold 1; the page showed **Đặt hàng thành công**.
4. Reload to start a fresh in-memory simulation, click **Mua ngay**, then leave the hold untouched. At expiry the page announced that the hold expired, available returned to 5, reserved and sold were 0, and **Mua ngay** became available again.

The browser checks were against the production preview bundle. No remote deployment was made, per the requested scope.

## Delayed-response regression — 2026-10-21

Before the runtime repair, the new UI regression test failed: the response arrived after the hold deadline, inventory was already 5/0/0, but the UI stayed in `reserving` and did not show the expected expiry message. The repair adds the request-ID-checked `RESERVE_EXPIRED` event and keeps the normal `RESERVATION_EXPIRED` path for previously confirmed holds.

Five new tests cover the matching expired response and retry, rejection of stale expiry responses, StrictMode UI recovery with a controlled 16-second clock jump, a newer reservation surviving an old response after remount, and a late successful response after unmount releasing its hold without restarting UI/RAF work. The original 20 timer/service/reducer/UI tests remain passing.

Reproduce the browser check with `npm run verify:browser` after `npm ci`. It requires installed Google Chrome and free port 5413. The script starts and closes its own Vite server and headless Chrome. It intercepts the test browser's `saleSession.ts` module to wrap the real in-memory service, delays only its first successful reserve response for 16 seconds, and advances the browser clock. The application runs through its normal StrictMode entrypoint. This regression uses the development server so the service can be injected at the module boundary; the production build is checked separately above.

Observed in Chrome 155.0.8059.85 on Windows 10.0.26300, Node v24.15.0:

| Step | UI / ledger result (available / reserved / sold) |
| --- | --- |
| Hold committed, response pending | 4 / 1 / 0; buy disabled while requesting |
| Response arrives after 16 seconds | 5 / 0 / 0; expiry message shown; buy enabled |
| Buy again while sale is open | 4 / 1 / 0; checkout available |
| Repeat expiry of the old reservation | No change; inventory version remains 3 |
| Checkout new reservation | 4 / 0 / 1; success message; version 4 |

No console or page errors occurred. Machine-readable results and the visually inspected recovery screenshot are [`delayed-reservation-browser.json`](delayed-reservation-browser.json) and [`delayed-reservation-recovered.png`](delayed-reservation-recovered.png).

## GitHub delivery

Repository: `https://github.com/24521450/MSIS207.R11.CTTT.Week2.HW3` — GitHub reports `PUBLIC` visibility and `main` as the default branch. `git push -u origin main` succeeded; `git ls-remote origin refs/heads/main` matched the local `main` HEAD. The checkout was clean and tracking `origin/main` at verification.

Delayed-response repair: [`643e5e6 fix(state): recover expired reservation responses`](https://github.com/24521450/MSIS207.R11.CTTT.Week2.HW3/commit/643e5e6b6131489ede31413377a2e84e919b73c5) was pushed to `main`; `git ls-remote origin refs/heads/main` returned the same full SHA as the local repair commit. The repair includes the five regression tests, reproducible browser script, audit, JSON results and recovery screenshot.

## Independent acceptance review — 2026-10-21

The review started from clean `main` at `7f313b6`, matching `origin/main`. It re-read the project rules, WBS, README, AI failure audit, this verification record, the extracted slide 32 Markdown, and the text extracted directly from PDF page 32. Shared rules on slides 2, 3, 5, and 29 were cross-checked as well. The requirement-by-requirement result is in [`acceptance-matrix.md`](acceptance-matrix.md).

### Current automated checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0 (`tsc -b`) |
| `npm test` | Exit 0; 4 files, 30 tests passed |
| `npm run lint` | Exit 0 (`oxlint`) |
| `npm run build` | Exit 0; TypeScript project build and Vite 8.3.5 production build completed |
| `npm run verify:browser` | Exit 0; Chrome delayed-response regression on Vite dev server with service injection |
| `npm run verify:production-browser` | Exit 0; Chrome standard flow on Vite preview serving `dist`, with no service injection |

The expanded deterministic tests check a reservation before, at, and after its expiry; new reservations before, exactly at, and after `saleEndsAt`; active checkout after the sale closes; 100 simultaneous reserve requests with stock 5; request-ID deduplication; exactly-once expiry; idempotent checkout; and both race outcomes. In the expiry-wins ordering, the hold returns to stock and checkout is rejected. In the checkout-wins ordering, checkout at `expiresAt - 1` completes; invoking the old expiry callback leaves sold stock unchanged. Service writes assert the inventory invariant on every snapshot mutation.

UI lifecycle tests use React StrictMode and a controlled clock. They cover a delayed successful reserve after unmount being released, a late reserve rejection, late checkout success, a checkout result rejected because expiry won, and a thrown checkout rejection. Component RAFs are gone after unmount. When checkout is unresolved but the service still owns an active hold, its one expiry timer remains after unmount; advancing to the deadline returns the unit once and clears that service-owned timer. The controller unsubscribe and timer cleanup paths are also exercised. The delayed-response UI test confirms a previous inventory snapshot cannot replace the newer expiry snapshot.

### Production preview browser check

`npm run verify:production-browser` opened the built `dist` bundle through Vite preview in Chrome 155.0.8059.85. It used the normal `saleSession` and `InMemoryInventoryService`; the service was not injected or wrapped. Playwright advanced the browser clock by 16 seconds for hold expiry and dispatched `visibilitychange` to verify the same deadline refresh used when a tab becomes visible.

Observed flows:

1. Initial stock `5/0/0`; click **Mua ngay** → held stock `4/1/0`, checkout enabled and buy disabled; click **Thanh toán** → success and stock `4/0/1`.
2. A fresh page starts at `5/0/0`; click **Mua ngay** → `4/1/0`; advance beyond the 15-second hold → the expiry message appears, stock returns to `5/0/0`, and buy is enabled; buy again → `4/1/0`, then checkout → `4/0/1`.

The production script asserts no delayed-test global is present and records zero page errors, console errors, or failed HTTP responses. Screenshots: [`production-preview-checkout.png`](production-preview-checkout.png) and [`production-preview-expiry.png`](production-preview-expiry.png). Machine results: [`production-preview-browser.json`](production-preview-browser.json).

### Delayed-response dev browser check

`npm run verify:browser` uses Chrome 155.0.8059.85 against the Vite development server. It intercepts the `saleSession.ts` module to wrap the real in-memory service and delay the first successful reserve response by 16 seconds while its TTL is 15 seconds. The app entry remains the normal StrictMode entry; this injection is test-only and absent from `dist`. The browser clock is controlled. Results: the current pending request shows `4/1/0`; after expiry the exact message `Thời gian giữ hàng đã hết trước khi giao diện xác nhận.` appears with `5/0/0` and buy enabled; retry reaches `4/1/0`; repeating expiry of the old ID leaves version 3 unchanged; checkout reaches `4/0/1`. No console or page errors occurred. See [`delayed-reservation-browser.json`](delayed-reservation-browser.json) and [`delayed-reservation-recovered.png`](delayed-reservation-recovered.png).

### Finding fixed during this review

The first production-preview run completed the purchase flows but failed its browser-error assertion: Chrome requested `/favicon.ico`, received 404, and emitted `Failed to load resource`. The preview had no icon link or favicon asset. Added an explicit local SVG favicon in `index.html` and `public/favicon.svg`; after rebuilding, the production check passed with no failed responses and no console/page errors. This was a static-asset issue, not a sale-state or inventory defect, and is not counted as an AI failure in the audit.

Static checks found no `setInterval`, `var`, raw HTML injection, inline HTML event handlers, `Math.random()` IDs, or random/index list keys in TypeScript sources. The built `dist` contains `favicon.svg` and no test-harness/service-injection markers. The UI remains a one-product, one-browser in-memory simulation; no backend or deployment was added.
