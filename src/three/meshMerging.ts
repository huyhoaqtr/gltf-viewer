import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type LineArtKind = "line" | "lineSegments" | "points";
type LineArtObject = THREE.Line | THREE.LineSegments | THREE.Points;

function lineArtKindOf(obj: THREE.Object3D): LineArtKind | null {
  const o = obj as Partial<THREE.Line & THREE.LineSegments & THREE.Points>;
  if (o.isLineSegments) return "lineSegments";
  if (o.isLine) return "line";
  if (o.isPoints) return "points";
  return null;
}

/** One part's slice inside a batch's merged *line-art* index buffer. */
export interface LineArtRange {
  indexStart: number;
  indexCount: number;
}

/** Combined decorative line-art (see mergeLineArtByMaterial) for one material/kind group. */
export interface LineArtBatch {
  line: LineArtObject;
  pristineIndex: Uint16Array | Uint32Array;
  ranges: LineArtRange[];
}

/** A mesh part's link to its paired decorative line-art's slice in a LineArtBatch. */
export interface LineArtLink {
  batch: LineArtBatch;
  rangeIndex: number;
}

/** One original mesh's slice inside a merged batch's shared index buffer. */
export interface MergedPart {
  index: number;
  name: string;
  indexStart: number;
  indexCount: number;
  hidden: boolean;
  /** Decorative line-art (see findLineArtSiblings) folded into some LineArtBatch — masked in lockstep by setPartVisible. */
  lineArt: LineArtLink[];
}

/** One part's slice inside a batch's merged *edges* line index buffer. */
export interface EdgeRange {
  indexStart: number;
  indexCount: number;
}

/**
 * The combined edges overlay for a whole MergedBatch — built asynchronously
 * (see edgesOverlay.ts) once the worker pool finishes, so it starts out
 * absent. `ranges` is parallel to the owning batch's `parts` (same index),
 * letting setPartVisible mask a part's edge segments the same way it masks
 * the part's triangles, instead of rebuilding the whole overlay.
 */
export interface MergedBatchEdges {
  line: THREE.LineSegments;
  pristineIndex: Uint32Array;
  ranges: EdgeRange[];
}

/**
 * Many small meshes sharing one material, folded into a single draw call.
 * `pristineIndex` is the untouched original index array — `hidden` parts are
 * masked by overwriting their slice of the *live* geometry index with a
 * degenerate (zero-area) triangle, and restored by copying back from here,
 * so hide/isolate/show-all work without rebuilding the whole geometry.
 */
export interface MergedBatch {
  mesh: THREE.Mesh;
  pristineIndex: Uint16Array | Uint32Array;
  parts: MergedPart[];
  edges?: MergedBatchEdges;
}

const DEGENERATE_VERTEX = 0;

/**
 * Some BIM/CAD exports bake decorative line-art (e.g. a tree's branch
 * sketch) as a separate sibling node right next to its solid "fill" mesh.
 * Must run on the *pristine* tree, before mergeMeshesByMaterial removes the
 * original mesh nodes — that's the only point at which the sibling
 * relationship (same parent) is still observable. The returned map feeds
 * mergeLineArtByMaterial so it can link each line-art object back to
 * whichever {batch, part} (or plain Mesh) its sibling mesh ends up as.
 */
export function findLineArtSiblings(root: THREE.Object3D): Map<LineArtObject, THREE.Mesh> {
  const map = new Map<LineArtObject, THREE.Mesh>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.parent?.children.forEach((sib) => {
      if (sib === mesh) return;
      if (lineArtKindOf(sib)) map.set(sib as LineArtObject, mesh);
    });
  });
  return map;
}

/**
 * Folds every eligible mesh sharing the same material into one big mesh per
 * material (BIM/CAD exports with no grouping can have tens of thousands of
 * tiny separate meshes — each is its own draw call regardless of triangle
 * count, and that per-draw-call CPU overhead, not geometry complexity, is
 * what actually tanks frame rate). Skinned/morphed/multi-material meshes are
 * left untouched so their existing behavior keeps working exactly as before.
 *
 * Returns `meshToPart` alongside the batches — a lookup from each folded
 * mesh back to its {batch, part} — so mergeLineArtByMaterial (run right
 * after, before these original mesh objects would otherwise be needed) can
 * link a decorative line-art's new home back to the part it belongs to.
 *
 * Known gap, accepted for the sake of the draw-call win: the edges overlay
 * is (intentionally) also computed per merged batch rather than per
 * original part, so hiding/isolating a single part leaves its edge outline
 * visible until edgesOverlay.ts finishes building it (see there) — after
 * that it's masked the same way as everything else here.
 */
export function mergeMeshesByMaterial(
  root: THREE.Object3D
): { batches: MergedBatch[]; meshToPart: Map<THREE.Mesh, { batch: MergedBatch; part: MergedPart }> } {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (Array.isArray(mesh.material)) return;
    if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (mesh.morphTargetInfluences?.length) return;

    const list = groups.get(mesh.material);
    if (list) list.push(mesh);
    else groups.set(mesh.material, [mesh]);
  });

  const batches: MergedBatch[] = [];
  const meshToPart = new Map<THREE.Mesh, { batch: MergedBatch; part: MergedPart }>();

  groups.forEach((meshes, material) => {
    if (meshes.length < 2) return; // nothing to gain merging a single mesh

    const transformed = meshes.map((mesh) => {
      const local = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(local);
      // mergeGeometries requires every input to be consistently indexed or
      // not — naively-exported (non-Draco) glTFs are often plain triangle
      // soup with no index at all. Give those a trivial identity index so
      // they merge uniformly with meshes that do have one.
      if (!geo.index) {
        const vertexCount = geo.attributes.position.count;
        const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
        geo.setIndex(new THREE.BufferAttribute(new IndexArray(vertexCount).map((_, i) => i), 1));
      }
      return geo;
    });

    const merged = mergeGeometries(transformed, false);
    transformed.forEach((g) => g.dispose());
    if (!merged || !merged.index) {
      // Incompatible attributes across this material's meshes — bail and
      // leave the originals as individual (unmerged) meshes.
      merged?.dispose();
      return;
    }
    // mergeGeometries doesn't compute bounding volumes itself — do it now
    // instead of leaving frustum culling to compute it lazily on this
    // batch's first render, and set frustumCulled explicitly so a merged
    // batch is never accidentally exempted from it.
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    // A merged batch can be a huge fraction of the whole model's triangles
    // (BIM/CAD exports folded down to one draw call per material) — a plain
    // per-triangle raycast (click-to-select, see ViewerEngine.handleModelClick)
    // against that would scan millions of triangles on every click. Building
    // a bounds tree here (see bvhSetup.ts for the global raycast patch that
    // uses it) turns that into a fast tree descent instead.
    //
    // `indirect: true` is required: by default computeBoundsTree() reorders
    // geometry.index in place for cache locality (three-mesh-bvh's own
    // documented behavior) — but `parts[].indexStart/indexCount` (just below)
    // and pristineIndex are fixed offsets into that *same* index array,
    // assumed stable everywhere a part is looked up by index range
    // (findPartAtFaceIndex, setPartVisible, extractPartGeometry,
    // extractPartIndexed). A silent reorder scrambles every one of those —
    // hide/isolate mask the wrong triangles, the wrong part gets
    // selected/highlighted, and per-part edges get built from the wrong
    // triangle range. Indirect mode keeps its own internal ordering instead
    // of touching geometry.index, so raycasts still resolve to the correct
    // original faceIndex.
    merged.computeBoundsTree({ indirect: true });

    const parts: MergedPart[] = [];
    let cursor = 0;
    meshes.forEach((mesh, i) => {
      const count = mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count;
      parts.push({
        index: i,
        name: mesh.name || "(không tên)",
        indexStart: cursor,
        indexCount: count,
        hidden: false,
        lineArt: [],
      });
      cursor += count;
    });

    const mergedMesh = new THREE.Mesh(merged, material);
    mergedMesh.castShadow = true;
    mergedMesh.receiveShadow = true;
    mergedMesh.frustumCulled = true;
    mergedMesh.name = `Nhóm gộp (${meshes.length} bộ phận)`;
    root.add(mergedMesh);

    const batch: MergedBatch = {
      mesh: mergedMesh,
      pristineIndex: (merged.index.array as Uint16Array | Uint32Array).slice() as Uint16Array | Uint32Array,
      parts,
    };
    mergedMesh.userData.mergedBatch = batch;
    batches.push(batch);

    meshes.forEach((mesh, i) => {
      meshToPart.set(mesh, { batch, part: parts[i] });
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    });
  });

  if (batches.length > 0) {
    const originalCount = batches.reduce((sum, b) => sum + b.parts.length, 0);
    console.log(`[merge] ${originalCount} mesh → ${batches.length} draw call (theo material)`);
  }

  return { batches, meshToPart };
}

/** Binary-searches which original part a raycast hit's faceIndex belongs to. */
export function findPartAtFaceIndex(batch: MergedBatch, faceIndex: number): MergedPart | null {
  const target = faceIndex * 3;
  let lo = 0;
  let hi = batch.parts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const part = batch.parts[mid];
    if (target < part.indexStart) hi = mid - 1;
    else if (target >= part.indexStart + part.indexCount) lo = mid + 1;
    else return part;
  }
  return null;
}

/** Masks (or restores) one slice of a *live* index buffer — the shared trick
 * behind every hide/show below: EdgesGeometry, the raycaster, and the
 * renderer's rasterizer all skip/ignore degenerate zero-area elements, so
 * this is a plain in-place rewrite, never a rebuild. */
function maskIndexRange(indexAttr: THREE.BufferAttribute, pristine: Uint16Array | Uint32Array, range: EdgeRange, visible: boolean) {
  const live = indexAttr.array as Uint16Array | Uint32Array;
  if (visible) {
    live.set(pristine.subarray(range.indexStart, range.indexStart + range.indexCount), range.indexStart);
  } else {
    live.fill(DEGENERATE_VERTEX, range.indexStart, range.indexStart + range.indexCount);
  }
  indexAttr.needsUpdate = true;
}

/** Shows/hides one part's slice of a LineArtBatch's merged index buffer. */
export function setLineArtRangeVisible(batch: LineArtBatch, rangeIndex: number, visible: boolean) {
  const range = batch.ranges[rangeIndex];
  const indexAttr = batch.line.geometry.getIndex();
  if (!range || !indexAttr) return;
  maskIndexRange(indexAttr, batch.pristineIndex, range, visible);
}

/**
 * Shows/hides one part by masking (or restoring) its slice of the live index
 * buffer — the solid mesh's, its edges overlay's (once built — see
 * edgesOverlay.ts), and any decorative line-art siblings folded elsewhere
 * (see findLineArtSiblings/mergeLineArtByMaterial) — all in place, no rebuild.
 */
export function setPartVisible(batch: MergedBatch, part: MergedPart, visible: boolean) {
  const indexAttr = batch.mesh.geometry.getIndex();
  if (indexAttr) maskIndexRange(indexAttr, batch.pristineIndex, part, visible);

  const edges = batch.edges;
  const edgeRange = edges?.ranges[part.index];
  if (edges && edgeRange) {
    const edgeIndexAttr = edges.line.geometry.getIndex();
    if (edgeIndexAttr) maskIndexRange(edgeIndexAttr, edges.pristineIndex, edgeRange, visible);
  }

  part.lineArt.forEach((link) => setLineArtRangeVisible(link.batch, link.rangeIndex, visible));

  part.hidden = !visible;
}

/** Extracts one part's triangles as a standalone position-only geometry (for outline highlighting). */
export function extractPartGeometry(batch: MergedBatch, part: MergedPart): THREE.BufferGeometry {
  const posAttr = batch.mesh.geometry.attributes.position as THREE.BufferAttribute;
  const positions = new Float32Array(part.indexCount * 3);
  for (let i = 0; i < part.indexCount; i++) {
    const vi = batch.pristineIndex[part.indexStart + i];
    positions[i * 3] = posAttr.getX(vi);
    positions[i * 3 + 1] = posAttr.getY(vi);
    positions[i * 3 + 2] = posAttr.getZ(vi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geo;
}

/**
 * Extracts one part's triangles as a small, properly *indexed* geometry —
 * unlike extractPartGeometry, which de-indexes into flat triangle soup (fine
 * for a one-off selection outline, but throws away the shared-vertex
 * information edge-detection needs). Vertices already sharing the same id in
 * the batch's pristine index (i.e. genuinely coincident, not just
 * numerically close) keep sharing a *local* id here — cheap to derive since
 * that sharing is already known, unlike edgeExtraction's own quantization
 * fallback, which has to rediscover it from raw coordinates. Feeding this
 * into extractEdgeSegments (see edgeExtraction.ts) instead of a de-indexed
 * array is what lets it use fast integer-keyed edge adjacency instead of
 * hashing vertex coordinates.
 */
export function extractPartIndexed(batch: MergedBatch, part: MergedPart): { position: Float32Array; index: Uint32Array } {
  const posAttr = batch.mesh.geometry.attributes.position as THREE.BufferAttribute;
  const remap = new Map<number, number>();
  const index = new Uint32Array(part.indexCount);
  const positions: number[] = [];
  for (let i = 0; i < part.indexCount; i++) {
    const vi = batch.pristineIndex[part.indexStart + i];
    let local = remap.get(vi);
    if (local === undefined) {
      local = remap.size;
      remap.set(vi, local);
      positions.push(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
    }
    index[i] = local;
  }
  return { position: new Float32Array(positions), index };
}

/**
 * Merges decorative line-art (glTF LINES/LINE_STRIP/POINTS primitives — BIM
 * exports commonly bake dimension lines, hatching, or sketch details this
 * way) by material, the same way mergeMeshesByMaterial folds down triangle
 * meshes — for the same draw-call reason (a tree-heavy site model can have
 * as many separate line-art sketches as it has meshes). These were never
 * individually click-selectable (see SelectionController.pickFromRaycast,
 * which only ever matches `isMesh` hits), so unlike the mesh merge this
 * doesn't need its own hide/isolate UI — but each folded object's new slice
 * *is* linked back to whichever mesh part it was originally paired with
 * (via `lineArtToMesh`, from findLineArtSiblings on the pristine tree, and
 * `meshToPart`, from mergeMeshesByMaterial), by pushing onto that part's
 * `lineArt` array — so hiding that part also masks its sibling's segments in
 * lockstep (see setPartVisible) instead of leaving them stranded, visible,
 * with no owner. A sibling whose mesh stayed an individual (unmerged) Mesh
 * gets the same link stored on `mesh.userData.lineArtLinks` instead, for
 * SelectionController's non-merged hide/isolate/showAll path to apply.
 */
export function mergeLineArtByMaterial(
  root: THREE.Object3D,
  lineArtToMesh: Map<LineArtObject, THREE.Mesh>,
  meshToPart: Map<THREE.Mesh, { batch: MergedBatch; part: MergedPart }>
): number {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const groups = new Map<string, { material: THREE.Material; kind: LineArtKind; objects: LineArtObject[] }>();
  root.traverse((obj) => {
    const kind = lineArtKindOf(obj);
    if (!kind) return;
    const o = obj as LineArtObject;
    if (!o.geometry || Array.isArray(o.material)) return;

    const key = `${kind}:${o.material.id}`;
    const existing = groups.get(key);
    if (existing) existing.objects.push(o);
    else groups.set(key, { material: o.material, kind, objects: [o] });
  });

  let mergedCount = 0;

  groups.forEach(({ material, kind, objects }) => {
    if (objects.length < 2) return;

    const transformed = objects.map((o) => {
      const local = new THREE.Matrix4().multiplyMatrices(rootInverse, o.matrixWorld);
      const geo = o.geometry.clone();
      geo.applyMatrix4(local);
      // Same reasoning as mergeMeshesByMaterial: normalize to indexed so
      // naively-exported (non-Draco) line-art merges with any that already
      // has an index instead of being skipped for "mixed indexing".
      if (!geo.index) {
        const vertexCount = geo.attributes.position.count;
        const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
        geo.setIndex(new THREE.BufferAttribute(new IndexArray(vertexCount).map((_, i) => i), 1));
      }
      if (kind === "line") {
        // THREE.Line draws its index as one continuous LINE_STRIP: every
        // consecutive pair connects, including the pair straddling the seam
        // between two originally-*separate* line-strip objects once their
        // indices are concatenated below. Left as a strip, that seam becomes
        // a spurious segment from one sketch's last point straight to an
        // unrelated sketch's first — exactly the "line floating across the
        // whole model" artifact this avoids. Expanding to explicit
        // consecutive-pair segments (LineSegments shape) up front means
        // concatenation — and later masking a sub-range for hide/isolate,
        // see setLineArtRangeVisible — can only ever affect real segments
        // from the original strip, never a connection between two objects.
        const src = geo.index!.array as ArrayLike<number>;
        const pairCount = Math.max(0, src.length - 1);
        const PairIndexArray = src.length > 65535 ? Uint32Array : Uint16Array;
        const paired = new PairIndexArray(pairCount * 2);
        for (let i = 0; i < pairCount; i++) {
          paired[i * 2] = src[i];
          paired[i * 2 + 1] = src[i + 1];
        }
        geo.setIndex(new THREE.BufferAttribute(paired, 1));
      }
      return geo;
    });
    const merged = mergeGeometries(transformed, false);
    transformed.forEach((g) => g.dispose());
    if (!merged || !merged.index) {
      merged?.dispose();
      return; // incompatible attributes — leave these as individual objects
    }
    // Same reasoning as mergeMeshesByMaterial: compute bounds eagerly and
    // make frustum culling explicit instead of implicit for this batch.
    merged.computeBoundingSphere();
    merged.computeBoundingBox();

    // "line" was already expanded to segment pairs above, so both non-point
    // kinds share the same (safe-to-concatenate) LineSegments shape now.
    const combined: LineArtObject =
      kind === "points" ? new THREE.Points(merged, material) : new THREE.LineSegments(merged, material);
    combined.raycast = () => {};
    combined.frustumCulled = true;
    root.add(combined);
    mergedCount += objects.length;

    const lineArtBatch: LineArtBatch = {
      line: combined,
      pristineIndex: (merged.index.array as Uint16Array | Uint32Array).slice() as Uint16Array | Uint32Array,
      ranges: [],
    };

    let cursor = 0;
    objects.forEach((o) => {
      const rawCount = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
      // Matches the pair-expansion above: a strip of rawCount vertices
      // becomes (rawCount - 1) segments, i.e. twice as many indices.
      const count = kind === "line" ? Math.max(0, rawCount - 1) * 2 : rawCount;
      const rangeIndex = lineArtBatch.ranges.length;
      lineArtBatch.ranges.push({ indexStart: cursor, indexCount: count });

      const mesh = lineArtToMesh.get(o);
      const linked = mesh && meshToPart.get(mesh);
      if (linked) {
        linked.part.lineArt.push({ batch: lineArtBatch, rangeIndex });
      } else if (mesh) {
        // Sibling mesh stayed an individual Mesh (not merged) — stash the
        // link on it directly for SelectionController's non-merged path.
        const links = (mesh.userData.lineArtLinks as LineArtLink[] | undefined) ?? [];
        links.push({ batch: lineArtBatch, rangeIndex });
        mesh.userData.lineArtLinks = links;
      }

      cursor += count;
      o.parent?.remove(o);
      o.geometry.dispose();
    });
  });

  return mergedCount;
}
