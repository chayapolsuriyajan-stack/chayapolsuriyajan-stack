// Minimal glTF 2.0 / GLB loader: returns world-space triangles with per-vertex normals.
const fs = require('fs');

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function loadGLB(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4) * 0;
    off += (4 - (len % 4)) % 4;
  }
  return { gltf: json, bin };
}

function readAccessor(gltf, bin, idx) {
  const acc = gltf.accessors[idx];
  const [Ctor, csize] = COMP[acc.componentType];
  const n = NUM[acc.type];
  const out = new Float32Array(acc.count * n);
  if (acc.bufferView === undefined) return out;
  const bv = gltf.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || n * csize;
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    for (let k = 0; k < n; k++) {
      const p = o + k * csize;
      let v;
      switch (acc.componentType) {
        case 5126: v = bin.readFloatLE(p); break;
        case 5125: v = bin.readUInt32LE(p); break;
        case 5123: v = bin.readUInt16LE(p); break;
        case 5122: v = bin.readInt16LE(p); break;
        case 5121: v = bin.readUInt8(p); break;
        case 5120: v = bin.readInt8(p); break;
      }
      out[i * n + k] = v;
    }
  }
  return out;
}

function mul(a, b) {                       // column-major 4x4
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const IDENT = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function trs(node) {
  if (node.matrix) return new Float64Array(node.matrix);
  const m = IDENT();
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx;
  m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy;
  m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz;
  m[12] = tx; m[13] = ty; m[14] = tz;
  return m;
}

function xform(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
function xformDir(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ];
}

// returns { positions: Float32Array, normals: Float32Array, tris: [[i,j,k,matIndex]...], materials }
function loadScene(path) {
  const { gltf, bin } = loadGLB(path);
  const positions = [], normals = [], tris = [];

  function walk(nodeIdx, parent) {
    const node = gltf.nodes[nodeIdx];
    const m = mul(parent, trs(node));
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        const P = readAccessor(gltf, bin, prim.attributes.POSITION);
        const N = prim.attributes.NORMAL !== undefined ? readAccessor(gltf, bin, prim.attributes.NORMAL) : null;
        const count = P.length / 3;
        const base = positions.length / 3;
        for (let i = 0; i < count; i++) {
          const p = xform(m, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
          positions.push(p[0], p[1], p[2]);
          if (N) {
            const nn = xformDir(m, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
            const len = Math.hypot(...nn) || 1;
            normals.push(nn[0] / len, nn[1] / len, nn[2] / len);
          } else normals.push(0, 0, 0);
        }
        let idx;
        if (prim.indices !== undefined) idx = readAccessor(gltf, bin, prim.indices);
        else { idx = new Float32Array(count); for (let i = 0; i < count; i++) idx[i] = i; }
        for (let i = 0; i + 2 < idx.length; i += 3) {
          tris.push([base + idx[i], base + idx[i + 1], base + idx[i + 2], prim.material ?? -1]);
        }
      }
    }
    for (const c of node.children || []) walk(c, m);
  }

  const scene = gltf.scenes[gltf.scene || 0];
  for (const n of scene.nodes) walk(n, IDENT());

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    tris,
    materials: gltf.materials || [],
    gltf,
  };
}

module.exports = { loadScene };

if (require.main === module) {
  const s = loadScene(process.argv[2]);
  console.log('verts', s.positions.length / 3, 'tris', s.tris.length, 'materials', s.materials.length);
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < s.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], s.positions[i + k]);
      mx[k] = Math.max(mx[k], s.positions[i + k]);
    }
  console.log('bbox min', mn.map(v => v.toFixed(3)).join(', '));
  console.log('bbox max', mx.map(v => v.toFixed(3)).join(', '));
  console.log('size    ', mx.map((v, k) => (v - mn[k]).toFixed(3)).join(', '));
  console.log('materials:', s.materials.map((m, i) => `${i}:${m.name || '?'}`).join('  '));
}
