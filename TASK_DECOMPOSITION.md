# HW3 task decomposition

## Stage 1 — Functional slices

- [x] S1: Read slide 32 and the common rules from slides 2, 3, 5, and 29.
- [x] S2: Specify contracts and module boundaries before implementation.
- [x] S3: Implement the anti-drift deadline timer and deterministic clock tests.
- [x] S4: Implement the sale state machine and transition tests.
- [x] S5: Implement shared atomic inventory reservation and concurrency tests.
- [x] S6: Implement exactly-once expiry and release behavior.
- [ ] S7: Implement idempotent checkout and boundary/race tests.
- [ ] S8: Connect the state machine and service to accessible React UI.
- [ ] S9: Run typecheck, tests, build, browser walkthrough, and capture concise evidence.
- [ ] S10: Write the evidence-based AI failure audit and README, then push `main`.

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
