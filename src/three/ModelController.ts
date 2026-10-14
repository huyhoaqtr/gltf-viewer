import * as THREE from "three";
import "./bvhSetup";
import type { OrbitControls } from "three-stdlib";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BundledDRACOLoader } from "./BundledDRACOLoader";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import { EdgesOverlayBuilder, type EdgeStyle } from "./edgesOverlay";
import { ModelBuilder } from "./modelBuilder";
import { SelectionController } from "./selection";
import { applyOrientation, type OrientationState } from "./orientation";
import { applyMaterialStyle, computeStats, disposeObject3D } from "./modelStyling";
import { REVEAL_TRIANGLES_PER_FRAME } from "./constants";
import { mergeMeshesByMaterial, mergeLineArtByMaterial, findLineArtSiblings, ensureBoundsTree, type MergedBatch } from "./meshMerging";
import type { ModelStats, ViewerSettings } from "../types/viewer";

export interface ModelControllerCallbacks {
  onStats: (stats: ModelStats | null) => void;
  onLoadingProgress: (loading: boolean, text?: string) => void;
  /** Overall progress of opening a model (0..1), or null when idle. Only ever increases within one load. */
  onProgress: (fraction: number | null) => void;
  onSelectionChange: (name: string | null) => void;
  onHiddenChange: (hasHidden: boolean) => void;
  onToast: (message: string) => void;
  onFileName: (name: string | null) => void;
  /** Reports the framed model's bounds so the R3F scene can size ground/shadows/sun. */
  onFrame: (frame: FrameInfo) => void;
}

/** Where each loading stage ends on the overall 0..1 progress bar. */
const PROGRESS = {
  downloaded: 0.08,
  parsed: 0.4,
  styled: 0.42,
  merged: 0.76,
  lineArt: 0.84,
  compiled: 0.87,
  revealed: 0.94,
} as const;

export interface FrameInfo {
  radius: number;
  center: [number, number, number];
  minY: number;
}

/** Lets a display mode (e.g. hologram) react to the model's lifecycle. */
export interface ModelHooks {
  /** Model finished loading and merging — all final meshes now exist. */
  afterMerge?: (root: THREE.Object3D) => void;
  /** Model is about to be disposed — undo anything that must not be disposed with it. */
  beforeClear?: (root: THREE.Object3D) => void;
}

export interface ModelControllerDeps {
  pivot: THREE.Group;
  getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera;
  getControls: () => OrbitControls | null;
  getSettings: () => ViewerSettings;
  /** Edges overlay on/off for the active view mode (see selectEdgesEnabled). */
  getEdgesEnabled: () => boolean;
  /** Used to compile shaders asynchronously before the model is first drawn. */
  getRenderer: () => THREE.WebGLRenderer;
  getScene: () => THREE.Scene;
}

/**
 * Owns the loaded glTF model and everything that mutates its scene graph
 * imperatively (progressive attach, mesh merging, edges overlay, selection,
 * hide/isolate). Renderer, scene, camera, lights, controls and the cube
 * gizmo are R3F components now — this class only receives the pieces it needs
 * through `deps`. It has no React dependency.
 */
export class ModelController {
  private edgesBuilder = new EdgesOverlayBuilder();
  private modelBuilder = new ModelBuilder();
  private selection: SelectionController;
  private gltfLoader: GLTFLoader;
  private raycaster = new THREE.Raycaster();

  private currentRoot: THREE.Object3D | null = null;
  private mergedBatches: MergedBatch[] = [];
  private box = new THREE.Box3();
  private sphere = new THREE.Sphere();

  private hooks: ModelHooks = {};
  private ready = false;
  private restyleScheduled = false;
  private disposed = false;

  constructor(
    private deps: ModelControllerDeps,
    private callbacks: ModelControllerCallbacks
  ) {
    const dracoLoader = new BundledDRACOLoader();
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    this.selection = new SelectionController(
      () => this.currentRoot,
      {
        onSelectionChange: (name) => this.callbacks.onSelectionChange(name),
        onHiddenChange: (v) => {
          this.callbacks.onHiddenChange(v);
          // Don't rely on three.js's implicit "invisible parent hides its
          // children" render-time behavior for the edges overlay — it's
          // inconsistent across some BIM/CAD-exported node hierarchies.
          // Explicitly re-sync every edge line's own `visible` flag instead;
          // cheap (one pass over the small `lines` array), unlike a rebuild.
          this.updateEdgeVisibility();
        },
      }
    );

    // Boot the edges worker pool now (loading the three.js module into each
    // worker) instead of on the first "edges" build, so that startup cost
    // isn't sitting on the critical path when the user actually loads a
    // model — it overlaps with file-picking/dragging time instead.
    this.edgesBuilder.warmUp();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.interactionTimer);
    this.clearModel();
    this.edgesBuilder.destroyWorkers();
  }

  setHooks(hooks: ModelHooks | null) {
    this.hooks = hooks ?? {};
  }

  /** The model root once it is fully loaded and merged; null while streaming in or empty. */
  getReadyRoot(): THREE.Object3D | null {
    return this.ready ? this.currentRoot : null;
  }

  /** Re-apply the selection outline's screen resolution after a canvas resize. */
  onResize() {
    this.selection.onResize();
  }

  // ---------------------------------------------------------------------
  // Model loading
  // ---------------------------------------------------------------------

  loadFile(file: File) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".glb") && !lower.endsWith(".gltf")) {
      this.callbacks.onToast("Chỉ hỗ trợ file .glb hoặc .gltf.");
      return;
    }
    const url = URL.createObjectURL(file);
    this.loadGLTF(url, file.name);
  }

  private loadGLTF(url: string, name: string) {
    this.callbacks.onLoadingProgress(true, "Đang tải model…");
    this.clearModel();
    this.startProgress();
    this.gltfLoader.load(
      url,
      (gltf) => {
        this.stopParseTimer();
        this.reportProgress(PROGRESS.parsed);
        const root = gltf.scene || gltf.scenes[0];
        this.currentRoot = root;
        // The root stays OUT of the scene until it has been styled, merged and its shaders compiled.
        // Drawing the raw model first meant uploading and rendering thousands of tiny meshes that
        // are thrown away a moment later — the dominant cause of the tab freezing on big models.
        // The full-screen spinner stays up meanwhile; it is hidden once the merged parts start showing.
        this.callbacks.onLoadingProgress(true, "Đang xử lý model…");

        const stats = computeStats(root);
        this.callbacks.onStats(stats);

        this.callbacks.onFileName(name);
        URL.revokeObjectURL(url);

        this.modelBuilder.build(
          root,
          this.styleOptions(),
          () => {},
          async () => {
            const cancelled = () => this.disposed || this.currentRoot !== root;
            this.reportProgress(PROGRESS.styled);
            // Fold small same-material meshes into few big draw calls — ungrouped BIM/CAD exports can
            // have tens of thousands of tiny separate meshes, and draw-call count (not triangle count)
            // is what actually tanks frame rate for those.
            // Record mesh↔line-art sibling pairs (see findLineArtSiblings) *before* merging removes
            // the original mesh nodes, so mergeLineArtByMaterial can link each folded line-art's new
            // slice back to the part it belongs to, for hide/isolate to mask together.
            const lineArtToMesh = findLineArtSiblings(root);
            // Time-sliced across frames (see mergeMeshesByMaterial) so the tab stays responsive.
            const merged = await mergeMeshesByMaterial(root, cancelled, (done, total) =>
              this.reportProgress(PROGRESS.styled + (PROGRESS.merged - PROGRESS.styled) * (done / total))
            );
            if (!merged || cancelled()) return; // another model was loaded (or the viewer closed) meanwhile
            const { batches, meshToPart } = merged;
            this.mergedBatches = batches;
            this.selection.setMergedBatches(this.mergedBatches);
            await mergeLineArtByMaterial(root, lineArtToMesh, meshToPart, cancelled, (done, total) =>
              this.reportProgress(PROGRESS.merged + (PROGRESS.lineArt - PROGRESS.merged) * (done / total))
            );
            this.reportProgress(PROGRESS.lineArt);
            if (cancelled()) return;

            // Compile the (few) final shader programs without blocking: the first draw would
            // otherwise stall the main thread while the driver links them.
            try {
              await this.deps.getRenderer().compileAsync(root, this.deps.getCamera(), this.deps.getScene());
            } catch {
              /* compiling lazily on first draw still works */
            }
            if (cancelled()) return;
            this.reportProgress(PROGRESS.compiled);

            // Attach with the merged batches hidden, then reveal them a few at a time so their
            // GPU upload is spread over many frames and the viewport stays interactive.
            batches.forEach((batch) => (batch.mesh.visible = false));
            this.deps.pivot.add(root);
            this.frameModel();
            this.callbacks.onLoadingProgress(false);
            await this.revealBatches(batches, cancelled);
            if (cancelled()) return;
            this.reportProgress(PROGRESS.revealed);

            this.frameModel(); // refreshes the shadow map now that everything is visible
            if (this.deps.getEdgesEnabled()) {
              this.scheduleEdgesBuild(root);
            } else {
              this.finishProgress();
            }
            this.updateEdgeVisibility();
            this.setModelLinesVisible(this.deps.getSettings().showModelLines);
            this.ready = true;
            this.scheduleBoundsTrees(root);
            this.hooks.afterMerge?.(root);
          }
        );
      },
      (evt) => {
        if (evt.total) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          this.callbacks.onLoadingProgress(true, `Đang tải model… ${pct}%`);
          this.reportProgress(PROGRESS.downloaded * (evt.loaded / evt.total));
        }
      },
      (err) => {
        console.error(err);
        this.stopParseTimer();
        this.callbacks.onProgress(null);
        this.callbacks.onLoadingProgress(false);
        this.callbacks.onToast("Không mở được file này. Hãy chắc chắn đó là .glb hoặc .gltf hợp lệ.");
        URL.revokeObjectURL(url);
      }
    );
  }

  private clearModel() {
    this.stopParseTimer();
    clearTimeout(this.progressHideTimer);
    this.selection.reset();
    this.edgesBuilder.cancel();
    this.modelBuilder.cancel();
    this.ready = false;
    if (this.currentRoot) {
      this.hooks.beforeClear?.(this.currentRoot);
      this.deps.pivot.remove(this.currentRoot);
      disposeObject3D(this.currentRoot);
      this.currentRoot = null;
    }
    this.mergedBatches = [];
    this.edgesBuilder.dispose();
    this.callbacks.onStats(null);
  }

  private updateEdgeVisibility() {
    const show = this.deps.getEdgesEnabled();
    this.edgesBuilder.lines.forEach((line) => {
      line.visible = show && !!line.parent && line.parent.visible;
    });
  }

  // While the camera moves: fewer parts are drawn (see applyInteractionLod). Edges always stay visible.
  private interacting = false;
  private interactionTimer: ReturnType<typeof setTimeout> | undefined;

  beginInteraction() {
    clearTimeout(this.interactionTimer);
    if (this.interacting) return;
    this.interacting = true;
    this.applyInteractionLod(true);
  }

  /** While moving, draw only each batch's largest parts (cheap LOD); draw everything again when settled. */
  private applyInteractionLod(active: boolean) {
    const enabled = active && this.deps.getSettings().lodWhileMoving;
    for (const batch of this.mergedBatches) {
      batch.mesh.geometry.setDrawRange(0, enabled ? batch.lodIndexCount : Infinity);
      // Edges stay visible, but only those of the parts still being drawn (parts and edge ranges share order).
      const edges = batch.edges;
      if (!edges) continue;
      let kept = 0;
      while (kept < batch.parts.length && batch.parts[kept].indexStart + batch.parts[kept].indexCount <= batch.lodIndexCount) kept++;
      const last = edges.ranges[Math.max(kept, 1) - 1];
      edges.line.geometry.setDrawRange(0, enabled && last ? last.indexStart + last.indexCount : Infinity);
    }
  }

  /** The camera stopped (or is about to): restore the overlay after a short grace period for damping. */
  endInteraction(delayMs = 250) {
    clearTimeout(this.interactionTimer);
    this.interactionTimer = setTimeout(() => {
      this.interacting = false;
      this.applyInteractionLod(false);
    }, delayMs);
  }

  /** For camera moves with no start/end events (e.g. the view-cube animation). */
  pulseInteraction() {
    this.beginInteraction();
    this.endInteraction();
  }

  // ---------------------------------------------------------------------
  // Overall load progress (0..1), shown as a bar at the top of the window
  // ---------------------------------------------------------------------

  private progress = 0;
  private parseTimer: ReturnType<typeof setInterval> | undefined;
  private progressHideTimer: ReturnType<typeof setTimeout> | undefined;

  private startProgress() {
    this.progress = 0;
    this.callbacks.onProgress(0);
    // Parsing reports no progress of its own, so ease toward the end of its share while it runs.
    const started = performance.now();
    this.parseTimer = setInterval(() => {
      const t = (performance.now() - started) / 8000;
      this.reportProgress(PROGRESS.downloaded + (PROGRESS.parsed - PROGRESS.downloaded) * (1 - Math.exp(-t)) * 0.95);
    }, 250);
  }

  private stopParseTimer() {
    clearInterval(this.parseTimer);
    this.parseTimer = undefined;
  }

  private reportProgress(p: number) {
    if (p <= this.progress) return;
    this.progress = Math.min(p, 1);
    this.callbacks.onProgress(this.progress);
  }

  /** Reaches 100%, then clears the bar shortly after so it can fade out. */
  private finishProgress() {
    this.reportProgress(1);
    clearTimeout(this.progressHideTimer);
    this.progressHideTimer = setTimeout(() => this.callbacks.onProgress(null), 700);
  }

  /** Makes merged batches visible a few frames at a time, bounded by triangles per frame. */
  private async revealBatches(batches: MergedBatch[], cancelled: () => boolean) {
    let budget = REVEAL_TRIANGLES_PER_FRAME;
    let shown = 0;
    for (const batch of batches) {
      const triangles = batch.pristineIndex.length / 3;
      if (budget < triangles && budget < REVEAL_TRIANGLES_PER_FRAME) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled()) return;
        budget = REVEAL_TRIANGLES_PER_FRAME;
      }
      batch.mesh.visible = true;
      budget -= triangles;
      this.reportProgress(PROGRESS.compiled + (PROGRESS.revealed - PROGRESS.compiled) * (++shown / batches.length));
    }
  }

  /** Builds the picking trees one batch at a time in idle periods (they are also built on demand before a pick). */
  private scheduleBoundsTrees(root: THREE.Object3D) {
    const queue = this.mergedBatches.filter((b) => !b.mesh.geometry.boundsTree);
    const run = (deadline?: IdleDeadline) => {
      if (this.currentRoot !== root) return;
      do {
        const batch = queue.shift();
        if (!batch) return;
        ensureBoundsTree(batch);
      } while (queue.length > 0 && deadline && deadline.timeRemaining() > 8);
      schedule();
    };
    const schedule = () => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
      else setTimeout(() => run(), 50);
    };
    schedule();
  }

  private ensureAllBoundsTrees() {
    for (const batch of this.mergedBatches) ensureBoundsTree(batch);
  }

  // Starting the edges build right when a model finishes loading means its
  // main-thread work (reconstructing THREE.LineSegments from each worker
  // batch) directly competes with the browser's own first-render GPU upload
  // for that same freshly-attached model (shader compiles, buffer uploads),
  // which can make that normally-sub-second reconstruction step take many
  // seconds instead. requestIdleCallback lets the browser finish that first
  // render/paint before we spend CPU on edges — falls back to a short
  // setTimeout on browsers without it (Safari).
  private scheduleEdgesBuild(root: THREE.Object3D) {
    const start = () => {
      if (this.currentRoot !== root || !this.deps.getEdgesEnabled()) return; // model changed or toggled off meanwhile
      this.edgesBuilder.build(
        root,
        () => {
          this.updateEdgeVisibility();
          if (this.currentRoot !== root) return;
          this.reportProgress(PROGRESS.revealed + (1 - PROGRESS.revealed) * this.edgesBuilder.progress);
          if (this.edgesBuilder.built) this.finishProgress();
        },
        this.deps.getSettings().edgeAngle
      );
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(start, { timeout: 1000 });
    } else {
      setTimeout(start, 100);
    }
  }

  // ---------------------------------------------------------------------
  // Camera framing
  // ---------------------------------------------------------------------

  fitToView() {
    this.frameModel();
  }

  frameModel() {
    const controls = this.deps.getControls();
    if (!this.currentRoot || !controls) return;
    const camera = this.deps.getCamera();
    this.box.setFromObject(this.deps.pivot);
    this.box.getBoundingSphere(this.sphere);
    const radius = Math.max(this.sphere.radius, 0.01);
    const center = this.sphere.center;

    controls.target.copy(center);
    const dir = new THREE.Vector3(0.65, 0.5, 0.9).normalize();
    camera.position.copy(center).addScaledVector(dir, radius * 2.6);
    camera.near = Math.max(radius / 500, 0.001);
    camera.far = radius * 200;
    camera.updateProjectionMatrix();
    controls.update();

    this.callbacks.onFrame({ radius, center: [center.x, center.y, center.z], minY: this.box.min.y });
  }

  // ---------------------------------------------------------------------
  // Settings driven by the store (called from R3F effects)
  // ---------------------------------------------------------------------

  private styleOptions() {
    const { flattenMetal, doubleSided } = this.deps.getSettings();
    return { flattenMetal, doubleSided };
  }

  // Material settings can fire continuously (much faster than 60/sec on some
  // devices); applyMaterialStyle() walks every
  // mesh in the model, which is expensive on models with hundreds of parts.
  // Coalesce repeated calls into at most one pass per animation frame.
  scheduleRestyle() {
    if (this.restyleScheduled) return;
    this.restyleScheduled = true;
    requestAnimationFrame(() => {
      this.restyleScheduled = false;
      if (this.currentRoot && !this.disposed) applyMaterialStyle(this.currentRoot, this.styleOptions());
    });
  }

  setOrientation(state: OrientationState) {
    applyOrientation(this.deps.pivot, state);
    this.frameModel();
  }

  setEdgeStyle(style: EdgeStyle | null) {
    this.edgesBuilder.setStyleOverride(style);
  }

  setSelectionColors(edge: string, fill: string) {
    this.selection.setColors(edge, fill);
  }

  /** The edge angle setting changed: throw the built edges away and rebuild them with the new threshold. */
  rebuildEdges() {
    if (!this.currentRoot || !this.modelBuilder.built) return;
    this.mergedBatches.forEach((b) => {
      b.edges = undefined;
    });
    this.edgesBuilder.clear();
    if (this.deps.getEdgesEnabled()) this.scheduleEdgesBuild(this.currentRoot);
  }

  /**
   * Shows/hides the line geometry that ships inside the glTF (CAD/BIM exports often bake in outlines
   * and tessellation lines), as opposed to the viewer's own edges overlay. Done through the line
   * materials, so it survives hide/isolate/show-all toggling the objects' own `visible` flags.
   */
  setModelLinesVisible(visible: boolean) {
    this.currentRoot?.traverse((obj) => {
      const line = obj as THREE.Line;
      if (!line.isLine || line.userData.isEdgeOverlay) return;
      const mats = Array.isArray(line.material) ? line.material : [line.material];
      mats.forEach((m) => {
        m.visible = visible;
      });
    });
  }

  setShowEdges(v: boolean) {
    // Only build now if the model itself has finished progressively
    // attaching — building against a still-streaming-in root would only see
    // whatever parts happened to be attached so far. If the model is still
    // loading, just leave the flag set: loadGLTF's modelBuilder "onDone"
    // already builds edges when showEdges is true.
    if (v && this.currentRoot && this.modelBuilder.built && !this.edgesBuilder.built) {
      this.scheduleEdgesBuild(this.currentRoot);
    }
    this.updateEdgeVisibility();
  }

  hideSelected() {
    this.selection.hideSelected();
  }
  isolateSelected() {
    this.selection.isolateSelected();
  }
  showAllObjects() {
    this.selection.showAll();
  }
  clearSelection() {
    this.selection.clear();
  }

  // Click (not drag) on the model selects the part under the cursor; a click
  // on empty space clears the selection. The caller decides "was this a
  // click" from the down/up distance so normal orbit-dragging is unaffected.
  handleModelClick(clientX: number, clientY: number, dom: HTMLElement) {
    if (!this.currentRoot) return;
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.deps.getCamera());
    // A click also fires the camera start/end events; picking must see every part, not just the LOD subset.
    this.applyInteractionLod(false);
    this.ensureAllBoundsTrees();
    const hits = this.raycaster.intersectObject(this.currentRoot, true);
    this.selection.pickFromRaycast(hits);
  }

  /** Surface point under the cursor, in the pivot's local space (so it follows orientation changes). */
  pickLocalPoint(clientX: number, clientY: number, dom: HTMLElement): THREE.Vector3 | null {
    if (!this.currentRoot) return null;
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.deps.getCamera());
    this.applyInteractionLod(false);
    this.ensureAllBoundsTrees();
    const hit = this.raycaster.intersectObject(this.currentRoot, true)[0];
    if (!hit) return null;
    this.deps.pivot.updateMatrixWorld();
    return this.deps.pivot.worldToLocal(hit.point.clone());
  }
}
