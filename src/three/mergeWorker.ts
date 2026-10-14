// Runs inside a dedicated Worker: the CPU-heavy half of merging one chunk of meshes into a single
// geometry — transforming every vertex into the root's space and offsetting the indices. The main
// thread has already concatenated the raw attribute data (cheap memcpy), so everything arrives and
// leaves as transferred typed arrays.
//
// @ts-nocheck — targets the worker global (`self`/`postMessage`), which conflicts with the "DOM"
// lib used by the rest of the app's tsconfig (same escape hatch as edgesWorker.ts).
import { Matrix3, Matrix4 } from "three";

const _m = new Matrix4();
const _n = new Matrix3();

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
    let nx = e[0] * x + e[3] * y + e[6] * z;
    let ny = e[1] * x + e[4] * y + e[7] * z;
    let nz = e[2] * x + e[5] * y + e[8] * z;
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

self.onmessage = (ev) => {
  const { id, attributes, items, totalVertices, rawIndex } = ev.data;
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

    // Index: raw values are concatenated already; add each part's vertex offset (or write an
    // identity index for non-indexed parts, which are consistently indexed in the merged result).
    const IndexArray = totalVertices > 65535 ? Uint32Array : Uint16Array;
    const index = new IndexArray(rawIndex.length);
    for (const item of items) {
      const base = item.vertexStart;
      const s = item.indexStart;
      const end = s + item.indexCount;
      if (item.indexed) for (let i = s; i < end; i++) index[i] = rawIndex[i] + base;
      else for (let i = s, v = base; i < end; i++, v++) index[i] = v;
    }

    // Bounding box + sphere (same definition as BufferGeometry.computeBoundingBox/Sphere).
    const pos = attributes.find((a) => a.name === "position").array;
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
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    let r2 = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > r2) r2 = d;
    }

    const pristine = index.slice();
    const transfer = [index.buffer, pristine.buffer, ...attributes.map((a) => a.array.buffer)];
    self.postMessage(
      {
        id,
        ok: true,
        attributes,
        index,
        pristine,
        box: [minX, minY, minZ, maxX, maxY, maxZ],
        sphere: [cx, cy, cz, Math.sqrt(r2)],
      },
      transfer
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
