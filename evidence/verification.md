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
