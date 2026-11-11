const DEFAULT_BG = "#171819";
function normalizeWindowState(raw = {}) {
  const size = (value, fallback, min) => (Number.isFinite(value) ? Math.min(10000, Math.max(min, value)) : fallback);
  return {
    width: size(raw.width, 1280, 940),
    height: size(raw.height, 840, 600),
    ...(Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : {}),
    maximized: raw.maximized === true,
    bg: typeof raw.bg === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw.bg) ? raw.bg : DEFAULT_BG
  };
}
module.exports = { normalizeWindowState };
