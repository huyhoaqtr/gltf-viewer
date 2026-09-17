import * as THREE from "three";
import "./bvhSetup";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { CubeNavigator } from "./cubeNavigator";
import { EdgesOverlayBuilder } from "./edgesOverlay";
import { ModelBuilder } from "./modelBuilder";
import { SelectionController } from "./selection";
import { applyOrientation, DEFAULT_ORIENTATION, type OrientationState } from "./orientation";
import { applyMaterialStyle, computeStats, disposeObject3D } from "./modelStyling";
import { mergeMeshesByMaterial, mergeLineArtByMaterial, findLineArtSiblings, type MergedBatch } from "./meshMerging";
import { createSkyGradientTexture } from "./skyBackground";
import { DRACO_DECODER_PATH } from "./constants";
import { DEFAULT_SETTINGS, SKY_BACKGROUND_HEX, type CameraMode, type ModelStats, type UpAxis } from "../types/viewer";

export interface ViewerEngineCallbacks {
  onStats: (stats: ModelStats | null) => void;
  onLoadingProgress: (loading: boolean, text?: string) => void;
  onSelectionChange: (name: string | null) => void;
  onHiddenChange: (hasHidden: boolean) => void;
  onToast: (message: string) => void;
  onFileName: (name: string | null) => void;
}

type ViewerCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/**
 * Owns the entire three.js world (renderer, scene, camera, lights, model,
 * cube navigator, selection) and exposes an imperative API for the React
 * layer to call. Deliberately has no React/DOM-framework dependency, so it
 * can be constructed, tested, or reused independent of the UI.
 */
export class ViewerEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: ViewerCamera;
  private cameraMode: CameraMode = "persp";
  private controls: OrbitControls;
  private pivot = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyTexture: THREE.Texture | null = null;
  private ground: THREE.Mesh;

  private cubeNav = new CubeNavigator();
  private edgesBuilder = new EdgesOverlayBuilder();
  private modelBuilder = new ModelBuilder();
  private selection: SelectionController;
  private gltfLoader: GLTFLoader;
  private raycaster = new THREE.Raycaster();

  private currentRoot: THREE.Object3D | null = null;
  private mergedBatches: MergedBatch[] = [];
  private modelRadius = 5;
  private box = new THREE.Box3();
  private sphere = new THREE.Sphere();

  private orientation: OrientationState = { ...DEFAULT_ORIENTATION };
  private roughnessFloor = 0.55;
  private flattenMetal = true;
  private doubleSided = true;
  private showEdgesEnabled = true;
  private autoRotateEnabled = false;
  private sunAngleDeg = 35;

  private modelPointerDown: { x: number; y: number } | null = null;
  private cubePointerDown: { x: number; y: number } | null = null;
  private restyleScheduled = false;
  private rafId = 0;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private callbacks: ViewerEngineCallbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = DEFAULT_SETTINGS.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.setBackground(SKY_BACKGROUND_HEX);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 5000);
    this.camera.position.set(4, 3, 6);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 5000;

    // Soft environment lighting for gentle reflections (keeps materials from
    // looking flat/dead). Kept low-intensity below (envMapIntensity on each
    // material) — a generic light-colored room reflected too strongly washes
    // every surface toward gray/white regardless of the material's own color.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.2).texture;

    this.scene.add(this.pivot);
    applyOrientation(this.pivot, this.orientation);

    // Neutral white sun + hemisphere — tinting either one shifts every
    // material's hue, which is the wrong lever for washed-out color. What
    // actually desaturates a pale material is too much flat ambient fill
    // (hemi) pushing it up near the tone-mapping curve's white clip, so that
    // knob is kept modest instead.
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xb8d4e8, 0x4a4a4a, 0.9);
    this.scene.add(this.hemi);

    // Invisible shadow-catcher under the model so it reads as grounded
    // instead of floating, even when the glTF itself has no ground/floor.
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

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

    this.updateSunPosition();
    this.bindEvents();
    this.animate();
    // Boot the edges worker pool now (loading the three.js module into each
    // worker) instead of on the first "edges" build, so that startup cost
    // isn't sitting on the critical path when the user actually loads a
    // model — it overlaps with file-picking/dragging time instead.
    this.edgesBuilder.warmUp();
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.unbindEvents();
    this.clearModel();
    this.edgesBuilder.destroyWorkers();
    this.skyTexture?.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.selection.onResize();
    const aspect = w / h;
    if (this.cameraMode === "persp") {
      const cam = this.camera as THREE.PerspectiveCamera;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    } else {
      const cam = this.camera as THREE.OrthographicCamera;
      const halfHeight = (cam.top - cam.bottom) / 2;
      cam.left = -halfHeight * aspect;
      cam.right = halfHeight * aspect;
      cam.updateProjectionMatrix();
    }
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
        this.pivot.add(root);

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
          { roughnessFloor: this.roughnessFloor, flattenMetal: this.flattenMetal, doubleSided: this.doubleSided },
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
            if (this.showEdgesEnabled) {
              this.scheduleEdgesBuild(root);
            }
            this.updateEdgeVisibility();
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
    if (this.currentRoot) {
      this.pivot.remove(this.currentRoot);
      disposeObject3D(this.currentRoot);
      this.currentRoot = null;
    }
    this.mergedBatches = [];
    this.edgesBuilder.dispose();
    this.callbacks.onStats(null);
  }

  private updateEdgeVisibility() {
    this.edgesBuilder.lines.forEach((line) => {
      line.visible = this.showEdgesEnabled && !!line.parent && line.parent.visible;
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
      if (this.currentRoot !== root || !this.showEdgesEnabled) return; // model changed or toggled off meanwhile
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

  private frameModel() {
    if (!this.currentRoot) return;
    this.box.setFromObject(this.pivot);
    this.box.getBoundingSphere(this.sphere);
    this.modelRadius = Math.max(this.sphere.radius, 0.01);
    const center = this.sphere.center;

    const groundSize = this.modelRadius * 10;
    this.ground.scale.set(groundSize, groundSize, 1);
    this.ground.position.set(center.x, this.box.min.y, center.z);

    this.controls.target.copy(center);
    const dir = new THREE.Vector3(0.65, 0.5, 0.9).normalize();
    this.camera.position.copy(center).addScaledVector(dir, this.modelRadius * 2.6);
    this.camera.near = Math.max(this.modelRadius / 500, 0.001);
    this.camera.far = this.modelRadius * 200;
    this.camera.updateProjectionMatrix();

    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -this.modelRadius * 1.6;
    shadowCam.right = this.modelRadius * 1.6;
    shadowCam.top = this.modelRadius * 1.6;
    shadowCam.bottom = -this.modelRadius * 1.6;
    shadowCam.near = this.modelRadius * 0.1;
    shadowCam.far = this.modelRadius * 6;
    shadowCam.updateProjectionMatrix();

    this.updateSunPosition();
    this.controls.update();
  }

  private updateSunPosition() {
    const angle = (this.sunAngleDeg * Math.PI) / 180;
    const dist = this.modelRadius * 2.2;
    this.sun.position.set(Math.cos(angle) * dist, dist * 0.9, Math.sin(angle) * dist);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  /** Snap the camera to look along a world direction (used by the cube nav). */
  private snapView(dirWorld: THREE.Vector3) {
    const center = this.controls.target.clone();
    const dist = Math.max(this.camera.position.distanceTo(center), this.modelRadius * 2.2, 1);
    const d = dirWorld.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(d.y) > 0.98) up = new THREE.Vector3(0, 0, d.y > 0 ? -1 : 1);
    this.camera.up.copy(up);
    this.camera.position.copy(center).addScaledVector(d, dist);
    this.camera.lookAt(center);
    this.controls.update();
  }

  // ---------------------------------------------------------------------
  // Settings setters — called by the React control panel
  // ---------------------------------------------------------------------

  setSunIntensity(v: number) {
    this.sun.intensity = v;
  }
  setSkyIntensity(v: number) {
    this.hemi.intensity = v;
  }
  setExposure(v: number) {
    this.renderer.toneMappingExposure = v;
  }
  setSunAngle(deg: number) {
    this.sunAngleDeg = deg;
    this.updateSunPosition();
  }

  setRoughnessFloor(v: number) {
    this.roughnessFloor = v;
    this.scheduleRestyle();
  }
  setFlattenMetal(v: boolean) {
    this.flattenMetal = v;
    this.scheduleRestyle();
  }
  setDoubleSided(v: boolean) {
    this.doubleSided = v;
    this.scheduleRestyle();
  }
  // The roughness slider fires "input" continuously while dragging (much
  // faster than 60/sec on some devices); applyMaterialStyle() walks every
  // mesh in the model, which is expensive on models with hundreds of parts.
  // Coalesce repeated calls into at most one pass per animation frame.
  private scheduleRestyle() {
    if (this.restyleScheduled) return;
    this.restyleScheduled = true;
    requestAnimationFrame(() => {
      this.restyleScheduled = false;
      if (this.currentRoot) {
        applyMaterialStyle(this.currentRoot, {
          roughnessFloor: this.roughnessFloor,
          flattenMetal: this.flattenMetal,
          doubleSided: this.doubleSided,
        });
      }
    });
  }

  setUpAxis(v: UpAxis) {
    this.orientation.upAxis = v;
    this.applyOrientationAndReframe();
  }
  setFlipX(v: boolean) {
    this.orientation.flipX = v;
    this.applyOrientationAndReframe();
  }
  setFlipZ(v: boolean) {
    this.orientation.flipZ = v;
    this.applyOrientationAndReframe();
  }
  setSpin180(v: boolean) {
    this.orientation.spin180 = v;
    this.applyOrientationAndReframe();
  }
  resetOrientation() {
    this.orientation = { ...DEFAULT_ORIENTATION };
    this.applyOrientationAndReframe();
  }
  private applyOrientationAndReframe() {
    applyOrientation(this.pivot, this.orientation);
    this.frameModel();
  }

  setShowEdges(v: boolean) {
    this.showEdgesEnabled = v;
    // Only build now if the model itself has finished progressively
    // attaching — building against a still-streaming-in root would only see
    // whatever parts happened to be attached so far. If the model is still
    // loading, just leave the flag set: loadGLTF's modelBuilder "onDone"
    // already builds edges when showEdgesEnabled is true.
    if (v && this.currentRoot && this.modelBuilder.built && !this.edgesBuilder.built) {
      this.scheduleEdgesBuild(this.currentRoot);
    }
    this.updateEdgeVisibility();
  }
  setShowShadows(v: boolean) {
    this.renderer.shadowMap.enabled = v;
    this.sun.castShadow = v;
  }
  setAutoRotate(v: boolean) {
    this.autoRotateEnabled = v;
  }
  setBackground(hex: string) {
    if (hex === SKY_BACKGROUND_HEX) {
      if (!this.skyTexture) this.skyTexture = createSkyGradientTexture();
      this.scene.background = this.skyTexture;
    } else {
      this.scene.background = new THREE.Color(hex);
    }
  }
  setCameraMode(mode: CameraMode) {
    if (mode === this.cameraMode) return;
    const aspect = this.container.clientWidth / this.container.clientHeight;
    if (mode === "ortho") {
      const d = this.controls.target.distanceTo(this.camera.position) || this.modelRadius * 2;
      const h = d * 0.55;
      const ortho = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, -1000, 1000);
      ortho.position.copy(this.camera.position);
      ortho.quaternion.copy(this.camera.quaternion);
      this.camera = ortho;
    } else {
      const persp = new THREE.PerspectiveCamera(45, aspect, 0.01, 5000);
      persp.position.copy(this.camera.position);
      persp.quaternion.copy(this.camera.quaternion);
      this.camera = persp;
    }
    this.cameraMode = mode;
    this.controls.object = this.camera;
    this.controls.update();
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

  // ---------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------

  private handleModelClick(clientX: number, clientY: number) {
    if (!this.currentRoot) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.currentRoot, true);
    this.selection.pickFromRaycast(hits);
  }

  // Cube-nav pointerdown is intercepted in the CAPTURE phase on `window` (an
  // ancestor of the canvas), which reliably fires before OrbitControls' own
  // bubble-phase listener on the canvas — stopping propagation here keeps a
  // click on the cube widget from also starting a camera drag.
  private onWindowPointerDownCapture = (e: PointerEvent) => {
    if (e.button === 0 && this.cubeNav.isOver(e.clientX, e.clientY)) {
      e.stopPropagation();
      this.cubePointerDown = { x: e.clientX, y: e.clientY };
    }
  };
  private onWindowPointerUp = (e: PointerEvent) => {
    if (this.cubePointerDown) {
      const moved = Math.hypot(e.clientX - this.cubePointerDown.x, e.clientY - this.cubePointerDown.y);
      const pos = this.cubePointerDown;
      this.cubePointerDown = null;
      if (moved <= 6) {
        const obj = this.cubeNav.pick(pos.x, pos.y);
        if (obj) this.snapView(obj.userData.dir);
      }
    }
  };
  private onWindowPointerMove = (e: PointerEvent) => {
    this.cubeNav.setHover(this.cubeNav.pick(e.clientX, e.clientY));
    this.renderer.domElement.style.cursor = this.cubeNav.isHovering ? "pointer" : "";
  };
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.selection.clear();
  };
  private onWindowResize = () => this.resize();

  // Click (not drag) on the model selects the part under the cursor; a click
  // on empty space clears the selection. "Was this a click" is decided from
  // the down/up distance so normal orbit-dragging is unaffected.
  private onCanvasPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.modelPointerDown = { x: e.clientX, y: e.clientY };
  };
  private onCanvasPointerUp = (e: PointerEvent) => {
    if (!this.modelPointerDown) return;
    const moved = Math.hypot(e.clientX - this.modelPointerDown.x, e.clientY - this.modelPointerDown.y);
    this.modelPointerDown = null;
    if (moved > 6) return;
    this.handleModelClick(e.clientX, e.clientY);
  };

  private bindEvents() {
    window.addEventListener("pointerdown", this.onWindowPointerDownCapture, true);
    window.addEventListener("pointerup", this.onWindowPointerUp);
    window.addEventListener("pointermove", this.onWindowPointerMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.onWindowResize);
    this.renderer.domElement.addEventListener("pointerdown", this.onCanvasPointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.onCanvasPointerUp);
  }
  private unbindEvents() {
    window.removeEventListener("pointerdown", this.onWindowPointerDownCapture, true);
    window.removeEventListener("pointerup", this.onWindowPointerUp);
    window.removeEventListener("pointermove", this.onWindowPointerMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.onWindowResize);
    this.renderer.domElement.removeEventListener("pointerdown", this.onCanvasPointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onCanvasPointerUp);
  }

  // ---------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);
    this.controls.autoRotate = this.autoRotateEnabled;
    this.controls.autoRotateSpeed = 1.4;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.cubeNav.syncToCamera(this.camera);
    this.cubeNav.render(this.renderer);
  };
}
