import {
  Analytics01Icon,
  ChartLineData01Icon,
  CubeIcon,
  FolderLibraryIcon,
  ServerStack01Icon,
  ChampionIcon,
  Search01Icon,
  BoltIcon,
  Layers01Icon,
  MinusSignIcon,
  SquareIcon,
  Copy01Icon,
  Cancel01Icon,
  Refresh01Icon,
  ArrowDown01Icon,
  Tick02Icon,
  GaugeIcon,
  Settings01Icon
} from "@hugeicons/core-free-icons";

export const ICON = {
  overview: Analytics01Icon,
  activity: ChartLineData01Icon,
  models: CubeIcon,
  projects: FolderLibraryIcon,
  providers: ServerStack01Icon,
  badges: ChampionIcon,
  search: Search01Icon,
  bolt: BoltIcon,
  sessions: Layers01Icon,
  minimize: MinusSignIcon,
  maximize: SquareIcon,
  restore: Copy01Icon,
  close: Cancel01Icon,
  refresh: Refresh01Icon,
  chevron: ArrowDown01Icon,
  check: Tick02Icon,
  limits: GaugeIcon,
  settings: Settings01Icon
} as const;

export type IconKey = keyof typeof ICON;
