// Renders source/*.glb to a self-contained animated halftone SVG.
//   node tools/render-s15.js assets/s15-rotate.svg
// Env: OW/OH (output px), SS (supersample), FRAMES, GRAY=<yaw> (single-frame preview)
const fs = require('fs');
const zlib = require('zlib');
const { loadScene } = require('./glb-loader.js');

const SRC = process.env.SRC || 'source/2000 Nissan Silvia Varietta (S15).glb';
const FRAMES = +(process.env.FRAMES || 24);
const W = +(process.env.OW || 420), H = +(process.env.OH || 288);
const SS = +(process.env.SS || 3);
const RW = W * SS, RH = H * SS;
const PAPER = [0xf2, 0xf0, 0xec];
const INK = [0x17, 0x17, 0x21];
const CAR_LENGTH = 4.445;                 // real S15 length, metres

// ---------- load + normalise ----------
const scene = loadScene(SRC);
const P = scene.positions, N = scene.normals;

let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) {
  if (P[i + k] < mn[k]) mn[k] = P[i + k];
  if (P[i + k] > mx[k]) mx[k] = P[i + k];
}
const size = mx.map((v, k) => v - mn[k]);
// longest axis is the car's length; the vertical axis is the shorter of the other two
const axLen = size.indexOf(Math.max(...size));
const rest = [0, 1, 2].filter(a => a !== axLen);
const axUp = size[rest[0]] < size[rest[1]] ? rest[0] : rest[1];
const axWid = rest.find(a => a !== axUp);
const S = CAR_LENGTH / size[axLen];
const ctr = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2);

// world space: x = length, y = height (0 = ground), z = width
const VX = new Float32Array(P.length);
const VN = new Float32Array(P.length);
for (let i = 0; i < P.length / 3; i++) {
  VX[i * 3] = (P[i * 3 + axLen] - ctr[axLen]) * S;
  VX[i * 3 + 1] = (P[i * 3 + axUp] - mn[axUp]) * S;
  VX[i * 3 + 2] = (P[i * 3 + axWid] - ctr[axWid]) * S;
  const nx = N[i * 3 + axLen], ny = N[i * 3 + axUp], nz = N[i * 3 + axWid];
  const m = Math.hypot(nx, ny, nz) || 1;
  VN[i * 3] = nx / m; VN[i * 3 + 1] = ny / m; VN[i * 3 + 2] = nz / m;
}
const CAR_H = (mx[axUp] - mn[axUp]) * S;
const CAR_W = (mx[axWid] - mn[axWid]) * S;

// dark trim: materials whose base colour is near-black (tyres, rubber, grilles)
const DARK = new Set();
scene.materials.forEach((m, i) => {
  const c = (m.pbrMetallicRoughness || {}).baseColorFactor;
  if (c && (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) < 0.22) DARK.add(i);
});

// ---------- render ----------
function renderFrame(yaw) {
  const buf = new Float32Array(RW * RH).fill(1.0);
  const zbuf = new Float32Array(RW * RH).fill(Infinity);
  const pitch = 0.20, dist = 7.4, f = RW * 1.52;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const CY = CAR_H * 0.48;

  const toView = (x, y, z) => {
    const dy = y - CY;
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    return [x1, dy * cp - z1 * sp, dy * sp + z1 * cp + dist];
  };
  const rotDir = (x, y, z) => {
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const project = v => [RW / 2 + f * v[0] / v[2], RH / 2 - f * v[1] / v[2] + RH * 0.05, v[2]];

  const norm = d => { const m = Math.hypot(...d); return d.map(c => c / m); };
  const L = norm([-0.44, 0.66, -0.61]);     // key light, upper-left, camera side
  const L2 = norm([0.78, 0.22, -0.30]);     // fill from the opposite side

  // scanline fill interpolating [z, luminance]
  function fillTri(p, lum) {
    const minY = Math.min(p[0][1], p[1][1], p[2][1]);
    const maxY = Math.max(p[0][1], p[1][1], p[2][1]);
    const y0 = Math.max(0, Math.ceil(minY)), y1 = Math.min(RH - 1, Math.floor(maxY));
    for (let py = y0; py <= y1; py++) {
      const xs = [];
      for (let i = 0; i < 3; i++) {
        const a = p[i], b = p[(i + 1) % 3], la = lum[i], lb = lum[(i + 1) % 3];
        if ((a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py)) {
          const t = (py - a[1]) / (b[1] - a[1]);
          xs.push([a[0] + t * (b[0] - a[0]), a[2] + t * (b[2] - a[2]), la + t * (lb - la)]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((m, n) => m[0] - n[0]);
      const A = xs[0], B = xs[xs.length - 1];
      const xa = Math.max(0, Math.ceil(A[0])), xb = Math.min(RW - 1, Math.floor(B[0]));
      const span = B[0] - A[0];
      for (let px = xa; px <= xb; px++) {
        const t = span > 1e-9 ? (px - A[0]) / span : 0;
        const z = A[1] + t * (B[1] - A[1]);
        const i = py * RW + px;
        if (z < zbuf[i]) { zbuf[i] = z; buf[i] = A[2] + t * (B[2] - A[2]); }
      }
    }
  }

  // ground contact shadow
  {
    const RA = CAR_LENGTH * 0.54, RB = CAR_W * 0.62, NP = 80, poly = [];
    for (let k = 0; k < NP; k++) {
      const t = (k / NP) * Math.PI * 2;
      poly.push(project(toView(Math.cos(t) * RA, 0, Math.sin(t) * RB)));
    }
    for (let py = 0; py < RH; py++) {
      const xs = [];
      for (let i = 0; i < NP; i++) {
        const a = poly[i], b = poly[(i + 1) % NP];
        if ((a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py))
          xs.push(a[0] + (py - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let px = Math.max(0, Math.ceil(xs[i])); px <= Math.min(RW - 1, Math.floor(xs[i + 1])); px++) {
          const j = py * RW + px;
          if (buf[j] === 1.0) buf[j] = 0.855;
        }
    }
  }

  for (const [i0, i1, i2, mat] of scene.tris) {
    const alb = DARK.has(mat) ? 0.13 : 1.0;
    const p = [], lu = [];
    let behind = false;
    for (const vi of [i0, i1, i2]) {
      const v = toView(VX[vi * 3], VX[vi * 3 + 1], VX[vi * 3 + 2]);
      if (v[2] <= 0.05) { behind = true; break; }
      p.push(project(v));
      let n = rotDir(VN[vi * 3], VN[vi * 3 + 1], VN[vi * 3 + 2]);
      const m = Math.hypot(...v);
      const vd = [-v[0] / m, -v[1] / m, -v[2] / m];
      let facing = n[0] * vd[0] + n[1] * vd[1] + n[2] * vd[2];
      if (facing < 0) { n = n.map(c => -c); facing = -facing; }   // two-sided shading
      const key = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      const fill = Math.max(0, n[0] * L2[0] + n[1] * L2[1] + n[2] * L2[2]);
      const sky = 0.5 + 0.5 * n[1];
      const rim = Math.pow(1 - facing, 3.4);
      const l = alb * (0.03 + 0.08 * sky + 1.00 * Math.pow(key, 1.32) + 0.10 * fill) + rim * 0.24 * alb;
      lu.push(Math.max(0, Math.min(1, l)));
    }
    if (!behind) fillTri(p, lu);
  }

  const small = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += buf[(y * SS + dy) * RW + (x * SS + dx)];
    small[y * W + x] = s / (SS * SS);
  }
  return small;
}

// ---------- Bayer 8x8 ordered dither ----------
const BAYER = (() => {
  const n = 8, m = [];
  for (let y = 0; y < n; y++) {
    m.push([]);
    for (let x = 0; x < n; x++) {
      let v = 0, mask = n >> 1;
      for (let bit = 0; mask > 0; mask >>= 1, bit += 2) {
        const bx = (x & mask) ? 1 : 0, by = (y & mask) ? 1 : 0;
        v |= ((by * 3) ^ bx) << bit;
      }
      m[y].push((v + 0.5) / (n * n));
    }
  }
  return m;
})();

function dither(lum) {
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = lum[y * W + x] > BAYER[y & 7][x & 7] ? PAPER : INK;
    const o = (y * W + x) * 3;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
  }
  return px;
}

// ---------- PNG ----------
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- output ----------
if (process.env.GRAY !== undefined) {
  const lum = renderFrame(parseFloat(process.env.GRAY));
  const g = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { const v = Math.round(lum[i] * 255); g[i * 3] = v; g[i * 3 + 1] = v; g[i * 3 + 2] = v; }
  fs.writeFileSync('gray.png', png(g, W, H));
  fs.writeFileSync('dith.png', png(dither(lum), W, H));
  console.log(`car ${CAR_LENGTH.toFixed(2)} x ${CAR_W.toFixed(2)} x ${CAR_H.toFixed(2)} m - wrote gray.png + dith.png`);
  process.exit(0);
}

const out = process.argv[2];
if (!out) { console.error('usage: node tools/render-s15.js <out.svg>'); process.exit(1); }

const b64 = [];
for (let i = 0; i < FRAMES; i++) {
  b64.push(png(dither(renderFrame((i / FRAMES) * Math.PI * 2 + Math.PI * 0.25)), W, H).toString('base64'));
  process.stdout.write(`frame ${i + 1}/${FRAMES}\r`);
}

const DUR = 4.0;
const kt = [];
for (let i = 0; i <= FRAMES; i++) kt.push((i / FRAMES).toFixed(5));
const images = b64.map((d, i) => {
  const vals = [];
  for (let k = 0; k <= FRAMES; k++) vals.push((k % FRAMES === i) ? 1 : 0);
  return `  <image x="0" y="0" width="${W}" height="${H}" opacity="${i === 0 ? 1 : 0}" xlink:href="data:image/png;base64,${d}">
    <animate attributeName="opacity" dur="${DUR}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${kt.join(';')}" values="${vals.join(';')}"/>
  </image>`;
}).join('\n');

const LB = H + 15;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H + 26}" width="${W}" height="${H + 26}" shape-rendering="crispEdges" image-rendering="pixelated">
  <rect width="100%" height="100%" fill="#f2f0ec"/>
${images}
  <g font-family="Consolas,'Courier New',monospace" font-size="7" fill="#17171f" letter-spacing="0.6">
    <text x="10" y="${LB}">NISSAN SILVIA S15</text>
    <text x="10" y="${LB + 9}" opacity="0.62">SR20DET / JPN-TOKYO</text>
    <text x="${W - 10}" y="${LB}" text-anchor="end">CHAYAPOL SURIYAJAN</text>
    <text x="${W - 10}" y="${LB + 9}" text-anchor="end" opacity="0.62">CH-20111001</text>
  </g>
</svg>
`;
fs.writeFileSync(out, svg);
console.log(`\nwrote ${out} - ${(svg.length / 1024).toFixed(1)} KB, ${FRAMES} frames`);
