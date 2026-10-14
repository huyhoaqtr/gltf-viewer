import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { INTERACTION_LOD_TRIANGLE_RATIO, MERGE_CHUNK_MAX_TRIANGLES, MERGE_FRAME_BUDGET_MS, LINE_ART_CHUNK_OBJECTS, MERGE_WORKER_POOL_MAX } from "./constants";

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
  /** Logical object this part belongs to (see tagLogicalGroups) — clicking selects the whole group. */
  groupId: number;
  groupName: string;
  /** glTF node extras (e.g. CAD handle) of the group's parent node. */
  groupUserData: Record<string, unknown>;
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
  /** Parts are stored largest-first. */
  parts: MergedPart[];
  /** Index count of the largest-parts prefix drawn while the camera moves (see INTERACTION_LOD_TRIANGLE_RATIO). */
  lodIndexCount: number;
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
 * CAD/BIM exports model one real object (e.g. a pump) as a parent node with
 * several mesh children (base, casing, motor...). Tag every mesh with the id
 * and name of its immediate parent node so a click can select that whole
 * object instead of a single child mesh. A mesh sitting directly under the
 * root has no parent object and forms a group of its own. Must run on the
 * pristine tree (before meshes are removed by the merge).
 */
function tagLogicalGroups(root: THREE.Object3D) {
  const ids = new Map<THREE.Object3D, number>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const owner = mesh.parent && mesh.parent !== root ? mesh.parent : mesh;
    let id = ids.get(owner);
    if (id === undefined) {
      id = ids.size;
      ids.set(owner, id);
    }
    mesh.userData.groupId = id;
    mesh.userData.groupUserData = owner === mesh ? {} : { ...owner.userData };
    mesh.userData.groupName = owner.name || mesh.name || "(no name)";
  });
}

/** Meshes ordered by the diagonal of their bounds in root space, biggest first. */
function sortLargestFirst(meshes: THREE.Mesh[], rootInverse: THREE.Matrix4): THREE.Mesh[] {
  const box = new THREE.Box3();
  const local = new THREE.Matrix4();
  const size = new THREE.Vector3();
  const keyed = meshes.map((mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    local.multiplyMatrices(rootInverse, mesh.matrixWorld);
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(local);
    return { mesh, extent: box.getSize(size).length() };
  });
  return keyed.sort((a, b) => b.extent - a.extent).map((k) => k.mesh);
}

function triangleCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

/**
 * Splits meshes (all sharing one material) into spatially compact chunks of roughly
 * MERGE_CHUNK_MAX_TRIANGLES triangles each, by recursively cutting along the longest
 * axis of the parts' centres at the triangle-count median (a k-d split). One batch
 * per material would span the whole model and never be frustum-culled; chunks are.
 * A single mesh bigger than the limit stays whole.
 */
function splitIntoSpatialChunks(meshes: THREE.Mesh[], rootInverse: THREE.Matrix4): THREE.Mesh[][] {
  const box = new THREE.Box3();
  const local = new THREE.Matrix4();
  const items = meshes.map((mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    local.multiplyMatrices(rootInverse, mesh.matrixWorld);
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(local);
    return { mesh, tris: triangleCount(mesh.geometry), centre: box.getCenter(new THREE.Vector3()) };
  });

  const chunks: THREE.Mesh[][] = [];
  const split = (list: typeof items, total: number) => {
    if (total <= MERGE_CHUNK_MAX_TRIANGLES || list.length < 2) {
      chunks.push(list.map((i) => i.mesh));
      return;
    }
    const bounds = new THREE.Box3();
    list.forEach((i) => bounds.expandByPoint(i.centre));
    const size = bounds.getSize(new THREE.Vector3());
    const axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
    const sorted = [...list].sort((a, b) => a.centre[axis] - b.centre[axis]);

    let acc = 0;
    let cut = 0;
    while (cut < sorted.length - 1 && acc + sorted[cut].tris <= total / 2) acc += sorted[cut++].tris;
    if (cut === 0) {
      acc = sorted[0].tris; // first part alone is over half: still must make progress
      cut = 1;
    }
    split(sorted.slice(0, cut), acc);
    split(sorted.slice(cut), total - acc);
  };
  split(items, items.reduce((sum, i) => sum + i.tris, 0));
  return chunks;
}

interface WorkerAttribute {
  name: string;
  itemSize: number;
  normalized: boolean;
  array: any;
}

interface WorkerResult {
  ok: boolean;
  attributes: WorkerAttribute[];
  index: Uint16Array | Uint32Array;
  pristine: Uint16Array | Uint32Array;
  box: number[];
  sphere: number[];
}

/** Small pool of workers that each transform + concatenate one chunk of meshes (see mergeWorker.ts). */
class MergeWorkerPool {
  readonly size: number;
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private pending = new Map<number, { worker: Worker; resolve: (r: WorkerResult | null) => void }>();
  private nextId = 1;

  constructor() {
    if (typeof Worker !== "undefined") {
      try {
        const count = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, MERGE_WORKER_POOL_MAX));
        for (let i = 0; i < count; i++) {
          const worker = new Worker(new URL("./mergeWorker.ts", import.meta.url), { type: "module" });
          worker.onmessage = (e: MessageEvent<WorkerResult & { id: number }>) => this.settle(e.data.id, e.data.ok ? e.data : null);
          worker.onerror = () => {
            for (const [id, p] of this.pending) if (p.worker === worker) this.settle(id, null);
          };
          this.workers.push(worker);
        }
        this.idle = [...this.workers];
      } catch {
        this.destroy();
      }
    }
    this.size = this.workers.length;
  }

  private settle(id: number, result: WorkerResult | null) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.idle.push(p.worker);
    p.resolve(result);
  }

  /** Callers keep at most `size` jobs in flight, so an idle worker always exists. */
  run(message: Record<string, unknown>, transfer: ArrayBuffer[]): Promise<WorkerResult | null> {
    const worker = this.idle.pop();
    if (!worker) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { worker, resolve });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  destroy() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.idle = [];
    this.pending.forEach((p) => p.resolve(null));
    this.pending.clear();
  }
}

/**
 * Concatenates a chunk's raw attribute and index data (a plain memcpy per mesh) into fresh buffers
 * that can be transferred to a worker, which does the per-vertex transform. Returns null when the
 * chunk isn't plain enough for that path (interleaved/morph/quantized/mismatched attributes) — the
 * caller then falls back to merging it on the main thread, which handles every case.
 */
function buildWorkerPayload(meshes: THREE.Mesh[], rootInverse: THREE.Matrix4) {
  const first = meshes[0].geometry;
  const names = Object.keys(first.attributes);
  const position = first.attributes.position;
  if (!position || position.itemSize !== 3) return null;

  const refs = names.map((name) => {
    const a = first.attributes[name] as THREE.BufferAttribute;
    return { name, itemSize: a.itemSize, normalized: a.normalized, ctor: a.array.constructor as any };
  });
  // The worker transforms these in place as floats.
  if (refs.some((r) => (r.name === "position" || r.name === "normal" || r.name === "tangent") && r.ctor !== Float32Array)) return null;

  let totalVertices = 0;
  let totalIndices = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    if (Object.keys(g.morphAttributes).length > 0) return null;
    if (Object.keys(g.attributes).length !== refs.length) return null;
    for (const r of refs) {
      const a = g.attributes[r.name] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
      if (!a || (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
      if (a.itemSize !== r.itemSize || a.normalized !== r.normalized || a.array.constructor !== r.ctor) return null;
    }
    const count = g.attributes.position.count;
    totalVertices += count;
    totalIndices += g.index ? g.index.count : count;
  }

  const attributes: WorkerAttribute[] = refs.map((r) => ({
    name: r.name,
    itemSize: r.itemSize,
    normalized: r.normalized,
    array: new r.ctor(totalVertices * r.itemSize),
  }));
  const rawIndex = new Uint32Array(totalIndices);
  const items: { matrix: number[]; vertexStart: number; vertexCount: number; indexStart: number; indexCount: number; indexed: boolean }[] = [];

  let v = 0;
  let ix = 0;
  const local = new THREE.Matrix4();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const vertexCount = g.attributes.position.count;
    attributes.forEach((out, k) => {
      const src = (g.attributes[refs[k].name] as THREE.BufferAttribute).array as ArrayLike<number>;
      out.array.set(src, v * out.itemSize);
    });
    const indexCount = g.index ? g.index.count : vertexCount;
    if (g.index) rawIndex.set(g.index.array as ArrayLike<number>, ix);
    local.multiplyMatrices(rootInverse, mesh.matrixWorld);
    items.push({ matrix: local.toArray(), vertexStart: v, vertexCount, indexStart: ix, indexCount, indexed: !!g.index });
    v += vertexCount;
    ix += indexCount;
  }

  const transfer = [rawIndex.buffer as ArrayBuffer, ...attributes.map((a) => a.array.buffer as ArrayBuffer)];
  return { message: { attributes, items, totalVertices, rawIndex }, transfer };
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
export async function mergeMeshesByMaterial(
  root: THREE.Object3D,
  isCancelled: () => boolean = () => false,
  onProgress?: (done: number, total: number) => void
): Promise<{ batches: MergedBatch[]; meshToPart: Map<THREE.Mesh, { batch: MergedBatch; part: MergedPart }> } | null> {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  tagLogicalGroups(root);

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

  const meshToPart = new Map<THREE.Mesh, { batch: MergedBatch; part: MergedPart }>();

  /** Main-thread merge of one chunk: handles every attribute layout, but is the slow path. */
  const mergeOnMainThread = (meshes: THREE.Mesh[]): { merged: THREE.BufferGeometry; pristine: Uint16Array | Uint32Array } | null => {
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
      return null;
    }
    // mergeGeometries doesn't compute bounding volumes itself — do it now
    // instead of leaving frustum culling to compute it lazily on this
    // batch's first render.
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return { merged, pristine: (merged.index.array as Uint16Array | Uint32Array).slice() as Uint16Array | Uint32Array };
  };

  /** Builds the merged geometry for one chunk, in a worker when the chunk allows it. */
  const mergeChunkGeometry = async (meshes: THREE.Mesh[]) => {
    if (pool.size > 0) {
      const payload = buildWorkerPayload(meshes, rootInverse);
      if (payload) {
        const res = await pool.run(payload.message, payload.transfer);
        if (res) {
          const merged = new THREE.BufferGeometry();
          for (const a of res.attributes) {
            merged.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
          }
          merged.setIndex(new THREE.BufferAttribute(res.index, 1));
          const [x0, y0, z0, x1, y1, z1] = res.box;
          merged.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
          merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(res.sphere[0], res.sphere[1], res.sphere[2]), res.sphere[3]);
          return { merged, pristine: res.pristine };
        }
      }
    }
    return mergeOnMainThread(meshes);
  };

  /** Wraps a merged geometry in a mesh, records its parts, and swaps it in for the originals. */
  const finishBatch = (
    meshes: THREE.Mesh[],
    material: THREE.Material,
    { merged, pristine }: { merged: THREE.BufferGeometry; pristine: Uint16Array | Uint32Array }
  ): MergedBatch => {
    // The bounds tree that makes click-picking fast is NOT built here: building it for every chunk
    // is a large synchronous cost. It is built lazily instead (see ensureBoundsTree, called from idle
    // time after loading and again right before any raycast). Always `indirect: true`: the default
    // reorders geometry.index in place, which would scramble every parts[].indexStart/indexCount
    // lookup (hide/isolate, selection, per-part edges).
    const parts: MergedPart[] = [];
    let cursor = 0;
    meshes.forEach((mesh, i) => {
      const count = mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count;
      parts.push({
        index: i,
        name: mesh.name || "(no name)",
        groupId: mesh.userData.groupId as number,
        groupName: mesh.userData.groupName as string,
        groupUserData: mesh.userData.groupUserData as Record<string, unknown>,
        indexStart: cursor,
        indexCount: count,
        hidden: false,
        lineArt: [],
      });
      cursor += count;
    });

    // Longest prefix of whole parts within the LOD budget (at least the first part).
    let lodIndexCount = parts[0].indexCount;
    for (let i = 1; i < parts.length; i++) {
      const end = parts[i].indexStart + parts[i].indexCount;
      if (end > cursor * INTERACTION_LOD_TRIANGLE_RATIO) break;
      lodIndexCount = end;
    }

    const mergedMesh = new THREE.Mesh(merged, material);
    mergedMesh.castShadow = true;
    mergedMesh.receiveShadow = true;
    mergedMesh.frustumCulled = true;
    mergedMesh.name = `Nhóm gộp (${meshes.length} bộ phận)`;
    root.add(mergedMesh);

    const batch: MergedBatch = { mesh: mergedMesh, pristineIndex: pristine, parts, lodIndexCount };
    mergedMesh.userData.mergedBatch = batch;

    meshes.forEach((mesh, i) => {
      meshToPart.set(mesh, { batch, part: parts[i] });
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    });
    return batch;
  };

  const jobs: { chunk: THREE.Mesh[]; material: THREE.Material }[] = [];
  groups.forEach((meshes, material) => {
    if (meshes.length < 2) return; // nothing to gain merging a single mesh
    splitIntoSpatialChunks(meshes, rootInverse).forEach((chunk) => jobs.push({ chunk, material }));
  });

  // Chunks are merged by a pool of workers in parallel (each transforms and concatenates one chunk),
  // with the cheap bookkeeping done here as results arrive. The main thread only memcpy's the raw
  // data into the transfer buffers, so it stays free to render and handle input throughout.
  const pool = new MergeWorkerPool();
  const slots: (MergedBatch | undefined)[] = new Array(jobs.length);
  const inFlight = new Set<Promise<void>>();
  const limit = Math.max(1, pool.size);
  let next = 0;
  let done = 0;
  let sliceStart = performance.now();
  try {
    while (next < jobs.length || inFlight.size > 0) {
      if (isCancelled()) return null;
      while (next < jobs.length && inFlight.size < limit) {
        const index = next++;
        const job = jobs[index];
        // Largest parts first, so a prefix of the index buffer is a cheap level of detail.
        const meshes = sortLargestFirst(job.chunk, rootInverse);
        const task: Promise<void> = mergeChunkGeometry(meshes)
          .then((result) => {
            if (result && !isCancelled()) slots[index] = finishBatch(meshes, job.material, result);
          })
          .catch((err) => console.error("[merge] chunk failed, left unmerged:", err))
          .finally(() => {
            inFlight.delete(task);
            onProgress?.(++done, jobs.length);
          });
        inFlight.add(task);
      }
      if (pool.size === 0) {
        // No workers: chunks merge on this thread, so yield to the renderer once per time slice.
        await Promise.all(inFlight);
        if (performance.now() - sliceStart > MERGE_FRAME_BUDGET_MS) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          sliceStart = performance.now();
        }
      } else if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }
  } finally {
    pool.destroy();
  }
  const batches = slots.filter((b): b is MergedBatch => !!b);
  if (isCancelled()) return null;

  if (batches.length > 0) {
    const originalCount = batches.reduce((sum, b) => sum + b.parts.length, 0);
    console.log(`[merge] ${originalCount} mesh → ${batches.length} draw call (theo vật liệu, chia khối không gian để culling)`);
  }

  return { batches, meshToPart };
}

/** Builds the batch's raycast acceleration tree if it doesn't have one yet. */
export function ensureBoundsTree(batch: MergedBatch) {
  const geometry = batch.mesh.geometry;
  if (!geometry.boundsTree) geometry.computeBoundsTree({ indirect: true });
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
export async function mergeLineArtByMaterial(
  root: THREE.Object3D,
  lineArtToMesh: Map<LineArtObject, THREE.Mesh>,
  meshToPart: Map<THREE.Mesh, { batch: MergedBatch; part: MergedPart }>,
  isCancelled: () => boolean = () => false,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
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

  // A whole model's line-art can share one material (tens of thousands of objects), so split each
  // group into chunks and merge a few chunks per frame, like mergeMeshesByMaterial.
  const jobs: { material: THREE.Material; kind: LineArtKind; objects: LineArtObject[] }[] = [];
  groups.forEach(({ material, kind, objects }) => {
    for (let i = 0; i < objects.length; i += LINE_ART_CHUNK_OBJECTS) {
      jobs.push({ material, kind, objects: objects.slice(i, i + LINE_ART_CHUNK_OBJECTS) });
    }
  });

  let sliceStart = performance.now();
  let jobIndex = 0;
  for (const { material, kind, objects } of jobs) {
    if (isCancelled()) return mergedCount;
    onProgress?.(jobIndex++, jobs.length);
    if (performance.now() - sliceStart > MERGE_FRAME_BUDGET_MS) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      sliceStart = performance.now();
    }
    if (objects.length < 2) continue;

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
      continue; // incompatible attributes — leave these as individual objects
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
  }

  return mergedCount;
}
