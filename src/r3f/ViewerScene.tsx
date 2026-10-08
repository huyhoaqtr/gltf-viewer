import { modelContrast } from "../three/modelStyling";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useStore, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { CubeNavigator } from "../three/cubeNavigator";
import { ModelController, type FrameInfo } from "../three/ModelController";
import { createGradientTexture, createSkyGradientTexture } from "../three/skyBackground";
import { selectEdgesEnabled, useViewerStore } from "../state/viewerStore";
import { DEFAULT_SETTINGS, SKY_BACKGROUND_HEX } from "../types/viewer";
import { HologramEffects } from "./hologram/HologramEffects";
import { HOLOGRAM_COLORS } from "./hologram/palette";
import { useHologramMode } from "./hologram/useHologramMode";
import { FpsMeter } from "./FpsMeter";
import { registerCubeApi } from "./cubeApi";
import { registerViewerApi } from "./viewerApi";
import { SceneRuntimeContext, useSceneRuntime, type SceneRuntime } from "./runtime";

/** Duration of the eased camera move after a view-cube click. */
const CUBE_SNAP_MS = 450;

const INITIAL_FRAME: FrameInfo = { radius: 5, center: [0, 0, 0], minY: 0 };

type ViewerCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Everything rendered inside the <Canvas>. */
export function ViewerScene() {
  const rt = useRef<SceneRuntime>({ controls: null, controller: null, frame: INITIAL_FRAME, savedTarget: null, mainRender: { calls: 0, triangles: 0 } }).current;
  const [frame, setFrame] = useState<FrameInfo>(INITIAL_FRAME);

  return (
    <SceneRuntimeContext.Provider value={rt}>
      <Background />
      <Environment />
      <Lights frame={frame} />
      <Ground frame={frame} />
      <Controls />
      <CameraRig />
      <ModelLayer
        onFrame={(f) => {
          rt.frame = f;
          setFrame(f);
        }}
      />
      <HologramMode />
      <HologramLayer frame={frame} />
      {import.meta.env.DEV && <DebugHandle />}
      <CubeGizmo />
      <FpsMeter />
    </SceneRuntimeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Environment / background / lights
// ---------------------------------------------------------------------------

function Background() {
  const background = useViewerStore((s) => s.settings.background);
  const hologram = useViewerStore((s) => s.viewMode === "hologram");
  const sky = useMemo(() => createSkyGradientTexture(), []);
  const holoSky = useMemo(
    () =>
      createGradientTexture([
        [0, HOLOGRAM_COLORS.backgroundTop],
        [1, HOLOGRAM_COLORS.backgroundBottom],
      ]),
    []
  );
  useEffect(() => () => sky.dispose(), [sky]);
  useEffect(() => () => holoSky.dispose(), [holoSky]);

  if (hologram) return <primitive object={holoSky} attach="background" />;
  return background === SKY_BACKGROUND_HEX ? (
    <primitive object={sky} attach="background" />
  ) : (
    <color attach="background" args={[background]} />
  );
}

/**
 * Soft environment lighting for gentle reflections (keeps materials from
 * looking flat/dead). Kept low-intensity (envMapIntensity on each material)
 * — a generic light-colored room reflected too strongly washes every surface
 * toward gray/white regardless of the material's own color.
 */
function Environment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const hologram = useViewerStore((s) => s.viewMode === "hologram");
  const target = useRef<THREE.WebGLRenderTarget | null>(null);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.2);
    target.current = rt;
    pmrem.dispose();
    return () => {
      scene.environment = null;
      target.current = null;
      rt.dispose();
      room.dispose();
    };
  }, [gl, scene]);

  // Hologram is self-lit: drop the reflections, then restore the same map.
  useEffect(() => {
    scene.environment = hologram ? null : target.current?.texture ?? null;
  }, [scene, hologram]);

  return null;
}

/**
 * Neutral white sun + hemisphere — tinting either one shifts every material's
 * hue, which is the wrong lever for washed-out color. What actually
 * desaturates a pale material is too much flat ambient fill (hemi) pushing it
 * up near the tone-mapping curve's white clip, so that knob is kept modest.
 */
function Lights({ frame }: { frame: FrameInfo }) {
  const gl = useThree((s) => s.gl);
  const settings = useViewerStore((s) => s.settings);
  const hologram = useViewerStore((s) => s.viewMode === "hologram");
  const { sunIntensity, skyIntensity, sunAngle, exposure } = settings;
  // Hologram is self-lit: no sun/hemisphere and no shadow pass (the model is additive and unlit).
  const showShadows = settings.showShadows && !hologram;

  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  useEffect(() => {
    gl.shadowMap.enabled = showShadows;
  }, [gl, showShadows]);

  // The shadow map only depends on the sun, the model's geometry and what is hidden — none of
  // which change while orbiting. Render it once per change instead of every frame (it would
  // otherwise draw the whole model a second time per frame).
  const stats = useViewerStore((s) => s.stats);
  const hasHidden = useViewerStore((s) => s.hasHidden);
  const { doubleSided, upAxis, flipX, flipZ, spin180 } = settings;
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, showShadows, sunAngle, frame, stats, hasHidden, doubleSided, upAxis, flipX, flipZ, spin180]);

  const r = frame.radius;
  const angle = (sunAngle * Math.PI) / 180;
  const dist = r * 2.2;
  const [cx, cy, cz] = frame.center;

  // The sun and its shadow camera must be centred on the model, not the world
  // origin — CAD/BIM exports often sit thousands of units away from (0,0,0),
  // which would leave the whole model outside the shadow frustum.
  const target = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    target.position.set(cx, cy, cz);
    target.updateMatrixWorld();
  }, [target, cx, cy, cz]);

  return (
    <>
      <primitive object={target} />
      <directionalLight
        target={target}
        color={0xffffff}
        intensity={hologram ? 0 : sunIntensity}
        position={[cx + Math.cos(angle) * dist, cy + dist * 0.9, cz + Math.sin(angle) * dist]}
        castShadow={showShadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00035}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-r * 1.6, r * 1.6, r * 1.6, -r * 1.6, r * 0.1, r * 6]} />
      </directionalLight>
      <hemisphereLight args={[0xb8d4e8, 0x4a4a4a]} intensity={hologram ? 0 : skyIntensity} />
    </>
  );
}

/** Invisible shadow-catcher under the model so it reads as grounded instead
 * of floating, even when the glTF itself has no ground/floor. */
function Ground({ frame }: { frame: FrameInfo }) {
  const hologram = useViewerStore((s) => s.viewMode === "hologram");
  if (hologram) return null;
  const size = frame.radius * 10;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[frame.center[0], frame.minY, frame.center[2]]}
      scale={[size, size, 1]}
      receiveShadow
    >
      <planeGeometry args={[1, 1]} />
      <shadowMaterial opacity={0.28} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Camera + controls
// ---------------------------------------------------------------------------

function Controls() {
  const rt = useSceneRuntime();
  const store = useStore();
  const [controls, setControls] = useState<OrbitControlsImpl | null>(null);

  // Lighten the scene (edges off, fewer parts) only while the user is really moving the camera.
  // OrbitControls' own start/end events fire for plain clicks too, so they can't be used. Instead:
  // a press that never travels more than a few pixels is a click and never lightens the scene;
  // a real drag or a wheel gesture does, until the camera has settled (there is no damping, so
  // it stops with the gesture, apart from a short grace for the next "change" event to arrive).
  useEffect(() => {
    if (!controls) return;
    const dom = controls.domElement as HTMLElement;
    const DRAG_THRESHOLD_PX = 4;
    const SETTLE_MS = 200;
    let down: { x: number; y: number } | null = null;
    let dragged = false;
    let lightUntil = 0; // performance.now() before which camera "change" events lighten the scene

    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      dragged = false;
      lightUntil = 0; // a new press: treat as a click until it proves to be a drag
      rt.controller?.endInteraction(0); // a click should see the full-detail model right away
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!down || dragged) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD_PX) {
        dragged = true;
        lightUntil = Infinity;
      }
    };
    const onPointerUp = () => {
      if (down && dragged) lightUntil = performance.now() + SETTLE_MS;
      down = null;
    };
    const onWheel = () => {
      lightUntil = performance.now() + SETTLE_MS;
    };
    const onChange = () => {
      if (performance.now() >= lightUntil || !useViewerStore.getState().settings.lodWhileMoving) return;
      rt.controller?.pulseInteraction();
      store.getState().performance.regress(); // lower render resolution until idle (Canvas `performance`)
    };

    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: true });
    controls.addEventListener("change", onChange);
    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
      controls.removeEventListener("change", onChange);
    };
  }, [controls, rt, store]);

  useEffect(() => {
    rt.controls = controls;
    // drei recreates the controls when the camera is swapped; carry the orbit
    // target over so the view doesn't jump.
    if (controls && rt.savedTarget) {
      controls.target.copy(rt.savedTarget);
      rt.savedTarget = null;
      controls.update();
    }
    return () => {
      rt.controls = null;
    };
  }, [controls, rt]);

  useFrame(() => {
    if (controls) controls.autoRotate = useViewerStore.getState().settings.autoRotate;
  });

  return (
    <OrbitControls
      ref={setControls}
      makeDefault
      screenSpacePanning
      minDistance={0.01}
      maxDistance={5000}
      autoRotateSpeed={1.4}
    />
  );
}

/** Perspective ⇄ orthographic switching, plus keeping the projection in sync
 * with the canvas size (the cameras are `manual`, so R3F leaves them alone —
 * its own ortho resize math uses pixel units, which would break the framing). */
function CameraRig() {
  const rt = useSceneRuntime();
  const mode = useViewerStore((s) => s.settings.cameraMode);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const set = useThree((s) => s.set);

  useLayoutEffect(() => {
    const isOrtho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    if (isOrtho === (mode === "ortho")) return;
    const aspect = size.width / size.height;
    let next: ViewerCamera;
    if (mode === "ortho") {
      const d = rt.controls?.target.distanceTo(camera.position) || rt.frame.radius * 2;
      const h = d * 0.55;
      next = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, -1000, 1000);
    } else {
      next = new THREE.PerspectiveCamera(45, aspect, 0.01, 5000);
    }
    if (rt.controls) rt.savedTarget = rt.controls.target.clone();
    next.position.copy(camera.position);
    next.quaternion.copy(camera.quaternion);
    set({ camera: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useLayoutEffect(() => {
    (camera as ViewerCamera & { manual?: boolean }).manual = true;
    const aspect = size.width / size.height;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      (camera as THREE.PerspectiveCamera).aspect = aspect;
    } else {
      const cam = camera as THREE.OrthographicCamera;
      const halfHeight = (cam.top - cam.bottom) / 2;
      cam.left = -halfHeight * aspect;
      cam.right = halfHeight * aspect;
    }
    camera.updateProjectionMatrix();
    rt.controller?.onResize();
  }, [camera, size, rt]);

  return null;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function ModelLayer({ onFrame }: { onFrame: (frame: FrameInfo) => void }) {
  const rt = useSceneRuntime();
  const store = useStore();
  const gl = useThree((s) => s.gl);
  const pivotRef = useRef<THREE.Group>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const { roughnessFloor, flattenMetal, doubleSided, upAxis, flipX, flipZ, spin180 } = useViewerStore(
    (s) => s.settings
  );
  const edgesEnabled = useViewerStore(selectEdgesEnabled);

  useEffect(() => {
    const s = () => useViewerStore.getState();
    const controller = new ModelController(
      {
        pivot: pivotRef.current!,
        getCamera: () => store.getState().camera as ViewerCamera,
        getControls: () => rt.controls,
        getSettings: () => s().settings,
        getEdgesEnabled: () => selectEdgesEnabled(s()),
      },
      {
        onStats: (stats) => s().setStats(stats),
        onLoadingProgress: (loading, text) => s().setLoading(loading, text),
        onSelectionChange: (name) => s().setSelectedName(name),
        onHiddenChange: (v) => s().setHasHidden(v),
        onToast: (msg) => s().showToast(msg),
        onFileName: (name) => {
          s().setFileName(name);
          s().setDropzoneVisible(!name);
        },
        onFrame: (f) => onFrameRef.current(f),
      }
    );
    rt.controller = controller;
    registerViewerApi({
      loadFile: (file) => controller.loadFile(file),
      fitToView: () => controller.fitToView(),
      hideSelected: () => controller.hideSelected(),
      isolateSelected: () => controller.isolateSelected(),
      showAllObjects: () => controller.showAllObjects(),
    });

    // Click (not drag) on the model selects; "was this a click" is decided
    // from the down/up distance so normal orbit-dragging is unaffected.
    const dom = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved <= 6) controller.handleModelClick(e.clientX, e.clientY, dom);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") controller.clearSelection();
    };
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      registerViewerApi(null);
      controller.dispose();
      rt.controller = null;
    };
  }, [gl, rt, store]);

  // BIM/CAD axis/mirror fixes live on the pivot group, not the loaded scene.
  useEffect(() => {
    rt.controller?.setOrientation({ upAxis, flipX, flipZ, spin180 });
  }, [rt, upAxis, flipX, flipZ, spin180]);

  const contrast = useViewerStore((s) => s.settings.contrast);
  useEffect(() => {
    // Shared uniform read by every patched model material: no restyle or recompile needed.
    modelContrast.value = contrast;
  }, [contrast]);

  useEffect(() => {
    rt.controller?.scheduleRestyle();
  }, [rt, roughnessFloor, flattenMetal, doubleSided]);

  const { selectionColor, selectionFillColor } = useViewerStore((s) => s.settings);
  useEffect(() => {
    rt.controller?.setSelectionColors(
      selectionColor ?? DEFAULT_SETTINGS.selectionColor,
      selectionFillColor ?? DEFAULT_SETTINGS.selectionFillColor
    );
  }, [rt, selectionColor, selectionFillColor]);

  useEffect(() => {
    rt.controller?.setShowEdges(edgesEnabled);
  }, [rt, edgesEnabled]);

  return <group ref={pivotRef} />;
}

/** Fog, grid and post-processing: mounted only while in hologram mode. */
function HologramLayer({ frame }: { frame: FrameInfo }) {
  const hologram = useViewerStore((s) => s.viewMode === "hologram");
  return hologram ? <HologramEffects frame={frame} /> : null;
}

/** Dev only: exposes `window.__viewer = { gl, scene, info() }` for console measurements. */
function DebugHandle() {
  const rt = useSceneRuntime();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const w = window as unknown as { __viewer?: unknown };
    w.__viewer = {
      gl,
      scene,
      info: () => ({ memory: { ...gl.info.memory }, render: { ...rt.mainRender } }),
    };
    return () => {
      delete w.__viewer;
    };
  }, [gl, scene, rt]);
  return null;
}

/** Mounted after ModelLayer so the controller exists when its effects run. */
function HologramMode() {
  useHologramMode();
  return null;
}

// ---------------------------------------------------------------------------
// Cube navigator
// ---------------------------------------------------------------------------

/**
 * Orientation gizmo drawn into a corner viewport of the main canvas after the
 * main scene. Because this subscribes to the render loop with a positive
 * priority, R3F stops auto-rendering — so the main scene is rendered here too.
 */
function CubeGizmo() {
  const rt = useSceneRuntime();
  const store = useStore();
  const gl = useThree((s) => s.gl);
  const cube = useMemo(() => new CubeNavigator(), []);
  useEffect(() => () => cube.dispose(), [cube]);

  // Camera move started by a cube click: eased rotation around the orbit target.
  const anim = useRef<{
    start: number;
    q: THREE.Quaternion;
    startDir: THREE.Vector3;
    startUp: THREE.Vector3;
    endUp: THREE.Vector3;
    center: THREE.Vector3;
    dist: number;
  } | null>(null);

  useEffect(() => {
    let cubePointerDown: { x: number; y: number } | null = null;

    /** Snaps to look at the target from `dirWorld` (target -> eye). `upOverride` is used by the arrow buttons. */
    const snapView = (dirWorld: THREE.Vector3, upOverride?: THREE.Vector3) => {
      const controls = rt.controls;
      if (!controls) return;
      const camera = store.getState().camera;
      const center = controls.target.clone();
      const dist = Math.max(camera.position.distanceTo(center), rt.frame.radius * 2.2, 1);
      const d = dirWorld.clone().normalize();
      let up = upOverride?.clone() ?? new THREE.Vector3(0, 1, 0);
      if (!upOverride && Math.abs(d.y) > 0.98) up = new THREE.Vector3(0, 0, d.y > 0 ? -1 : 1);
      const startDir = camera.position.clone().sub(center).normalize();
      anim.current = {
        start: performance.now(),
        q: new THREE.Quaternion().setFromUnitVectors(startDir, d),
        startDir,
        startUp: camera.up.clone(),
        endUp: up,
        center,
        dist,
      };
    };

    /** Arrow buttons: move to the face next to the current one, in the given screen direction. */
    const step = (dir: "up" | "down" | "left" | "right") => {
      const controls = rt.controls;
      const face = cube.alignedFace;
      if (!controls || !face || anim.current) return;
      const camera = store.getState().camera;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      let target: THREE.Vector3;
      let nextUp: THREE.Vector3;
      if (dir === "up") {
        target = up;
        nextUp = face.clone().negate();
      } else if (dir === "down") {
        target = up.clone().negate();
        nextUp = face.clone();
      } else if (dir === "left") {
        target = right.clone().negate();
        nextUp = up;
      } else {
        target = right;
        nextUp = up;
      }
      // Snap to the nearest world axis so the result is exactly a face view.
      const axis = new THREE.Vector3(Math.round(target.x), Math.round(target.y), Math.round(target.z));
      if (axis.lengthSq() !== 1) return;
      // Side faces keep the model upright; top/bottom keep the up from the arrow direction.
      if (axis.y === 0) nextUp = new THREE.Vector3(0, 1, 0);
      snapView(axis, nextUp);
    };
    registerCubeApi(step);

    // Intercepted in the CAPTURE phase on `window` (an ancestor of the
    // canvas), which fires before OrbitControls' own listener on the canvas —
    // stopping propagation keeps a click on the gizmo from starting a drag.
    const onPointerDownCapture = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(".cube-arrow")) return;
      if (e.button === 0 && cube.isOver(e.clientX, e.clientY)) {
        e.stopPropagation();
        cubePointerDown = { x: e.clientX, y: e.clientY };
      } else {
        anim.current = null; // the user took over the camera
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!cubePointerDown) return;
      const moved = Math.hypot(e.clientX - cubePointerDown.x, e.clientY - cubePointerDown.y);
      const pos = cubePointerDown;
      cubePointerDown = null;
      if (moved <= 6) {
        const obj = cube.pick(pos.x, pos.y);
        if (obj) snapView(obj.userData.dir);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      cube.setHover(cube.pick(e.clientX, e.clientY));
      gl.domElement.style.cursor = cube.isHovering ? "pointer" : "";
      const over = cube.isOver(e.clientX, e.clientY);
      if (useViewerStore.getState().cubeHover !== over) useViewerStore.getState().setCubeHover(over);
    };

    window.addEventListener("pointerdown", onPointerDownCapture, true);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    return () => {
      registerCubeApi(null);
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [cube, gl, rt, store]);

  useFrame(({ camera }) => {
    const a = anim.current;
    const controls = rt.controls;
    if (!a) return;
    if (!controls) {
      anim.current = null;
      return;
    }
    const t = Math.min((performance.now() - a.start) / CUBE_SNAP_MS, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const q = new THREE.Quaternion().slerp(a.q, e);
    const dir = a.startDir.clone().applyQuaternion(q);
    const up = a.startUp.clone().lerp(a.endUp, e);
    if (up.lengthSq() < 1e-6) up.copy(a.endUp);
    camera.up.copy(up.normalize());
    camera.position.copy(a.center).addScaledVector(dir, a.dist);
    camera.lookAt(a.center);
    controls.update();
    rt.controller?.pulseInteraction();
    if (t >= 1) anim.current = null;
  });

  // gl.info resets on every render() call; reset manually so the main pass's
  // numbers can be captured before the gizmo pass adds its own.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(({ gl }) => gl.info.reset(), 0.5);

  // Standard mode: this renders the main scene (a positive priority disables
  // R3F's auto render). In hologram mode the EffectComposer renders it instead.
  useFrame(({ gl, scene, camera }) => {
    const state = useViewerStore.getState();
    // Hologram with bloom: the EffectComposer renders the scene instead.
    if (state.viewMode === "hologram" && state.hologramSettings.bloomIntensity > 0) return;
    // The EffectComposer turns autoClear off and doesn't restore it on unmount.
    // With a texture background three.js only clears color/depth when autoClear
    // is on, so a stale depth buffer would punch holes in the model while orbiting.
    gl.autoClear = true;
    gl.render(scene, camera);
  }, 1);

  // Always last, drawn onto whatever the main pass produced.
  useFrame(({ gl, camera }) => {
    rt.mainRender.calls = gl.info.render.calls;
    rt.mainRender.triangles = gl.info.render.triangles;
    cube.syncToCamera(camera);
    const aligned = cube.alignedFace !== null;
    if (useViewerStore.getState().cubeAligned !== aligned) useViewerStore.getState().setCubeAligned(aligned);
    cube.render(gl);
  }, 2);

  return null;
}
