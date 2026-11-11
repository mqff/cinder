import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, DEFAULT_THEME, resolveMode } from "../src/lib/themes.ts";
import { readAppearance } from "../src/lib/appearance.ts";

function luminance(color: string) {
  const channels = color
    .slice(1)
    .match(/../g)!
    .map((part) => parseInt(part, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("every theme keeps readable text, focus and chart colors in both appearances", () => {
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);
  for (const theme of THEMES)
    for (const mode of ["light", "dark"] as const) {
      const palette = theme[mode];
      for (const color of [...Object.values(palette).filter((value) => typeof value === "string"), ...palette.data])
        assert.match(color, /^#[0-9a-f]{6}$/i);
      for (const background of [palette.bg, palette.surface, palette.muted]) {
        for (const color of [palette.fg, palette.mutedFg, palette.brand, palette.destructive, palette.data[1]])
          assert.ok(contrast(color, background) >= 4.5, `${theme.id} ${mode}: ${color} on ${background}`);
        assert.ok(contrast(palette.brand2, background) >= 3, `${theme.id} ${mode}: focus contrast`);
      }
      for (const color of palette.data)
        for (const background of [palette.bg, palette.surface])
          assert.ok(contrast(color, background) >= 3, `${theme.id} ${mode}: chart contrast`);
    }
});

test("appearance follows the system only when requested", () => {
  assert.equal(resolveMode("system", true), "dark");
  assert.equal(resolveMode("system", false), "light");
  assert.equal(resolveMode("dark", false), "dark");
  assert.equal(resolveMode("light", true), "light");
});

test("stored appearances migrate old palettes and validate each mode independently", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => saved.get(key) ?? null } }
  });
  try {
    assert.deepEqual(readAppearance(), { mode: "system", themes: { dark: DEFAULT_THEME, light: DEFAULT_THEME } });
    saved.set("au-theme-id", "claude");
    saved.set("au-mode", "light");
    assert.deepEqual(readAppearance(), { mode: "light", themes: { dark: "claude", light: "claude" } });
    saved.set("cinder-mode", "system");
    saved.set("cinder-theme-dark", "nord");
    saved.set("cinder-theme-light", "missing-palette");
    assert.deepEqual(readAppearance(), { mode: "system", themes: { dark: "nord", light: DEFAULT_THEME } });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage() {
          throw new Error("Storage disabled");
        }
      }
    });
    assert.equal(readAppearance().themes.dark, DEFAULT_THEME);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
