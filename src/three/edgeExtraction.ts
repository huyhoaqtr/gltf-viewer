/**
 * Extracts hard/silhouette edges from triangle geometry: for each edge
 * shared by exactly two triangles, keep it only if the dihedral angle
 * between their faces exceeds `thresholdDeg` (an edge with only one owning
 * triangle — a mesh boundary — is always kept). Same semantics as
 * THREE.EdgesGeometry, but built for speed on very large meshes.
 *
 * THREE.EdgesGeometry re-derives vertex identity from a *string* built out
 * of each vertex's rounded coordinates (`` `${x},${y},${z}` ``), and stores
 * pending edges in a plain `{}` used as a hash map — both are classic V8
 * slow paths (string allocation/hashing, dictionary-mode property access,
 * `for...in`) once you're doing it tens of millions of times. When the
 * input is already indexed, shared vertices already carry the same integer
 * id — no need to re-derive identity from coordinates at all. This packs
 * each directed edge into a single numeric key (`a * vertexCount + b`) for a
 * real `Map<number, number>`, and stores pending-edge data (endpoints, face
 * normal) in parallel typed arrays instead of one object+Vector3 per edge.
 */

/**
 * Canonicalizes every triangle corner to a vertex id shared by every other
 * corner at the (quantized) same position — no string hashing, nested
 * numeric Maps instead. This is required even when `index` is already
 * provided: an incoming index only reflects whatever sharing the source mesh
 * happened to encode, and plenty of real geometry (hard-surface/flat-shaded
 * exports in particular — distinct per-face vertices so each face keeps its
 * own normal, common in CAD/BIM output) stores coincident corners under
 * *different* index values. Treating the given index as already-canonical
 * would silently miss the adjacency between such faces — edge identity has
 * to come from where a vertex actually sits, exactly like
 * THREE.EdgesGeometry's own (string-based) approach, just without the
 * string allocation.
 */
function buildCanonicalIndex(
  position: Float32Array,
  index: { length: number; [i: number]: number } | null
): { position: Float32Array; index: Uint32Array } {
  const PRECISION = 1e4;
  const cornerCount = index ? index.length : position.length / 3;
  const remap = new Map<number, Map<number, Map<number, number>>>();
  const canonicalIndex = new Uint32Array(cornerCount);
  const outPositions: number[] = [];
  let nextId = 0;

  for (let k = 0; k < cornerCount; k++) {
    const vi = index ? index[k] : k;
    const x = Math.round(position[vi * 3] * PRECISION);
    const y = Math.round(position[vi * 3 + 1] * PRECISION);
    const z = Math.round(position[vi * 3 + 2] * PRECISION);

    let byY = remap.get(x);
    if (!byY) {
      byY = new Map();
      remap.set(x, byY);
    }
    let byZ = byY.get(y);
    if (!byZ) {
      byZ = new Map();
      byY.set(y, byZ);
    }
    let id = byZ.get(z);
    if (id === undefined) {
      id = nextId++;
      byZ.set(z, id);
      outPositions.push(position[vi * 3], position[vi * 3 + 1], position[vi * 3 + 2]);
    }
    canonicalIndex[k] = id;
  }

  return { position: new Float32Array(outPositions), index: canonicalIndex };
}

function extractEdgesFromIndexed(
  position: Float32Array,
  index: { length: number; [i: number]: number },
  thresholdDeg: number
): Float32Array {
  const thresholdDot = Math.cos((thresholdDeg * Math.PI) / 180);
  const triCount = (index.length / 3) | 0;
  const vertexCount = position.length / 3;
  const maxEdges = triCount * 3;

  // Pending (not-yet-matched) edges, keyed by a directed integer pair packed
  // into one number — parallel typed arrays instead of one heap object per
  // edge. `slotState[s] === 1` means "resolved" (already paired off, kept
  // just to detect a duplicate/non-manifold third triangle sharing the same
  // directed edge, same as the original's `null`-but-still-"in" entries).
  const slotA = new Int32Array(maxEdges);
  const slotB = new Int32Array(maxEdges);
  const slotNX = new Float32Array(maxEdges);
  const slotNY = new Float32Array(maxEdges);
  const slotNZ = new Float32Array(maxEdges);
  const slotState = new Uint8Array(maxEdges); // 0 = pending, 1 = resolved
  let slotCount = 0;
  const edgeMap = new Map<number, number>();

  const out = new Float32Array(maxEdges * 6);
  let outLen = 0;

  const emit = (a: number, b: number) => {
    const ai = a * 3;
    const bi = b * 3;
    out[outLen++] = position[ai];
    out[outLen++] = position[ai + 1];
    out[outLen++] = position[ai + 2];
    out[outLen++] = position[bi];
    out[outLen++] = position[bi + 1];
    out[outLen++] = position[bi + 2];
  };

  const processEdge = (a: number, b: number, nx: number, ny: number, nz: number) => {
    const rev = b * vertexCount + a;
    const revSlot = edgeMap.get(rev);
    if (revSlot !== undefined) {
      if (slotState[revSlot] === 0) {
        const dot = nx * slotNX[revSlot] + ny * slotNY[revSlot] + nz * slotNZ[revSlot];
        if (dot <= thresholdDot) emit(a, b);
        slotState[revSlot] = 1;
      }
      return;
    }
    const fwd = a * vertexCount + b;
    if (!edgeMap.has(fwd)) {
      const slot = slotCount++;
      slotA[slot] = a;
      slotB[slot] = b;
      slotNX[slot] = nx;
      slotNY[slot] = ny;
      slotNZ[slot] = nz;
      edgeMap.set(fwd, slot);
    }
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = index[t * 3];
    const i1 = index[t * 3 + 1];
    const i2 = index[t * 3 + 2];
    if (i0 === i1 || i1 === i2 || i2 === i0) continue; // degenerate

    const ax = position[i0 * 3], ay = position[i0 * 3 + 1], az = position[i0 * 3 + 2];
    const bx = position[i1 * 3], by = position[i1 * 3 + 1], bz = position[i1 * 3 + 2];
    const cx = position[i2 * 3], cy = position[i2 * 3 + 1], cz = position[i2 * 3 + 2];

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    processEdge(i0, i1, nx, ny, nz);
    processEdge(i1, i2, nx, ny, nz);
    processEdge(i2, i0, nx, ny, nz);
  }

  // Unmatched (boundary) edges — whatever's still pending.
  for (let s = 0; s < slotCount; s++) {
    if (slotState[s] === 0) emit(slotA[s], slotB[s]);
  }

  return out.subarray(0, outLen);
}

export function extractEdgeSegments(
  position: Float32Array,
  index: Uint16Array | Uint32Array | Int32Array | null,
  thresholdDeg: number
): Float32Array {
  const canonical = buildCanonicalIndex(position, index);
  return extractEdgesFromIndexed(canonical.position, canonical.index, thresholdDeg);
}
