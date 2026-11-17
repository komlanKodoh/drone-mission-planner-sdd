# Why the acceptance test fixtures changed

The first run of `npm test` passed all 12 route-map checks and failed all 10 acceptance checks. Each acceptance test called a feature with `const context = {} as AppContext`, even though `AppContext` requires a clock, records store, aircraft adapter, and operator ID. The failures therefore happened before the requested behavior ran (`undefined.now`, `undefined.transaction`, or `undefined.getMission`).

The acceptance tests now create a small deterministic `AppContext` with `MemoryRecords`, configuration and mission records, current route/evidence fixtures, a fixed clock, and a synthetic aircraft adapter. The expected behaviors remain intact and several checks now assert persisted state or evidence references as well as the returned status. No implementation defaults or test-specific production branches were added.

The 11 `resolveRequest()` checks remain as checks of the no-context fallback response. Implemented API behavior is exercised through the injected-context server tests in `tests/implementation.test.ts`; its local-listener integration case skips when the environment denies port binding.

Latest result: `npm test` passes 22/22; `npm run test:implementation` passes all 8 test files.
