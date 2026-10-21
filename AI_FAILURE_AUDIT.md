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

## Scope note

The last two entries were mistakes in generated test assumptions, not defects in the service. They are retained because they produced concrete failing evidence and initially obscured correct expiry behavior. The source and test suite avoid raw HTML injection, `var`, `setInterval`, and unstable React list keys.
