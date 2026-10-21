# AI Failure Audit

Audit of defects found in AI-generated implementation and verification work for HW3. Each entry records an observed failure, its correction, and a rerun; test-design mistakes are identified as test mistakes rather than product defects.

## 1. Observer exception reported a committed reservation as failed

- **Biểu hiện:** A subscriber throwing during inventory notification caused `reserve()` to reject even though the service had already moved one unit from available to reserved. A caller could interpret the rejection as a failed hold and make another request.
- **Nguyên nhân:** The first generated `writeSnapshot()` called each listener without an exception boundary, after committing the snapshot.
- **Bằng chứng:** The regression test `keeps observer failures from turning a committed reservation into a rejected request` first failed with `promise rejected "Error: observer render failed" instead of resolving`; the stack pointed to `writeSnapshot()` after `reserve()` had updated the ledger.
- **Cách sửa:** Catch subscriber exceptions around each notification so observers cannot change the result of a committed inventory operation. The service remains authoritative and later observers still receive the update.
- **Kiểm chứng lại:** The same test passes. `npm run test -- src/domain/inventoryService.test.ts` then passed all 10 service tests; final `npm test` passed all 20 tests.

## 2. Product heading had a run-together accessible name

- **Biểu hiện:** The visible heading had a line break, but the generated accessible name became `Săn deal chớp nhoáng.Giữ hàng kịp lúc.` with no separator. Screen-reader output would run the phrases together.
- **Nguyên nhân:** The generated JSX assumed `<br />` would create whitespace in the accessible name.
- **Bằng chứng:** The component test queried the intended name with a space and failed. Testing Library's accessibility tree showed the concatenated name without the space.
- **Cách sửa:** Add an explicit accessible label to the heading while retaining the visual line break.
- **Kiểm chứng lại:** The heading query passes in `src/App.test.tsx`; final component tests and the browser accessibility tree report `Săn deal chớp nhoáng. Giữ hàng kịp lúc.`.

## 3. Fake-clock sale-end test forgot the shorter reservation deadline

- **Biểu hiện:** A test expected only the reservation mutation version after jumping the fake clock to the 120-second sale deadline. The actual version list was `[1, 2]`.
- **Nguyên nhân:** The generated test considered sale expiry but overlooked that its reservation deadline is only 15 seconds. Advancing directly to 120 seconds correctly triggered reservation expiry first.
- **Bằng chứng:** Vitest reported `expected [1, 2] to deeply equal [1]` in the sale-deadline test.
- **Cách sửa:** Update the test to assert that the held unit has expired and returned to stock by the time the clock reaches the sale deadline.
- **Kiểm chứng lại:** The test now asserts versions `[1, 2]` and inventory `available: 5, reserved: 0, sold: 0`; the service suite passes.

## 4. Stale-callback test accidentally expired both reservations

- **Biểu hiện:** A test expecting the newer reservation to remain active instead observed available 5 and reserved 0.
- **Nguyên nhân:** The generated fake-clock fixture created the old and new reservations at the same mock time. Both therefore had the same `expiresAt`; when the test advanced to the old deadline, the new reservation was legitimately due too.
- **Bằng chứng:** Vitest reported the actual `{ available: 5, reserved: 0 }` against the expected `{ available: 4, reserved: 1 }` in `ignores an old callback after release and a newer reservation`.
- **Cách sửa:** Create the newer reservation at mock time 2,000 ms, after releasing the old one at 1,000 ms. Its 17,000 ms expiry is later than the old reservation's 16,000 ms expiry.
- **Kiểm chứng lại:** Invoking the old callback at 16,000 ms leaves the newer reservation active and does not increment the inventory version; the service suite passes.

## 5. Expired reserve response left the UI stuck in `reserving`

- **Biểu hiện:** A reservation was committed with a 15-second hold, but its successful response was delivered after 16 seconds. Inventory correctly returned to available 5 / reserved 0 / sold 0 while the UI kept showing `Đang giữ hàng…` and disabled the buy button indefinitely.
- **Nguyên nhân:** `useSaleController` dispatched `RESERVATION_EXPIRED` before the reserve response had been confirmed. That reducer branch only accepts a matching reservation already in `reserved`, `checkingOut`, or an error state, so it ignored the event while still `reserving`.
- **Bằng chứng trước sửa:** The independent browser review reproduced the stuck state. Before changing runtime behavior, the new component test `recovers from a response delayed beyond the hold deadline and can buy again in StrictMode` failed to find the expiry message; its DOM output still showed `Đang gửi yêu cầu giữ 1 sản phẩm…`, stock 5/0/0 and a disabled buy button.
- **Cách sửa:** Add the contract-first `RESERVE_EXPIRED` event carrying the reserve request ID. The reducer accepts it only for the current `reserving` request and transitions directly to `expired`. The hook keeps using the service's idempotent expiry operation and versioned snapshots, so expiry does not return stock twice.
- **Kiểm chứng lại:** All 25 tests pass, including two new reducer cases and three new StrictMode component cases for expiry/retry, an old expired response after a newer reservation, and a response after unmount. `npm run verify:browser` passes in Chrome 155.0.8059.85 with a 16-second delayed response: stock 5/0/0 and buy enabled after expiry, 4/1/0 after retry, then 4/0/1 after checkout; an old expiry leaves the newer reservation unchanged. Evidence: [`evidence/delayed-reservation-browser.json`](evidence/delayed-reservation-browser.json) and [`evidence/delayed-reservation-recovered.png`](evidence/delayed-reservation-recovered.png).

## Scope note

Entries 3 and 4 were mistakes in generated test assumptions, not defects in the service. They are retained because they produced concrete failing evidence and initially obscured correct expiry behavior. The source and test suite avoid raw HTML injection, `var`, `setInterval`, and unstable React list keys.

## Independent review follow-up — 2026-10-21

The review at `7f313b6` rechecked the listed defects and their regression evidence. It found no additional confirmed AI-generated failure. The production-preview check did expose a separate missing-icon 404 at `/favicon.ico`; adding `public/favicon.svg` removed the console error on rerun. This asset omission is documented as a browser-check finding, not counted as an AI failure because this review did not establish that it came from AI-generated flawed logic. The expanded suite now passes all 30 tests; production-preview and delayed-response browser results are recorded in `evidence/verification.md` and `evidence/acceptance-matrix.md`.
