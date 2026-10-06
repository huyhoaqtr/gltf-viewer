import { useMemo } from "react";
import { Grid } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { useViewerStore } from "../../state/viewerStore";
import { HOLOGRAM_COLORS } from "./palette";

/**
 * Everything that exists only in hologram mode: fog, the glowing floor grid
 * and the post-processing chain. Mounted/unmounted as a whole, so leaving the
 * mode disposes the composer and its render targets.
 */
export function HologramEffects({ frame }: { frame: { radius: number; minY: number; center: [number, number, number] } }) {
  return (
    <>
      <fog attach="fog" args={[HOLOGRAM_COLORS.fog, frame.radius * 4, frame.radius * 30]} />
      <HologramGrid frame={frame} />
      <HologramPostFx />
    </>
  );
}

function HologramGrid({ frame }: { frame: { radius: number; minY: number; center: [number, number, number] } }) {
  const r = frame.radius;
  // Grid has no opacity prop, so "low opacity" is a dimmed colour over the dark background.
  const cell = useMemo(() => new THREE.Color(HOLOGRAM_COLORS.primary).multiplyScalar(0.28), []);
  const section = useMemo(() => new THREE.Color(HOLOGRAM_COLORS.primary).multiplyScalar(0.55), []);
  return (
    <Grid
      position={[frame.center[0], frame.minY - r * 0.002, frame.center[2]]}
      args={[10, 10]}
      cellSize={r / 5}
      sectionSize={r}
      cellThickness={0.6}
      sectionThickness={1.1}
      cellColor={cell}
      sectionColor={section}
      fadeDistance={r * 14}
      fadeStrength={1.5}
      infiniteGrid
      side={THREE.DoubleSide}
    />
  );
}

function HologramPostFx() {
  const bloomIntensity = useViewerStore((s) => s.hologramSettings.bloomIntensity);

  return (
    <EffectComposer multisampling={4} renderPriority={1}>
      {/* Threshold sits above the body's base glow, so only the rim and edges bloom. */}
      <Bloom mipmapBlur intensity={bloomIntensity} luminanceThreshold={0.9} luminanceSmoothing={0.15} />
    </EffectComposer>
  );
}
