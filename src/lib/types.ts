export interface Entry {
  ts: string;
  t: number;
  source: string;
  model: string;
  provider: string;
  project: string;
  session: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
  cost: number;
  costInput: number;
  costOutput: number;
  costCacheWrite: number;
  costCacheRead: number;
  n?: number;
  cacheWrite1h?: number;
  cacheSavings?: number;
  speed?: "standard" | "fast" | "ultrafast";
  speedPremium?: number;
  unpriced?: number;
  costOrigin?: "reported" | "estimated" | "unknown" | "mixed";
}

export interface UsageSelection {
  source: string;
  model: string;
  project: string;
}

export interface LimitWindow {
  id: string;
  label: string;
  usedPercent: number;
  kind: "session" | "daily" | "weekly" | "monthly" | "other";
  scope?: string;
  durationMinutes?: number;
  resetsAt?: string;
  resetSource?: "schedule";
  usedAmount?: number;
  totalAmount?: number;
  unit?: "USD";
}
export interface LimitAccount {
  locations?: string[];
  id: string;
  provider: string;
  label: string;
  status: "ready" | "unavailable" | "error";
  plan?: string;
  checkedAt: string;
  lastSuccessAt?: string;
  stale?: boolean;
  windows: LimitWindow[];
  message?: string;
  ordinaryUsageAllowed?: boolean;
  resetCredits?: {
    available: number;
    nextExpiresAt?: string;
    canUse?: boolean;
    options?: { kind: string; label: string; description: string; available: number; expiresAt?: string }[];
  };
}
export interface LimitsResult {
  checkedAt: string;
  accounts: LimitAccount[];
  error?: string;
  warning?: string;
  cancelled?: boolean;
}
export interface LimitsProfile {
  provider: string;
  root: string;
}
export interface PricingRule {
  model: string;
  source?: string;
  target?: string;
  exclude?: boolean;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
}

export type UsageFacets = Record<keyof UsageSelection, { name: string; requests: number }[]>;

interface SourceMeta {
  source: string;
  dir: string;
  files: number;
  entries: number;
}

interface SourceInfo {
  id: string;
  label: string;
}

interface CallStat {
  name: string;
  count: number;
}

interface McpToolStat {
  server: string;
  name: string;
  count: number;
}

interface SourceCalls {
  total: number;
  tools: CallStat[];
  mcpTools: McpToolStat[];
  mcpServers: CallStat[];
  skills: CallStat[];
  byDay: Record<string, number>;
}

interface InstalledInfo {
  skills: string[];
  mcp: Record<string, string[]>;
}

export interface CallsResult {
  sources: Record<string, SourceCalls>;
  installed?: InstalledInfo;
  scannedAt: string;
  diagnostics?: { source: string; file?: string; message: string }[];
  warning?: string;
  error?: string;
  cancelled?: boolean;
}

export interface ScanProgress {
  done: number;
  total: number;
  label: string;
  files?: number;
}

export interface SnapshotInfo {
  savedAt: string;
  entries: number;
  sources: number;
  hasCalls: boolean;
}

export interface CollectResult {
  entries: Entry[];
  sources: SourceMeta[];
  catalog?: SourceInfo[];
  scannedAt: string;
  diagnostics?: { source: string; file?: string; message: string }[];
  warning?: string;
  error?: string;
  cancelled?: boolean;
}
export interface CursorUsageResult extends CollectResult {
  from: string;
  until: string;
  omitted?: number;
}

export interface Totals {
  cacheSavings?: number;
  speedPremium?: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  requests: number;
  cost: number;
  unpriced?: number;
}

export interface Bucket extends Totals {
  name: string;
  source?: string;
}

export interface DayPoint extends Totals {
  key: string;
}

interface CostBy {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface Summary {
  totals: Totals;
  costBy: CostBy;
  byDay: Map<string, Totals>;
  byHour: Totals[];
  models: Bucket[];
  projects: Bucket[];
  sources: Bucket[];
  sessions: number;
  activeDays: number;
  first: number | null;
  last: number | null;
  count: number;
}

declare global {
  interface Window {
    cinder?: {
      platform: string;
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onWindowState: (cb: (v: boolean) => void) => () => void;
      setBackground: (bg: string) => void;
      collect: () => Promise<CollectResult>;
      readPricing: () => Promise<PricingRule[]>;
      savePricing: (rules: PricingRule[]) => Promise<CollectResult>;
      calls: () => Promise<CallsResult>;
      readLimits: () => Promise<LimitsResult>;
      onLimitsProgress: (cb: (value: LimitsResult) => void) => () => void;
      refreshLimits: () => Promise<LimitsResult>;
      cursorAccountUsage: (input: { accountId: string; days: number; force?: boolean }) => Promise<CursorUsageResult>;
      useResetCredit: (input: { accountId: string; requestId: string; resetKind?: string }) => Promise<LimitsResult>;
      limitsProfiles: () => Promise<LimitsProfile[]>;
      addLimitsProfile: (provider: string) => Promise<LimitsProfile[]>;
      removeLimitsProfile: (profile: LimitsProfile) => Promise<LimitsProfile[]>;
      cancelScan: () => Promise<boolean>;
      onScanProgress: (cb: (p: ScanProgress) => void) => () => void;
      onMenuRescan: (cb: () => void) => () => void;
      snapshotInfo: () => Promise<SnapshotInfo | null>;
      snapshotUsage: () => Promise<CollectResult | null>;
      snapshotCalls: () => Promise<CallsResult | null>;
    };
  }
}
