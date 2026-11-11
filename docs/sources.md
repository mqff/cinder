# Source paths

Overrides replace the default roots. They accept comma- or semicolon-separated paths and expand `~/`. Restart Cinder after changing an environment variable. Directory scans skip symlinks.

XDG data defaults to `~/.local/share`; XDG config defaults to `~/.config`. Application data means Windows AppData, macOS `~/Library/Application Support`, or the corresponding XDG directory on Linux.

| Tool           | History                                                                                                  | Override                                |
| -------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Claude         | `~/.claude/projects` or XDG config `claude/projects`; JSONL                                              | `CLAUDE_CONFIG_DIR`                     |
| Codex          | `~/.codex/sessions` and `archived_sessions`; JSONL                                                       | `CODEX_HOME`                            |
| OpenCode       | XDG data, application data or `~/.opencode`; `opencode*.db` and legacy `storage/message` JSON            | `OPENCODE_DATA_DIR`                     |
| Kilo           | XDG data `kilo/kilo.db`                                                                                  | `KILO_DATA_DIR`                         |
| Goose          | XDG data `goose`, `Block/goose`, or macOS application data `goose`; session databases                    | `GOOSE_PATH_ROOT`                       |
| Hermes         | `~/.hermes/state.db`                                                                                     | `HERMES_HOME`                           |
| Gemini         | `~/.gemini/tmp`; JSON and JSONL                                                                          | `GEMINI_DATA_DIR`                       |
| Qwen           | `~/.qwen/projects/**/chats/*.jsonl`                                                                      | `QWEN_DATA_DIR`                         |
| Droid          | `~/.factory/sessions/**/*.settings.json`                                                                 | `DROID_SESSIONS_DIR`                    |
| Amp            | XDG data `amp`; thread usage ledgers                                                                     | `AMP_DATA_DIR`                          |
| Kimi           | `~/.kimi` or `~/.kimi-code`; `sessions/**/wire.jsonl`                                                    | `KIMI_DATA_DIR`                         |
| Codebuff       | XDG config `manicode`, `manicode-dev`, `manicode-staging`; `chat-messages.json`                          | `CODEBUFF_DATA_DIR`                     |
| OpenClaw       | `~/.openclaw`, `.clawdbot`, `.moltbot`, `.moldbot`; JSONL                                                | `OPENCLAW_DIR`                          |
| Pi             | `~/.pi/agent/sessions`; JSONL                                                                            | `PI_AGENT_DIR`                          |
| GitHub Copilot | `~/.copilot/otel`; OpenTelemetry JSONL                                                                   | `COPILOT_OTEL_FILE_EXPORTER_PATH`       |
| Cursor         | Application data `Cursor/User/globalStorage/state.vscdb` and `~/.cursor/ai-tracking/ai-code-tracking.db` | `CURSOR_DATA_DIR`, `CURSOR_TRACKING_DB` |
| Antigravity    | `~/.gemini/antigravity-cli` or `~/.gemini/antigravity`; SQLite/protobuf                                  | `ANTIGRAVITY_DATA_DIR`                  |
| Grok           | `~/.grok`, XDG config or application data `Grok`; per-turn `usage.json`                                  | `GROK_HOME`                             |
| Muse Code      | Explicit Muse home; `sessions/**/session.jsonl`                                                          | `MUSE_HOME`                             |

Pi also accepts `PI_CODING_AGENT_SESSION_DIR`, then `PI_CODING_AGENT_DIR`. `PI_AGENT_DIR` is treated as the sessions root.

Cursor transcripts come from `~/.cursor/projects/**/agent-transcripts`. Set `CURSOR_PROJECTS_DIR` to change that root. Local Cursor history provides request and tool counts without token totals; [account billing](limits.md) supplies separate token data.

For missing initial Codex speed settings, Cinder can read T3's local model-selection projection at `~/.t3/userdata/statev2.sqlite`. Set `CINDER_T3_HOME` for another home. This reads model selections, not conversations. Native transcript settings take precedence.

Muse requires its actual home directory. Cinder reads runtime session payloads 1 and 3 without starting the Muse SDK.

## Calls and databases

Tool calls come from Claude, Codex, Cursor, OpenCode and Grok. The integration inventory reads skill and MCP server names from native configuration files. Credentials and configuration contents are not returned to the UI.

SQLite databases are opened read-only. If direct access fails, Cinder tries a temporary copy with WAL/SHM files and removes it afterward. WAL changes invalidate cached records.

Only available history is counted. Deleted logs, incomplete writes and changed upstream formats can leave gaps. Source errors appear as scan warnings.
