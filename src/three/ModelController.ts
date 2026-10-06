import * as THREE from "three";
import "./bvhSetup";
import type { OrbitControls } from "three-stdlib";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import { EdgesOverlayBuilder, type EdgeStyle } from "./edgesOverlay";
import { ModelBuilder } from "./modelBuilder";
import { SelectionController } from "./selection";
import { applyOrientation, type OrientationState } from "./orientation";
import { applyMaterialStyle, computeStats, disposeObject3D } from "./modelStyling";
import { mergeMeshesByMaterial, mergeLineArtByMaterial, findLineArtSiblings, type MergedBatch } from "./meshMerging";
import { DRACO_DECODER_PATH } from "./constants";
import type { ModelStats, ViewerSettings } from "../types/viewer";

export interface ModelControllerCallbacks {
  onStats: (stats: ModelStats | null) => void;
  onLoadingProgress: (loading: boolean, text?: string) => void;
  onSelectionChange: (name: string | null) => void;
  onHiddenChange: (hasHidden: boolean) => void;
  onToast: (message: string) => void;
  onFileName: (name: string | null) => void;
  /** Reports the framed model's bounds so the R3F scene can size ground/shadows/sun. */
  onFrame: (frame: FrameInfo) => void;
}

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
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
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
    this.gltfLoader.load(
      url,
      (gltf) => {
        const root = gltf.scene || gltf.scenes[0];
        this.currentRoot = root;
        // Attach the (still-empty, children detached below) root now so the
        // scene graph / camera-framing math has a stable container from the
        // start — parts get reparented into it progressively.
        this.deps.pivot.add(root);

        const stats = computeStats(root);
        this.callbacks.onStats(stats);

        this.callbacks.onFileName(name);
        // Parsing is done — hide the full-screen spinner now and let the
        // model stream into the viewport batch by batch instead of making
        // the user wait for the whole thing to attach.
        this.callbacks.onLoadingProgress(false);
        URL.revokeObjectURL(url);

        let framedOnce = false;
        this.modelBuilder.build(
          root,
          this.styleOptions(),
          () => {
            // Rough frame as soon as the first batch is visible so the user
            // isn't staring at an empty viewport; refined once loading finishes.
            if (!framedOnce) {
              framedOnce = true;
              this.frameModel();
            }
          },
          () => {
            // Fold small same-material meshes into few big draw calls *before*
            // framing/edges — ungrouped BIM/CAD exports can have tens of
            // thousands of tiny separate meshes, and draw-call count (not
            // triangle count) is what actually tanks frame rate for those.
            // Record mesh↔line-art sibling pairs (see findLineArtSiblings)
            // *before* merging removes the original mesh nodes — it's the
            // only point where that sibling relationship is still visible —
            // so mergeLineArtByMaterial can link each folded line-art's new
            // slice back to the part it belongs to, for hide/isolate to mask
            // together instead of leaving it stranded and still visible.
            const lineArtToMesh = findLineArtSiblings(root);
            const { batches, meshToPart } = mergeMeshesByMaterial(root);
            this.mergedBatches = batches;
            this.selection.setMergedBatches(this.mergedBatches);
            mergeLineArtByMaterial(root, lineArtToMesh, meshToPart);
            this.frameModel();
            if (this.deps.getEdgesEnabled()) {
              this.scheduleEdgesBuild(root);
            }
            this.updateEdgeVisibility();
            this.ready = true;
            this.hooks.afterMerge?.(root);
          }
        );
      },
      (evt) => {
        if (evt.total) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          this.callbacks.onLoadingProgress(true, `Đang tải model… ${pct}%`);
        }
      },
      (err) => {
        console.error(err);
        this.callbacks.onLoadingProgress(false);
        this.callbacks.onToast("Không mở được file này. Hãy chắc chắn đó là .glb hoặc .gltf hợp lệ.");
        URL.revokeObjectURL(url);
      }
    );
  }

  private clearModel() {
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
    this.edgesBuilder.lines.forEach((line) => {
      line.visible = this.deps.getEdgesEnabled() && !!line.parent && line.parent.visible;
    });
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
      this.edgesBuilder.build(root, () => this.updateEdgeVisibility());
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
    const { roughnessFloor, flattenMetal, doubleSided } = this.deps.getSettings();
    return { roughnessFloor, flattenMetal, doubleSided };
  }

  // The roughness slider fires "input" continuously while dragging (much
  // faster than 60/sec on some devices); applyMaterialStyle() walks every
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
    const hits = this.raycaster.intersectObject(this.currentRoot, true);
    this.selection.pickFromRaycast(hits);
  }
}
