// Runs inside a dedicated Worker: the CPU-heavy half of merging one chunk of meshes into a single
// geometry — transforming every vertex into the root's space, offsetting the indices and, where
// possible, welding vertices. The main thread has already concatenated the raw attribute data
// (cheap memcpy), so everything arrives and leaves as transferred typed arrays.
//
// Parts whose vertex normals are all exactly their triangle's face normal (flat-shaded CAD/BIM
// surfaces — the bulk of such models) are split out into a "flat" group: no normal attribute and
// vertices welded by position alone (a flat-shaded triangle soup repeats every corner once per
// face, ~5x more vertices than it needs). The renderer shades that group with `flatShading`
// (normals from screen-space derivatives), which gives the identical image for such surfaces
// while cutting vertex work and GPU memory several times over.
//
// @ts-nocheck — targets the worker global (`self`/`postMessage`), which conflicts with the "DOM"
// lib used by the rest of the app's tsconfig (same escape hatch as edgesWorker.ts).
import { Matrix3, Matrix4 } from "three";

const _m = new Matrix4();
const _n = new Matrix3();

/** cos of the largest angle allowed between a vertex normal and the face normal of a "flat" part. */
const FLAT_DOT = 0.999;

/** Same maths as BufferAttribute.applyMatrix4 (with the perspective divide). */
function transformPositions(a, start, count, e) {
  const end = (start + count) * 3;
  for (let i = start * 3; i < end; i += 3) {
    const x = a[i];
    const y = a[i + 1];
    const z = a[i + 2];
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    a[i] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    a[i + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    a[i + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  }
}

/** Same maths as BufferAttribute.applyNormalMatrix: normal matrix, then normalize. */
function transformNormals(a, start, count, e) {
  const end = (start + count) * 3;
  for (let i = start * 3; i < end; i += 3) {
    const x = a[i];
    const y = a[i + 1];
    const z = a[i + 2];
    const nx = e[0] * x + e[3] * y + e[6] * z;
    const ny = e[1] * x + e[4] * y + e[7] * z;
    const nz = e[2] * x + e[5] * y + e[8] * z;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    a[i] = nx / len;
    a[i + 1] = ny / len;
    a[i + 2] = nz / len;
  }
}

/** Same maths as BufferAttribute.transformDirection; only xyz of a vec4 tangent is touched. */
function transformDirections(a, start, count, itemSize, e) {
  const end = (start + count) * itemSize;
  for (let i = start * itemSize; i < end; i += itemSize) {
    const x = a[i];
    const y = a[i + 1];
    const z = a[i + 2];
    const nx = e[0] * x + e[4] * y + e[8] * z;
    const ny = e[1] * x + e[5] * y + e[9] * z;
    const nz = e[2] * x + e[6] * y + e[10] * z;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    a[i] = nx / len;
    a[i + 1] = ny / len;
    a[i + 2] = nz / len;
  }
}

/** Global vertex id of the k-th index entry of a part (identity index for non-indexed parts). */
function vertexAt(item, rawIndex, k) {
  return item.indexed ? rawIndex[item.indexStart + k] + item.vertexStart : item.vertexStart + k;
}

/** True when every vertex normal of the part equals the face normal of its triangle (winding order). */
function isFlatPart(item, pos, nor, rawIndex) {
  for (let k = 0; k + 2 < item.indexCount; k += 3) {
    const a = vertexAt(item, rawIndex, k) * 3;
    const b = vertexAt(item, rawIndex, k + 1) * 3;
    const c = vertexAt(item, rawIndex, k + 2) * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    let fx = e1y * e2z - e1z * e2y;
    let fy = e1z * e2x - e1x * e2z;
    let fz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (len < 1e-20) continue; // degenerate: draws nothing, shading is irrelevant
    fx /= len; fy /= len; fz /= len;
    for (const v of [a, b, c]) {
      if (nor[v] * fx + nor[v + 1] * fy + nor[v + 2] * fz < FLAT_DOT) return false;
    }
  }
  return true;
}

function boundsOf(pos) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  // Same definition as BufferGeometry.computeBoundingSphere: centred on the box, radius to the farthest point.
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  let r2 = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return { box: [minX, minY, minZ, maxX, maxY, maxZ], sphere: [cx, cy, cz, Math.sqrt(r2)] };
}

/** Index array sized for the vertex count, plus its untouched copy (see MergedBatch.pristineIndex). */
function makeIndex(length, vertexCount) {
  const Index = vertexCount > 65535 ? Uint32Array : Uint16Array;
  return new Index(length);
}

/**
 * Geometry for the given parts with vertices welded: vertices whose listed attributes are all
 * bit-identical become one. Exact equality, so the rendered result is unchanged. Only the vertices
 * the parts actually index are emitted, in first-use order (good for vertex-fetch locality).
 */
function buildWelded(ordinals, items, attrs, rawIndex, totalVertices) {
  let indexTotal = 0;
  let vertexUpper = 0;
  for (const o of ordinals) {
    indexTotal += items[o].indexCount;
    vertexUpper += items[o].vertexCount;
  }
  // Compare Float32 data as raw 32-bit words (bit-exact, and 0 / -0 stay distinct).
  const words = attrs.map((a) => (a.array instanceof Float32Array ? new Uint32Array(a.array.buffer, a.array.byteOffset, a.array.length) : a.array));
  const sizes = attrs.map((a) => a.itemSize);
  const attrCount = attrs.length;

  let cap = 16;
  while (cap < vertexUpper * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const source = new Int32Array(vertexUpper); // output id -> global source vertex
  const canon = new Int32Array(totalVertices).fill(-1); // global vertex -> output id (memo)
  let unique = 0;

  const same = (g1, g2) => {
    for (let k = 0; k < attrCount; k++) {
      const w = words[k];
      const n = sizes[k];
      const o1 = g1 * n;
      const o2 = g2 * n;
      for (let c = 0; c < n; c++) if (w[o1 + c] !== w[o2 + c]) return false;
    }
    return true;
  };

  const indexOut = new Uint32Array(indexTotal);
  let wIdx = 0;
  for (const o of ordinals) {
    const item = items[o];
    for (let k = 0; k < item.indexCount; k++) {
      const g = vertexAt(item, rawIndex, k);
      let id = canon[g];
      if (id < 0) {
        let h = 0x811c9dc5;
        for (let a = 0; a < attrCount; a++) {
          const w = words[a];
          const n = sizes[a];
          const base = g * n;
          for (let c = 0; c < n; c++) h = Math.imul(h ^ w[base + c], 0x01000193);
        }
        h ^= h >>> 15;
        h = Math.imul(h, 0x2c1b3c6d);
        h ^= h >>> 13;
        let slot = h & mask;
        for (;;) {
          const t = table[slot];
          if (t < 0) {
            id = unique++;
            table[slot] = id;
            source[id] = g;
            break;
          }
          if (same(source[t], g)) {
            id = t;
            break;
          }
          slot = (slot + 1) & mask;
        }
        canon[g] = id;
      }
      indexOut[wIdx++] = id;
    }
  }

  const outAttrs = attrs.map((a) => {
    const n = a.itemSize;
    const out = new a.array.constructor(unique * n);
    const src = a.array;
    for (let i = 0; i < unique; i++) {
      const so = source[i] * n;
      const oo = i * n;
      for (let c = 0; c < n; c++) out[oo + c] = src[so + c];
    }
    return { name: a.name, itemSize: n, normalized: a.normalized, array: out };
  });
  const index = makeIndex(indexTotal, unique);
  index.set(indexOut);
  const position = outAttrs.find((a) => a.name === "position").array;
  return { ordinals, attributes: outAttrs, index, pristine: index.slice(), ...boundsOf(position) };
}

self.onmessage = (ev) => {
  const { id, attributes, items, totalVertices, rawIndex, allowFlat } = ev.data;
  try {
    for (const item of items) {
      _m.fromArray(item.matrix);
      const e = _m.elements;
      const ne = _n.getNormalMatrix(_m).elements;
      for (const attr of attributes) {
        if (attr.name === "position") transformPositions(attr.array, item.vertexStart, item.vertexCount, e);
        else if (attr.name === "normal") transformNormals(attr.array, item.vertexStart, item.vertexCount, ne);
        else if (attr.name === "tangent") transformDirections(attr.array, item.vertexStart, item.vertexCount, attr.itemSize, e);
      }
    }

    const flatOrdinals = [];
    const smoothOrdinals = [];
    if (allowFlat) {
      const pos = attributes.find((a) => a.name === "position").array;
      const nor = attributes.find((a) => a.name === "normal").array;
      items.forEach((item, i) => (isFlatPart(item, pos, nor, rawIndex) ? flatOrdinals : smoothOrdinals).push(i));
    } else {
      items.forEach((_, i) => smoothOrdinals.push(i));
    }

    const groups = [];
    const transfer = [];
    if (flatOrdinals.length > 0) {
      const position = attributes.filter((a) => a.name === "position");
      groups.push({ kind: "flat", ...buildWelded(flatOrdinals, items, position, rawIndex, totalVertices) });
    }
    if (smoothOrdinals.length > 0) {
      groups.push({ kind: "smooth", ...buildWelded(smoothOrdinals, items, attributes, rawIndex, totalVertices) });
    }
    for (const g of groups) {
      transfer.push(g.index.buffer, g.pristine.buffer);
      for (const a of g.attributes) transfer.push(a.array.buffer);
    }
    self.postMessage({ id, ok: true, groups }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
