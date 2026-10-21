# HW3 verification record

Verification performed on 2026-10-21 in the local checkout. Commands below ran from the repository root.

## Automated checks

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | Exit 0 (`tsc -b`) |
| `npm test` | Exit 0; 4 test files, 20 tests passed |
| `npm run lint` | Exit 0; oxlint reported no warnings or errors after fixes |
| `npm run build` | Exit 0; TypeScript project build and Vite 8.3.5 production build completed |

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
