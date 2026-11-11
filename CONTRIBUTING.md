# Development

Use Node.js 24+ and the checked-in npm lockfile.

```sh
npm ci
npm run dev
```

`dev` starts Vite, opens Electron when the server is ready and stops both processes on exit. `npm start` builds the renderer before opening Electron. `dev:web` runs the renderer alone, without desktop data access.

## Checks

Run `npm run verify` before committing. It checks formatting, unused code, tests, types and the renderer build. Run `npm run smoke` after changing the UI, IPC bridge, workers or readers.

Use `npm run format` to apply formatting. [Testing](docs/testing.md) covers the larger fixture run and packaged checks.

## Readers

Source roots live in `main/source-paths.js`. Adapters belong in `main/sources/` and use `Collector.scanFile` for caching and error reporting.

Emit fresh input, output, cache reads and cache writes separately. Check whether the native format includes cached input or reasoning in another counter. Add fixtures for repeated events, counter resets and missing fields. Bump the parser cache version when cached records change meaning, and update [sources.md](docs/sources.md).

Fixtures must be synthetic. Keep personal logs, credentials, app data and diagnostic output out of Git.

## Pricing and assets

`npm run pricing` refreshes `pricing-data.json` from LiteLLM and models.dev. Review the generated changes and run the pricing tests. Preserve explicit zero prices and flag unknown rates instead of guessing them.

`npm run icons` regenerates the app icons from `tools/make-icons.js`. Fonts and icons are bundled locally.

## Dependencies

Commit `package-lock.json` with dependency changes. Run `npm audit`, verification and smoke tests after updating packages.

The minimatch override targets versions 9 and 10 used by the packaging tools. Older dependants use a different API; keep that distinction when changing the override.

## Builds

```sh
npm run build:win
npm run build:mac
npm run dist
npm run smoke:package
```

Build on the target OS. Windows produces an NSIS installer; macOS produces arm64 and x64 DMGs. `dist` produces an unpacked app. Build commands replace `release/` and `dist/`; `npm run clean` also removes `artifacts/`.

Public installers come from the [release workflow](docs/releases.md).
