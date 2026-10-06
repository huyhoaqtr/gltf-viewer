import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createHologramDepthMaterial, createHologramMaterial } from "../../materials/HologramMaterial";
import { HOLOGRAM_EDGES_MAX_TRIANGLES } from "../../three/constants";
import { MaterialSwapper } from "../../three/hologramSwap";
import { HOLOGRAM_COLORS } from "./palette";
import { useViewerStore } from "../../state/viewerStore";
import { useSceneRuntime } from "../runtime";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Hologram display mode: swaps the model's materials for the shared hologram
 * material and restores the originals on exit. Must be mounted after
 * ModelLayer (it needs the controller). Settings reach the shader through
 * uniforms in useFrame — no React state updates per frame.
 */
export function useHologramMode() {
  const rt = useSceneRuntime();
  const viewMode = useViewerStore((s) => s.viewMode);
  const material = useMemo(() => createHologramMaterial(), []);
  const depthMaterial = useMemo(() => createHologramDepthMaterial(), []);
  const swapper = useMemo(() => new MaterialSwapper(material, depthMaterial), [material, depthMaterial]);
  const prepass = useViewerStore((s) => s.hologramSettings.depthPrepass);

  useEffect(
    () => () => {
      material.dispose();
      depthMaterial.dispose();
    },
    [material, depthMaterial]
  );

  // Follow the model's lifecycle: (re)apply once a new model is merged, and
  // restore before it is disposed so the shared material is never disposed.
  useEffect(() => {
    const controller = rt.controller;
    if (!controller) return;
    controller.setHooks({
      afterMerge: (root) => {
        const state = useViewerStore.getState();
        if (state.viewMode === "hologram") swapper.apply(root, state.hologramSettings.depthPrepass);
      },
      beforeClear: () => {
        swapper.restore();
      },
    });
    return () => controller.setHooks(null);
  }, [rt, swapper]);

  useEffect(() => {
    const controller = rt.controller;
    if (viewMode === "hologram") {
      // Also re-runs when the pre-pass option flips: rebuild the swap from scratch.
      swapper.restore();
      const root = controller?.getReadyRoot();
      if (root) swapper.apply(root, prepass);
      return;
    }
    // Originals kept being restyled-skipped while swapped; catch them up.
    if (swapper.restore() > 0) controller?.scheduleRestyle();
  }, [rt, swapper, viewMode, prepass]);

  useEffect(() => () => void swapper.restore(), [swapper]);

  // Edges: reuse the existing overlay, just brighter (so bloom picks it up)
  // and additive. Whether it shows at all is selectEdgesEnabled's call.
  useEffect(() => {
    const controller = rt.controller;
    if (!controller) return;
    if (viewMode === "hologram") {
      controller.setEdgeStyle({
        color: new THREE.Color(HOLOGRAM_COLORS.edges).multiplyScalar(1.0),
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
      });
      const stats = useViewerStore.getState().stats;
      if (stats && stats.triangleCount > HOLOGRAM_EDGES_MAX_TRIANGLES) {
        console.warn(
          `[hologram] ${stats.triangleCount} tam giác vượt ngưỡng ${HOLOGRAM_EDGES_MAX_TRIANGLES}: bỏ qua edges.`
        );
      }
    } else {
      controller.setEdgeStyle(null);
    }
    return () => controller.setEdgeStyle(null);
  }, [rt, viewMode]);

  useFrame(({ clock }) => {
    const state = useViewerStore.getState();
    if (state.viewMode !== "hologram") return;
    const h = state.hologramSettings;
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    (u.uColor.value as THREE.Color).set(h.color);
    u.uRimPower.value = h.rimPower;
    u.uOpacity.value = h.opacity;
    // Scanline count is per model height, so it looks the same at any scale.
    u.uScanlineDensity.value = h.scanlineDensity / Math.max(rt.frame.radius * 2, 1e-4);
    u.uScanlineSpeed.value = h.scanlineSpeed;
    u.uFlicker.value = reducedMotion() ? 0 : h.flickerIntensity;
  });
}
