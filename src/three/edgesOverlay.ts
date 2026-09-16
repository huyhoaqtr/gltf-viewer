import * as THREE from "three";
import {
  EDGE_BUILD_FRAME_BUDGET_MS,
  EDGE_COLOR,
  EDGE_THRESHOLD_ANGLE,
  EDGE_WORKER_BATCH_MESH_COUNT,
  EDGE_WORKER_BATCH_VERTEX_COUNT,
  EDGE_WORKER_POOL_MAX,
} from "./constants";
import { extractPartGeometry, type MergedBatch, type EdgeRange } from "./meshMerging";

export interface EdgeOverlayLine extends THREE.LineSegments {
  userData: { isEdgeOverlay: true };
}

/** A job either computes edges for one whole (unmerged) mesh, or for one
 * part inside a merged batch — the two are assembled differently once
 * their worker results come back (see JobTarget). */
type JobTarget = { kind: "mesh"; mesh: THREE.Mesh } | { kind: "batchPart"; batch: MergedBatch; partIndex: number };

interface EdgeJob {
  id: number;
  target: JobTarget;
  position: Float32Array;
  index: Uint16Array | Uint32Array | null;
}

interface WorkerResponse {
  token: number;
  results: { id: number; positions: Float32Array | null }[];
}

/** Accumulates per-part results for one batch until all its parts are back,
 * then assembles them into a single indexed LineSegments (see meshMerging's
 * MergedBatchEdges) so a part's edges can be masked instantly later instead
 * of rebuilding the whole overlay. */
interface BatchAccumulator {
  batch: MergedBatch;
  partPositions: (Float32Array | null)[];
  pending: number;
}

/**
 * Builds the passive "edges" overlay. EdgesGeometry is pure CPU math
 * (hashing/comparing triangle edges, no DOM or GPU access), so the work is
 * farmed out to a pool of Web Workers — real BIM/CAD exports can have tens
 * of thousands of small parts, and computing those in parallel across cores
 * is the only way to make that fast; time-slicing it on the main thread
 * (the fallback below) only trades wall-clock time for UI smoothness, it
 * doesn't reduce the total work.
 *
 * For a merged draw batch (see meshMerging.ts), edges are computed *per
 * original part* (not once for the whole batch) and then combined into one
 * indexed LineSegments per batch — same shape as the solid mesh's own
 * index — so hiding/isolating a part can mask just its edge segments
 * in-place afterwards (see meshMerging's setPartVisible) instead of
 * recomputing hundreds of thousands of segments on every click.
 */
export class EdgesOverlayBuilder {
  lines: EdgeOverlayLine[] = [];
  built = false;

  private token = 0;
  private material: THREE.LineBasicMaterial | null = null;
  private workers: Worker[] = [];

  // Mutable state for whichever build is currently "current" (this.token).
  private currentBatches: EdgeJob[][] = [];
  private currentNextBatchIndex = 0;
  private currentPendingBatches = 0;
  private currentJobTargets = new Map<number, JobTarget>();
  private currentBatchAccum = new Map<MergedBatch, BatchAccumulator>();
  private currentOnProgress?: () => void;
  private currentStartedAt = 0;

  /** Starts the worker pool early (e.g. right after the viewer mounts) so its
   * one-time startup cost (each worker loading the three.js module) isn't
   * paid on the critical path of the first edges build. Safe to call more
   * than once — a no-op once the pool exists. */
  warmUp() {
    this.ensureWorkers();
  }

  /** Cancels any build currently in progress without disposing state. */
  cancel() {
    this.token++;
    // Drop any not-yet-dispatched batches so a worker freed up by a stale
    // response can't be handed leftover work from the build we just left.
    this.currentBatches = [];
    this.currentNextBatchIndex = 0;
    this.currentPendingBatches = 0;
    this.currentBatchAccum.clear();
  }

  build(root: THREE.Object3D, onProgress?: () => void) {
    this.token++;
    const token = this.token;
    // Drop any lines from a previous build of this same model — otherwise
    // they stay attached forever, doubling up with the new ones.
    this.lines.forEach((line) => {
      line.parent?.remove(line);
      line.geometry.dispose();
    });
    this.lines = [];
    this.built = false;
    this.material?.dispose();
    this.material = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.55 });
    this.currentStartedAt = performance.now();
    this.currentOnProgress = onProgress;
    this.currentBatchAccum.clear();

    const jobTargets: JobTarget[] = [];
    const seenBatches = new Set<MergedBatch>();
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh & { isLineSegments2?: boolean };
      // LineSegments2 (the selection outline) is implemented as a THREE.Mesh
      // subclass, so `isMesh` is true for it too — exclude it explicitly.
      if (!mesh.isMesh || !mesh.geometry || mesh.isLineSegments2) return;

      const batch = mesh.userData.mergedBatch as MergedBatch | undefined;
      if (batch) {
        if (seenBatches.has(batch)) return; // already expanded into per-part jobs
        seenBatches.add(batch);
        batch.parts.forEach((_, partIndex) => jobTargets.push({ kind: "batchPart", batch, partIndex }));
      } else {
        jobTargets.push({ kind: "mesh", mesh });
      }
    });

    seenBatches.forEach((batch) => {
      this.currentBatchAccum.set(batch, {
        batch,
        partPositions: new Array(batch.parts.length).fill(null),
        pending: batch.parts.length,
      });
    });

    const workers = this.ensureWorkers();
    if (workers.length === 0) {
      this.buildOnMainThread(jobTargets, token, onProgress);
      return;
    }

    const idMap = new Map<number, JobTarget>();
    const jobs: EdgeJob[] = [];
    jobTargets.forEach((target, id) => {
      let position: Float32Array | undefined;
      let index: Uint16Array | Uint32Array | null = null;
      if (target.kind === "mesh") {
        position = target.mesh.geometry.attributes.position?.array as Float32Array | undefined;
        index = (target.mesh.geometry.index?.array as Uint16Array | Uint32Array | undefined) ?? null;
      } else {
        // Already resolved through pristineIndex into a flat triangle-soup
        // position array — no index needed, matching extractPartGeometry.
        const partGeo = extractPartGeometry(target.batch, target.batch.parts[target.partIndex]);
        position = partGeo.attributes.position.array as Float32Array;
      }
      if (!position) return;
      idMap.set(id, target);
      jobs.push({ id, target, position, index });
    });

    const batches: EdgeJob[][] = [];
    let current: EdgeJob[] = [];
    let currentVerts = 0;
    for (const job of jobs) {
      const vertCount = job.position.length / 3;
      if (
        current.length > 0 &&
        (current.length >= EDGE_WORKER_BATCH_MESH_COUNT || currentVerts + vertCount > EDGE_WORKER_BATCH_VERTEX_COUNT)
      ) {
        batches.push(current);
        current = [];
        currentVerts = 0;
      }
      current.push(job);
      currentVerts += vertCount;
    }
    if (current.length > 0) batches.push(current);

    this.currentJobTargets = idMap;
    this.currentBatches = batches;
    this.currentNextBatchIndex = 0;
    this.currentPendingBatches = batches.length;

    if (batches.length === 0) {
      this.built = true;
      return;
    }

    workers.forEach((w) => this.dispatchNext(w));
  }

  private ensureWorkers(): Worker[] {
    if (this.workers.length > 0) return this.workers;
    if (typeof Worker === "undefined") return [];
    try {
      const count = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, EDGE_WORKER_POOL_MAX));
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL("./edgesWorker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleWorkerMessage(worker, e);
        worker.onerror = (ev) => {
          console.error("[edges] worker error:", ev.message);
          this.currentPendingBatches = Math.max(0, this.currentPendingBatches - 1);
          if (this.currentPendingBatches === 0) this.built = true;
          this.dispatchNext(worker);
        };
        this.workers.push(worker);
      }
    } catch (err) {
      console.error("[edges] failed to start worker pool, falling back to main thread:", err);
      this.workers.forEach((w) => w.terminate());
      this.workers = [];
    }
    return this.workers;
  }

  private dispatchNext(worker: Worker) {
    if (this.currentNextBatchIndex >= this.currentBatches.length) return;
    const batch = this.currentBatches[this.currentNextBatchIndex++];
    const items = batch.map((j) => ({ id: j.id, position: j.position, index: j.index }));
    worker.postMessage({ token: this.token, items, threshold: EDGE_THRESHOLD_ANGLE });
  }

  private handleWorkerMessage(worker: Worker, e: MessageEvent<WorkerResponse>) {
    const { token: msgToken, results } = e.data;
    if (msgToken === this.token) {
      for (const r of results) {
        const target = this.currentJobTargets.get(r.id);
        if (!target) continue;
        if (target.kind === "mesh") {
          if (r.positions) this.attachMeshLine(target.mesh, r.positions);
        } else {
          this.receiveBatchPart(target.batch, target.partIndex, r.positions);
        }
      }
      this.currentPendingBatches--;
      this.currentOnProgress?.();
      if (this.currentPendingBatches === 0) {
        this.built = true;
        this.logCompletion();
      }
    }
    // Free either way — if this was a stale batch, hand the worker whatever
    // is next in the CURRENT build's queue (a no-op if there is none).
    this.dispatchNext(worker);
  }

  private attachMeshLine(mesh: THREE.Mesh, positions: Float32Array) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.computeBoundingSphere();
    const seg = new THREE.LineSegments(geo, this.material!) as unknown as EdgeOverlayLine;
    seg.raycast = () => {};
    seg.frustumCulled = true;
    seg.userData.isEdgeOverlay = true;
    mesh.add(seg);
    this.lines.push(seg);
  }

  private receiveBatchPart(batch: MergedBatch, partIndex: number, positions: Float32Array | null) {
    const accum = this.currentBatchAccum.get(batch);
    if (!accum) return;
    accum.partPositions[partIndex] = positions;
    accum.pending--;
    if (accum.pending === 0) this.assembleBatchEdges(accum);
  }

  /** Concatenates every part's edge segments into one indexed LineSegments,
   * with a trivial sequential index (same trick as the solid mesh) so a
   * part's range can later be masked to a degenerate segment in place. */
  private assembleBatchEdges(accum: BatchAccumulator) {
    const { batch, partPositions } = accum;
    let totalVerts = 0;
    for (const p of partPositions) totalVerts += p ? p.length / 3 : 0;

    const positions = new Float32Array(totalVerts * 3);
    const ranges: EdgeRange[] = new Array(partPositions.length);
    let cursor = 0;
    partPositions.forEach((p, partIndex) => {
      const count = p ? p.length / 3 : 0;
      if (p) positions.set(p, cursor * 3);
      ranges[partIndex] = { indexStart: cursor, indexCount: count };
      cursor += count;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const IndexArray = totalVerts > 65535 ? Uint32Array : Uint16Array;
    const identityIndex = new IndexArray(totalVerts).map((_, i) => i);
    geo.setIndex(new THREE.BufferAttribute(identityIndex, 1));

    geo.computeBoundingSphere();
    const line = new THREE.LineSegments(geo, this.material!) as unknown as EdgeOverlayLine;
    line.raycast = () => {};
    line.frustumCulled = true;
    line.userData.isEdgeOverlay = true;
    batch.mesh.add(line);
    this.lines.push(line);

    batch.edges = {
      line,
      pristineIndex: (identityIndex as Uint16Array | Uint32Array).slice() as Uint32Array,
      ranges,
    };
    // A part hidden before edges finished building (hide/isolate raced the
    // async build) has no live edge segments yet — mask it now that they exist.
    batch.parts.forEach((part) => {
      if (part.hidden) {
        const range = ranges[part.index];
        const idx = geo.getIndex()!.array as Uint16Array | Uint32Array;
        idx.fill(0, range.indexStart, range.indexStart + range.indexCount);
        geo.getIndex()!.needsUpdate = true;
      }
    });
  }

  private logCompletion() {
    const segmentCount = this.lines.reduce(
      (sum, line) => sum + (line.geometry.index ? line.geometry.index.count : (line.geometry.attributes.position?.count ?? 0)) / 2,
      0
    );
    const ms = performance.now() - this.currentStartedAt;
    console.log(
      `[edges] ${this.lines.length} nhóm, ${Math.round(segmentCount)} đoạn cạnh, hoàn tất trong ${ms.toFixed(1)}ms`
    );
  }

  /** No-Worker-support fallback: same time-boxed main-thread loop as before. */
  private buildOnMainThread(jobTargets: JobTarget[], token: number, onProgress?: () => void) {
    let i = 0;
    const step = () => {
      if (token !== this.token) return; // superseded by a newer build/load
      const deadline = performance.now() + EDGE_BUILD_FRAME_BUDGET_MS;
      while (i < jobTargets.length && performance.now() < deadline) {
        const target = jobTargets[i++];
        try {
          if (target.kind === "mesh") {
            const eg = new THREE.EdgesGeometry(target.mesh.geometry, EDGE_THRESHOLD_ANGLE);
            const positions = eg.attributes.position.array as Float32Array;
            eg.dispose();
            this.attachMeshLine(target.mesh, positions);
          } else {
            const partGeo = extractPartGeometry(target.batch, target.batch.parts[target.partIndex]);
            const eg = new THREE.EdgesGeometry(partGeo, EDGE_THRESHOLD_ANGLE);
            partGeo.dispose();
            const positions = eg.attributes.position.array as Float32Array;
            eg.dispose();
            this.receiveBatchPart(target.batch, target.partIndex, positions);
          }
        } catch {
          if (target.kind === "batchPart") this.receiveBatchPart(target.batch, target.partIndex, null);
          // very dense / degenerate geometry — skip silently
        }
      }
      onProgress?.();
      if (i < jobTargets.length) {
        requestAnimationFrame(step);
      } else {
        this.built = true;
        this.logCompletion();
      }
    };
    step();
  }

  /** Cancels any in-flight build and releases GPU resources. Keeps the worker pool alive for reuse. */
  dispose() {
    this.cancel();
    this.lines = [];
    this.material?.dispose();
    this.material = null;
    this.built = false;
  }

  /** Terminates the worker pool. Call only on final teardown, not per-file-load. */
  destroyWorkers() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}
