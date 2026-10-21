# HW3 task decomposition

## Stage 1 — Functional slices

- [x] S1: Read slide 32 and the common rules from slides 2, 3, 5, and 29.
- [x] S2: Specify contracts and module boundaries before implementation.
- [x] S3: Implement the anti-drift deadline timer and deterministic clock tests.
- [x] S4: Implement the sale state machine and transition tests.
- [x] S5: Implement shared atomic inventory reservation and concurrency tests.
- [x] S6: Implement exactly-once expiry and release behavior.
- [x] S7: Implement idempotent checkout and boundary/race tests.
- [x] S8: Connect the state machine and service to accessible React UI.
- [x] S9: Run typecheck, tests, build, browser walkthrough, and capture concise evidence.
- [x] S10: Write the evidence-based AI failure audit and README.
- [x] S11: Push `main` and record the public repository result.

## Stage 2 — Type contract (approved before behavior code)

The first implementation contract is in `src/domain/contracts.ts`. It fixes the state tags, event payloads, inventory snapshot/version, reservation fields/status, service methods, and deterministic timer runtime. Keep implementations aligned with that contract; change it first when a requirement forces a new boundary.

## Stage 3 — Atomic implementation plan

1. `src/timer/deadlineTimer.ts`
2. `src/domain/saleMachine.ts`
3. `src/domain/inventoryService.ts`
4. `src/hooks/useSaleController.ts` and presentation components
5. `src/App.tsx` and `src/index.css`

One module or closely coupled behavior group per commit. Avoid single-shot implementation across the whole application.

## Stage 4 — Independent verification

- Fake-clock tests: deadline jumps, long frame gaps, no negative values, RAF/listener cleanup.
- Transition tests: valid paths and stale request/attempt IDs.
- Service tests: 100 concurrent requests with stock 5; invariant and non-negative counts; expiry exactly once; checkout before/at/after deadline; duplicate clicks; checkout-expiry ordering; expired-sale reservation policy.
- Build checks: `npm run typecheck`, `npm test`, and `npm run build`.
- Browser: purchase, hold countdown, checkout, and expiry; inspect visible stock, messages, and disabled states.
- Audit: only record defects found in generated code, with test/command or commit evidence and a rerun after repair.

## Delayed reservation response repair — 2026-10-21

- [x] Define `RESERVE_EXPIRED` with request ID, reservation ID, expiry and message before changing behavior. Only the matching `reserving` request may accept this response.
- [x] Add reducer and StrictMode UI regression tests for an expired response, retry, stale response after a newer request, and response after unmount.
- [x] Route an already-expired reserve response to the matching expired state without changing the inventory service.
- [x] Run typecheck, all 25 tests, lint, build, and the reproducible Chrome delayed-response walkthrough; save JSON/screenshot evidence and update the failure audit.
- [x] Commit the repair with Conventional Commits and push `main`: `643e5e6 fix(state): recover expired reservation responses`; the remote `main` SHA matched the local commit after push.

## Independent acceptance review — 2026-10-21

- [x] Re-read `project-rules.md`, this WBS, `README.md`, `AI_FAILURE_AUDIT.md`, `evidence/verification.md`, and slide 32 from both the Lab 2 PDF page and extracted Markdown. Rechecked the shared standards on slides 2, 3, 5, and 29.
- [x] Independently inspect service, reducer, timer, hook, and UI behavior against inventory, deadline, stale-response, checkout-race, and lifecycle requirements; record each result in `evidence/acceptance-matrix.md`.
- [x] Extend deterministic coverage for sale-end and reservation-expiry boundaries, checkout-winning expiry race, and reserve/checkout success and rejection responses after unmount. No sale logic defect was found in this pass.
- [x] Production preview browser: verify standard checkout and expiry/retry using the real app bundle and in-memory service, with a controlled browser clock and no service injection.
- [x] Dev browser: repeat the 16-second delayed reservation response using the real in-memory service wrapped at the module boundary. Report separately from production-preview results.
- [x] Fix the production preview's observed `/favicon.ico` 404 with a local SVG favicon; rerun browser checks and confirm there are no page/console errors or failed HTTP responses.
- [x] Run `npm run typecheck`, all tests (30 passed), `npm run lint`, `npm run build`, `npm run verify:browser`, and `npm run verify:production-browser`.
- [x] Save current JSON and screenshot evidence; verify `dist` contains no test instrumentation. No additional AI-generated failure was confirmed, so the audit adds no new failure entry.
