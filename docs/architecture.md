# Architecture

Cinder runs Electron with a React renderer. Four utility-process pools handle local usage, tool calls, quotas and Cursor billing. Workers start on demand. The packaged app runs without a local HTTP server.

| Location                                     | Responsibility                                             |
| -------------------------------------------- | ---------------------------------------------------------- |
| `main.js`, `preload.js`                      | Window lifecycle, native controls and the fixed IPC bridge |
| `main/worker-pool.js`, `main/scan-worker.js` | Worker ownership, job dispatch and cancellation            |
| `main/scan-service.js`, `main/snapshot.js`   | Coalescing scans and keeping saved results                 |
| `main/source-paths.js`, `main/sources/`      | History discovery and native format readers                |
| `main/normalize.js`, `main/pricing*.js`      | Deduplication, token categories, costs and price rules     |
| `main/limits/`, `main/limits-service.js`     | Account discovery, provider APIs, caching and resets       |
| `main/contracts.js`                          | Validation of saved usage, calls and quotas                |
| `src/`                                       | Views, components, state hooks and aggregation             |
| `src/styles/`                                | Styles grouped by responsibility                           |
| `test/`, `tools/`                            | Fixtures, checks, diagnostics and packaging                |

## Scans

Readers emit usage metadata, then normalization deduplicates it, applies prices and groups compatible records by minute. Request counts survive grouping. The renderer builds daily and hourly summaries from those records.

File caches hold raw usage records so price changes can recalculate cached history. Signatures include file size, modification time and relevant companion files. Files that change during a read are parsed again on the next scan.

Repeated requests share a pending scan. Cancellation settles its jobs and retires the worker; late results cannot replace a newer process. Partial scans keep their warnings and leave the previous complete snapshot on disk. Snapshot writes use a temporary file and atomic rename.

Long lists initially render five rows. Choice menus above 200 items are virtualized. Session grouping and provider summaries are memoized by their input data.

## Storage

Electron's `userData` directory holds these files:

| File                                  | Contents                              |
| ------------------------------------- | ------------------------------------- |
| `scan-snapshot.json`                  | Last saved usage and calls            |
| `scan-cache.json`, `calls-cache.json` | Parsed file caches                    |
| `limits-snapshot.json`                | Last account quotas                   |
| `limits-profiles.json`                | Additional account directories        |
| `limits-reset-intent.json`            | Reset request and grant identifiers   |
| `pricing-rules.json`                  | Custom prices, aliases and exclusions |
| `window-state.json`                   | Window bounds and background          |

Renderer preferences use `cinder-` localStorage keys and still read the old `au-` prefix. Cache versions invalidate old parser output. Snapshots include account labels and local paths, without native login tokens. Cursor billing has a bounded in-memory cache.

## Process boundaries

The renderer is sandboxed, with context isolation and Node integration disabled. IPC accepts calls from the current window's main frame. Navigation, webviews and permission requests are blocked; external HTTP(S) links open in the system browser.

Provider credentials are read in workers. Quota requests do not create a conversation or inference turn. Reset intents are saved before the consuming request, and retries use the same key and grant. Source history is never edited by these readers.
