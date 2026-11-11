export const views = [
  ["overview", "Overview", "overview"],
  ["activity", "Activity", "activity"],
  ["calls", "Calls", "bolt"],
  ["models", "Models", "models"],
  ["projects", "Projects", "projects"],
  ["sessions", "Sessions", "sessions"],
  ["providers", "Providers", "providers"],
  ["badges", "Badges", "badges"],
  ["limits", "Limits", "limits"]
] as const;

export type ViewId = (typeof views)[number][0];
const sourceLabels: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  kilo: "Kilo",
  goose: "Goose",
  hermes: "Hermes",
  gemini: "Gemini",
  qwen: "Qwen",
  droid: "Droid",
  amp: "Amp",
  kimi: "Kimi",
  codebuff: "Codebuff",
  openclaw: "OpenClaw",
  pi: "Pi",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  antigravity: "Antigravity",
  grok: "Grok",
  muse: "Muse Code"
};
export const sourceLabel = (id: string) => sourceLabels[id] || id;
