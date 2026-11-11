export type Mode = "dark" | "light";
export type Appearance = Mode | "system";

export interface Palette {
  bg: string;
  fg: string;
  surface: string;
  muted: string;
  mutedFg: string;
  brand: string;
  brand2: string;
  data: [string, string, string, string, string];
  destructive: string;
}

export interface Theme {
  id: string;
  label: string;
  dark: Palette;
  light: Palette;
}

export const THEMES: Theme[] = [
  {
    id: "graphite",
    label: "Graphite",
    dark: {
      bg: "#171819",
      fg: "#e5e5e7",
      surface: "#1c1d1f",
      muted: "#27292c",
      mutedFg: "#93969d",
      brand: "#dce2ec",
      brand2: "#a5b1c6",
      data: ["#9baac5", "#a3b9ab", "#b9ac98", "#ada1b8", "#929ba7"],
      destructive: "#dc7777"
    },
    light: {
      bg: "#fcfcfc",
      fg: "#25272b",
      surface: "#ffffff",
      muted: "#eff0f2",
      mutedFg: "#696c73",
      brand: "#303b4e",
      brand2: "#56677e",
      data: ["#647b9d", "#5b7262", "#9c8567", "#8d769b", "#6f7e8f"],
      destructive: "#bd4242"
    }
  },
  {
    id: "claude",
    label: "Claude",
    dark: {
      bg: "#1f1e1d",
      fg: "#f5f4ee",
      surface: "#262624",
      muted: "#2a2926",
      mutedFg: "#b0a89a",
      brand: "#d97757",
      brand2: "#e8b87a",
      data: ["#d97757", "#b3c98c", "#e8b87a", "#cf9bb0", "#8fb0d9"],
      destructive: "#e66b56"
    },
    light: {
      bg: "#faf9f5",
      fg: "#3d3a2f",
      surface: "#ffffff",
      muted: "#efece4",
      mutedFg: "#6d6a5a",
      brand: "#a65234",
      brand2: "#b07a2a",
      data: ["#c15f3c", "#537337", "#b07a2a", "#a05278", "#3a6ea5"],
      destructive: "#c0392b"
    }
  },
  {
    id: "slate",
    label: "Slate",
    dark: {
      bg: "#14171a",
      fg: "#e9edf1",
      surface: "#1c2024",
      muted: "#262c32",
      mutedFg: "#97a2ad",
      brand: "#5b9df0",
      brand2: "#7fb0f5",
      data: ["#5b9df0", "#63c19b", "#e0b062", "#c58bd9", "#e58a8a"],
      destructive: "#e76f5b"
    },
    light: {
      bg: "#f7f8fa",
      fg: "#1e2329",
      surface: "#ffffff",
      muted: "#eceef1",
      mutedFg: "#5c656e",
      brand: "#286abe",
      brand2: "#478ad9",
      data: ["#2f7de0", "#247854", "#bd8228", "#9a5ec0", "#d15a5a"],
      destructive: "#c0392b"
    }
  },
  {
    id: "ocean",
    label: "Ocean",
    dark: {
      bg: "#0e1719",
      fg: "#e6f2f3",
      surface: "#142023",
      muted: "#1d2d31",
      mutedFg: "#93aeb2",
      brand: "#2dd4bf",
      brand2: "#5eead4",
      data: ["#2dd4bf", "#38bdf8", "#a78bfa", "#fbbf24", "#fb7185"],
      destructive: "#f87171"
    },
    light: {
      bg: "#f4faf9",
      fg: "#12292b",
      surface: "#ffffff",
      muted: "#e4f0ef",
      mutedFg: "#4d6b6e",
      brand: "#0b786e",
      brand2: "#109788",
      data: ["#0d9488", "#0270a9", "#7c3aed", "#d77606", "#e11d48"],
      destructive: "#cf2424"
    }
  },
  {
    id: "emerald",
    label: "Emerald",
    dark: {
      bg: "#101711",
      fg: "#e9f3ea",
      surface: "#16211a",
      muted: "#1f2d22",
      mutedFg: "#9fb4a3",
      brand: "#34d399",
      brand2: "#6ee7b7",
      data: ["#34d399", "#60a5fa", "#fbbf24", "#c084fc", "#fb7185"],
      destructive: "#f87171"
    },
    light: {
      bg: "#f5faf6",
      fg: "#16281b",
      surface: "#ffffff",
      muted: "#e6f1e8",
      mutedFg: "#4f6a55",
      brand: "#047b56",
      brand2: "#0d9b6c",
      data: ["#059669", "#2461e6", "#d77606", "#9333ea", "#e11d48"],
      destructive: "#cf2424"
    }
  },
  {
    id: "amethyst",
    label: "Amethyst",
    dark: {
      bg: "#16121c",
      fg: "#f0ecf6",
      surface: "#1e1826",
      muted: "#281f33",
      mutedFg: "#b0a3bf",
      brand: "#a78bfa",
      brand2: "#c4b5fd",
      data: ["#a78bfa", "#f0abfc", "#5eead4", "#fbbf24", "#fb7185"],
      destructive: "#f87171"
    },
    light: {
      bg: "#faf7fd",
      fg: "#271e33",
      surface: "#ffffff",
      muted: "#efe9f5",
      mutedFg: "#665a75",
      brand: "#7c3aed",
      brand2: "#9061f0",
      data: ["#7c3aed", "#af23c0", "#0d9488", "#d77606", "#e11d48"],
      destructive: "#cd2323"
    }
  },
  {
    id: "rose",
    label: "Rose",
    dark: {
      bg: "#1a1214",
      fg: "#f7ecef",
      surface: "#241a1d",
      muted: "#322329",
      mutedFg: "#c0a5ac",
      brand: "#fb7185",
      brand2: "#fda4af",
      data: ["#fb7185", "#f0abfc", "#a78bfa", "#fbbf24", "#5eead4"],
      destructive: "#f55671"
    },
    light: {
      bg: "#fdf6f7",
      fg: "#331e24",
      surface: "#ffffff",
      muted: "#f4e6ea",
      mutedFg: "#75565e",
      brand: "#cb1a41",
      brand2: "#f23e5d",
      data: ["#e11d48", "#ad22be", "#7c3aed", "#d57506", "#0d9488"],
      destructive: "#ca2323"
    }
  },
  {
    id: "cinder",
    label: "Cinder",
    dark: {
      bg: "#191614",
      fg: "#eee8e1",
      surface: "#211d19",
      muted: "#302922",
      mutedFg: "#b1a59a",
      brand: "#e5a078",
      brand2: "#e8b87a",
      data: ["#e5a078", "#b2bd93", "#e1bb76", "#c6a0b8", "#91b1c8"],
      destructive: "#f08b80"
    },
    light: {
      bg: "#faf7f2",
      fg: "#332920",
      surface: "#fffdf9",
      muted: "#eee7dd",
      mutedFg: "#756455",
      brand: "#a54e2a",
      brand2: "#8b6228",
      data: ["#a54e2a", "#596e3f", "#936a26", "#935e7b", "#486f8e"],
      destructive: "#b73d35"
    }
  },
  {
    id: "nord",
    label: "Nord",
    dark: {
      bg: "#2e3440",
      fg: "#eceff4",
      surface: "#343b49",
      muted: "#434c5e",
      mutedFg: "#b4bdcb",
      brand: "#92c5d4",
      brand2: "#81a1c1",
      data: ["#88c0d0", "#acc598", "#ebcb8b", "#b48ead", "#d08770"],
      destructive: "#e9aeb1"
    },
    light: {
      bg: "#eceff4",
      fg: "#2e3440",
      surface: "#f8fafc",
      muted: "#d8dee9",
      mutedFg: "#566275",
      brand: "#41657d",
      brand2: "#506d95",
      data: ["#456b85", "#516841", "#907132", "#885e82", "#a35d48"],
      destructive: "#a1414a"
    }
  },
  {
    id: "dracula",
    label: "Dracula",
    dark: {
      bg: "#282a36",
      fg: "#f8f8f2",
      surface: "#303241",
      muted: "#44475a",
      mutedFg: "#b8b5cc",
      brand: "#caa8fa",
      brand2: "#ff79c6",
      data: ["#bd93f9", "#50fa7b", "#f1fa8c", "#ff79c6", "#8be9fd"],
      destructive: "#ff9c9c"
    },
    light: {
      bg: "#f7f5fb",
      fg: "#302b42",
      surface: "#ffffff",
      muted: "#eae5f2",
      mutedFg: "#6b617b",
      brand: "#7550ad",
      brand2: "#a84283",
      data: ["#7550ad", "#25753e", "#8b7421", "#a84283", "#26788b"],
      destructive: "#b53b49"
    }
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    dark: {
      bg: "#1e1e2e",
      fg: "#cdd6f4",
      surface: "#242437",
      muted: "#313244",
      mutedFg: "#a6adc8",
      brand: "#cba6f7",
      brand2: "#89b4fa",
      data: ["#cba6f7", "#a6e3a1", "#f9e2af", "#f5c2e7", "#89dceb"],
      destructive: "#f38ba8"
    },
    light: {
      bg: "#eff1f5",
      fg: "#4c4f69",
      surface: "#f9fafc",
      muted: "#dce0e8",
      mutedFg: "#5d6176",
      brand: "#7e35de",
      brand2: "#1e66f5",
      data: ["#8839ef", "#327015", "#946b10", "#b6328c", "#087d99"],
      destructive: "#c30e35"
    }
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    dark: {
      bg: "#1a1b26",
      fg: "#c0caf5",
      surface: "#202230",
      muted: "#292e42",
      mutedFg: "#9aa5ce",
      brand: "#7aa2f7",
      brand2: "#bb9af7",
      data: ["#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff"],
      destructive: "#f7768e"
    },
    light: {
      bg: "#f0f0f4",
      fg: "#343b58",
      surface: "#fafaff",
      muted: "#dfe1ed",
      mutedFg: "#59637f",
      brand: "#34548a",
      brand2: "#7848a4",
      data: ["#34548a", "#476e30", "#8f5e15", "#7848a4", "#006c86"],
      destructive: "#ad3956"
    }
  },
  {
    id: "solarized",
    label: "Solarized",
    dark: {
      bg: "#002b36",
      fg: "#c2d4d4",
      surface: "#073642",
      muted: "#104551",
      mutedFg: "#a1adad",
      brand: "#5ab7e3",
      brand2: "#52bdb5",
      data: ["#5ab7e3", "#a5b34a", "#d4ad48", "#cf8cb4", "#52bdb5"],
      destructive: "#f09188"
    },
    light: {
      bg: "#fdf6e3",
      fg: "#344d55",
      surface: "#fffaf0",
      muted: "#eee8d5",
      mutedFg: "#596b69",
      brand: "#176a9d",
      brand2: "#197b75",
      data: ["#176a9d", "#5f6e1a", "#8a6900", "#a34c80", "#197b75"],
      destructive: "#b73c34"
    }
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    dark: {
      bg: "#282828",
      fg: "#ebdbb2",
      surface: "#32302f",
      muted: "#3c3836",
      mutedFg: "#bdae93",
      brand: "#fabd2f",
      brand2: "#83a598",
      data: ["#fabd2f", "#b8bb26", "#fe8019", "#d3869b", "#83a598"],
      destructive: "#fb7e6f"
    },
    light: {
      bg: "#fbf1c7",
      fg: "#3c3836",
      surface: "#fff7d6",
      muted: "#ebdbb2",
      mutedFg: "#6f5d4b",
      brand: "#865600",
      brand2: "#427b58",
      data: ["#8f5c00", "#5b6613", "#a84e0b", "#8f3f71", "#367778"],
      destructive: "#ad362b"
    }
  },
  {
    id: "github",
    label: "GitHub",
    dark: {
      bg: "#0d1117",
      fg: "#e6edf3",
      surface: "#161b22",
      muted: "#21262d",
      mutedFg: "#9ca7b3",
      brand: "#79c0ff",
      brand2: "#a5d6ff",
      data: ["#79c0ff", "#7ee787", "#e3b341", "#d2a8ff", "#ffa198"],
      destructive: "#ff7b72"
    },
    light: {
      bg: "#ffffff",
      fg: "#1f2328",
      surface: "#f6f8fa",
      muted: "#eaeef2",
      mutedFg: "#59636e",
      brand: "#0550ae",
      brand2: "#0969da",
      data: ["#0550ae", "#197b35", "#946200", "#8250df", "#bc4c00"],
      destructive: "#cf222e"
    }
  }
];

export const DEFAULT_THEME = "graphite";

export const resolveMode = (appearance: Appearance, systemDark: boolean): Mode =>
  appearance === "system" ? (systemDark ? "dark" : "light") : appearance;

const themeById = (id: string): Theme => THEMES.find((theme) => theme.id === id) ?? THEMES[0];
export const paletteOf = (id: string, mode: Mode): Palette => themeById(id)[mode];
export function applyTheme(id: string, mode: Mode) {
  const palette = paletteOf(id, mode),
    root = document.documentElement;
  const values: Record<string, string> = {
    background: palette.bg,
    foreground: palette.fg,
    card: palette.surface,
    "card-foreground": palette.fg,
    popover: palette.surface,
    "popover-foreground": palette.fg,
    muted: palette.muted,
    "muted-foreground": palette.mutedFg,
    accent: palette.muted,
    "accent-foreground": palette.fg,
    brand: palette.brand,
    "brand-2": palette.brand2,
    destructive: palette.destructive,
    primary: palette.brand,
    "primary-foreground": palette.bg
  };
  palette.data.forEach((color, index) => {
    values[`data-${index + 1}`] = color;
  });
  Object.entries(values).forEach(([key, value]) => root.style.setProperty(`--${key}`, value));
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
  root.style.colorScheme = mode;
  root.style.backgroundColor = palette.bg;
}
