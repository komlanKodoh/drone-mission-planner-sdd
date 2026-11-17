# Drone Mission Planner — Project 2

This is a local TypeScript/Node.js implementation of the Project 1 drone mission planner. The runnable demo uses only synthetic configuration, airspace, authorization, aircraft, and telemetry data. It does not connect to or control real aircraft.

## Run the synthetic browser demo

Use Node.js 22.6 or newer:

```sh
npm start
```

Open `http://127.0.0.1:3000`. The demo walks through recommendation, configuration selection, route saving, validation, preflight, upload/start reconciliation, telemetry, and the mission record. Demo values and thresholds are fixtures, not operating limits.

## Verify

```sh
npm run test:implementation
```

This runs the added behavior and SQLite tests. `npm test` runs the contract suite and currently passes all 22 tests using deterministic fixtures. See `test-fixture-change-notes.md` for why the missing `AppContext` setup was added and which route-map checks still exercise the no-context 501 fallback.

## Storage

`SQLiteRecords` provides durable local mission/configuration storage. The demo uses `MemoryRecords` so each launch starts with a clean synthetic mission.
