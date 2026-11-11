const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT = path.join(__dirname, "..", "icon");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const TILE_A = [0xd9, 0x77, 0x57];
const TILE_B = [0xe8, 0xb8, 0x7a];
const COAL_L = [0x2a, 0x16, 0x10];
const COAL_R = [0x3f, 0x22, 0x16];
const HOT = [0xfb, 0xf9, 0xf3];

const EMBER = [
  [47, 13],
  [74, 35],
  [68, 74],
  [45, 89],
  [26, 71],
  [24, 36]
];
const CORE = [
  [46.9, 31],
  [48.5, 53],
  [46.6, 75],
  [45.3, 53]
];

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function place(v, s) {
  return { x: (v[0] * s) / 100, y: (v[1] * s) / 100 };
}

function corners(verts, s, round) {
  const pts = verts.map((v) => place(v, s));
  const n = pts.length;
  return pts.map((v, i) => ({
    in: lerp(v, pts[(i - 1 + n) % n], round),
    ctrl: v,
    out: lerp(v, pts[(i + 1) % n], round)
  }));
}

function quad(out, p0, c, p1, steps = 12) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
    });
  }
}

function poly(verts, s, round) {
  const cs = corners(verts, s, round);
  const out = [];
  for (const c of cs) {
    out.push(c.in);
    quad(out, c.in, c.ctrl, c.out);
  }
  return out;
}

function svgPath(verts, s, round) {
  const cs = corners(verts, s, round);
  const r = (n) => Math.round(n * 1000) / 1000;
  let d = `M${r(cs[0].in.x)} ${r(cs[0].in.y)}`;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    d += `Q${r(c.ctrl.x)} ${r(c.ctrl.y)} ${r(c.out.x)} ${r(c.out.y)}`;
    if (i < cs.length - 1) d += `L${r(cs[i + 1].in.x)} ${r(cs[i + 1].in.y)}`;
  }
  return d + "Z";
}

function tilePoly(s, radius) {
  const r = radius * s;
  const p = [];
  const arc = (cx, cy, from) => {
    for (let i = 0; i <= 16; i++) {
      const a = from + (i / 16) * (Math.PI / 2);
      p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  arc(r, r, Math.PI);
  arc(s - r, r, -Math.PI / 2);
  arc(s - r, s - r, 0);
  arc(r, s - r, Math.PI / 2);
  return p;
}

function edgesOf(polys) {
  const edges = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      if (a.y === b.y || !isFinite(a.y) || !isFinite(b.y) || !isFinite(a.x) || !isFinite(b.x)) continue;
      edges.push(
        a.y < b.y ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y, w: 1 } : { x0: b.x, y0: b.y, x1: a.x, y1: a.y, w: -1 }
      );
    }
  }
  return edges;
}

function addSpan(cov, base, size, x0, x1, amt) {
  if (x0 < 0) x0 = 0;
  if (x1 > size) x1 = size;
  if (x1 <= x0) return;
  const i0 = Math.floor(x0);
  const i1 = Math.floor(x1);
  if (i0 === i1) {
    cov[base + i0] += (x1 - x0) * amt;
    return;
  }
  cov[base + i0] += (i0 + 1 - x0) * amt;
  for (let x = i0 + 1; x < i1; x++) cov[base + x] += amt;
  if (i1 < size) cov[base + i1] += (x1 - i1) * amt;
}

function rasterize(polys, size, sub = 8) {
  const cov = new Float32Array(size * size);
  const edges = edgesOf(polys);
  const amt = 1 / sub;
  const hits = [];
  for (let row = 0; row < size * sub; row++) {
    const y = (row + 0.5) / sub;
    hits.length = 0;
    for (const e of edges) {
      if (y < e.y0 || y >= e.y1) continue;
      hits.push({ x: e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), w: e.w });
    }
    if (hits.length < 2) continue;
    hits.sort((a, b) => a.x - b.x);
    const base = Math.floor(y) * size;
    let wind = 0;
    let start = 0;
    for (const h of hits) {
      const was = wind;
      wind += h.w;
      if (was === 0 && wind !== 0) start = h.x;
      else if (was !== 0 && wind === 0) addSpan(cov, base, size, start, h.x, amt);
    }
  }
  return cov;
}

function render(size) {
  const right = [EMBER[0], EMBER[1], EMBER[2], EMBER[3]];
  const tile = rasterize([tilePoly(size, 0.225)], size);
  const span = 2 * (size - 1 || 1);
  const tileRgb = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / span;
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) tileRgb[i + c] = TILE_A[c] + (TILE_B[c] - TILE_A[c]) * t;
    }
  }
  const rgba = Buffer.alloc(size * size * 4);
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const a = Math.min(1, Math.max(0, tile[i]));
    if (a <= 0) continue;
    const o = i * 4;
    rgba[o] = Math.round(tileRgb[i * 3]);
    rgba[o + 1] = Math.round(tileRgb[i * 3 + 1]);
    rgba[o + 2] = Math.round(tileRgb[i * 3 + 2]);
    rgba[o + 3] = Math.round(a * 255);
  }
  const overlays = [
    { cov: rasterize([poly(EMBER, size, 0.13)], size), rgb: COAL_L },
    { cov: rasterize([poly(right, size, 0.13)], size), rgb: COAL_R },
    { cov: rasterize([poly(CORE, size, 0.22)], size), rgb: HOT }
  ];
  for (const { cov, rgb } of overlays) {
    for (let i = 0; i < n; i++) {
      const srcA = Math.min(1, Math.max(0, cov[i]));
      if (srcA <= 0) continue;
      const o = i * 4;
      const dstA = rgba[o + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      for (let c = 0; c < 3; c++) {
        const src = rgb[c] * srcA;
        const dst = rgba[o + c] * dstA;
        rgba[o + c] = Math.round((src + dst * (1 - srcA)) / outA);
      }
      rgba[o + 3] = Math.round(outA * 255);
    }
  }
  return rgba;
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function encodeIco(images) {
  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    dir[e] = img.size >= 256 ? 0 : img.size;
    dir[e + 1] = img.size >= 256 ? 0 : img.size;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.png.length;
  });
  return Buffer.concat([dir, ...images.map((i) => i.png)]);
}

const emberPath = svgPath(EMBER, 100, 0.13);
const corePath = svgPath(CORE, 100, 0.22);
const rightPath = svgPath([EMBER[0], EMBER[1], EMBER[2], EMBER[3]], 100, 0.13);

fs.mkdirSync(OUT, { recursive: true });

fs.writeFileSync(
  path.join(OUT, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <defs>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d97757"/>
      <stop offset="1" stop-color="#e8b87a"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22.5" fill="url(#c)"/>
  <path d="${emberPath}" fill="#2a1610"/>
  <path d="${rightPath}" fill="#3f2216"/>
  <path d="${corePath}" fill="#fbf9f3"/>
</svg>
`
);

fs.writeFileSync(
  path.join(OUT, "icon.ico"),
  encodeIco(ICO_SIZES.map((size) => ({ size, png: encodePng(size, render(size)) })))
);
fs.writeFileSync(path.join(OUT, "icon.png"), encodePng(512, render(512)));

console.log("ember " + emberPath);
console.log("icon/icon.svg");
console.log("icon/icon.ico   " + ICO_SIZES.join(",") + "px");
console.log("icon/icon.png   512px");
