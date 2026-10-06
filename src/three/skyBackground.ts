import * as THREE from "three";

/**
 * A soft neutral studio gradient — near-white at the top fading to a light
 * cool gray near the ground — matching a clean model-viewer backdrop (e.g.
 * published SketchUp viewers) instead of a flat fill or a saturated sky.
 */
export function createSkyGradientTexture(): THREE.Texture {
  return createGradientTexture([
    [0, "#ffffff"],
    [0.6, "#f2f4f6"],
    [1, "#e3e8ec"],
  ]);
}

/** Vertical gradient background texture, top (0) to bottom (1). */
export function createGradientTexture(stops: [number, string][]): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
