# Testing

```sh
npm run verify
npm run smoke
npm run smoke:large
npm audit
```

`verify` runs Prettier, Knip, unit/integration tests, TypeScript and a production renderer build. Tests cover all 19 source fixtures, token accounting, deduplication, pricing, snapshots, worker failures and quota handling.

`smoke` opens Electron with synthetic history and isolated app data. It checks all nine views, filters, charts, exports, themes, keyboard interaction, resets and startup recovery. It also checks the minimum window size. Quota and reset responses are mocked; no real credit is consumed.

`smoke:large` adds 10,000 projects and checks bounded DOM rows, scrolling, search and keyboard selection. Screenshots and reports go to ignored `artifacts/` directories.

## Packaged app

After building, run:

```sh
npm run smoke:package
npm run smoke:package -- --large
```

Packaging compares the ASAR contents with the current source and renderer, checks the version and verifies the unpacked SQLite helper. Packaged smoke loads that archive through the development Electron executable. Fresh installation and upgrades need separate manual testing.

`npm run smoke:native` runs on isolated CI runners. On macOS it mounts the host architecture's DMG, copies the app and checks its signature before launching the packaged executable. On Windows it launches the unpacked executable. It checks a synthetic scan, usage and calls workers, navigation and a screenshot through a temporary local debugging connection. No test hook is included in the shipped app.

## Local diagnostics

`npm run diagnose` reads local history and reports counts, warnings and aggregation timings. `npm run diagnose:limits` checks real provider quotas. Add `-- --cursor-usage` to read seven days of Cursor billing too.

Diagnostic files stay in `artifacts/`. They omit conversation contents and credentials. Do not commit them.

## CI

GitHub Actions runs verification and smoke tests on Windows, Linux, Apple silicon and Intel Macs. macOS pull requests also build and launch their DMGs. Release builds check their archives and launch their native executables before publication. Windows installers are unsigned; macOS apps are ad-hoc signed without notarization. Provider format changes can still require reader updates.
