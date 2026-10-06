export type UpAxis = "y" | "z";
export type CameraMode = "persp" | "ortho";
export type ViewMode = "standard" | "hologram";

export interface ModelStats {
  meshCount: number;
  triangleCount: number;
}

export interface ViewerSettings {
  sunIntensity: number;
  skyIntensity: number;
  exposure: number;
  sunAngle: number;
  roughnessFloor: number;
  flattenMetal: boolean;
  doubleSided: boolean;
  upAxis: UpAxis;
  flipX: boolean;
  flipZ: boolean;
  spin180: boolean;
  showEdges: boolean;
  showShadows: boolean;
  autoRotate: boolean;
  background: string;
  cameraMode: CameraMode;
}

export interface HologramSettings {
  color: string;
  rimPower: number;
  opacity: number;
  /** Scanlines per model height (scaled by the model's size, not world units). */
  scanlineDensity: number;
  scanlineSpeed: number;
  flickerIntensity: number;
  showEdges: boolean;
  bloomIntensity: number;
  /** Depth-only pre-pass so only the nearest surface glows (off = see-through X-ray look). */
  depthPrepass: boolean;
}

export const DEFAULT_HOLOGRAM_SETTINGS: HologramSettings = {
  color: "#00E5FF",
  rimPower: 2.5,
  opacity: 0.3,
  scanlineDensity: 40,
  scanlineSpeed: 0,
  flickerIntensity: 0,
  showEdges: true,
  bloomIntensity: 0.6,
  depthPrepass: false,
};

// The default backdrop. the sky Background component special-cases this exact value to
// render a soft neutral studio gradient instead of a flat fill.
export const SKY_BACKGROUND_HEX = "#eef1f4";

export const DEFAULT_SETTINGS: ViewerSettings = {
  sunIntensity: 2,
  skyIntensity: 0.9,
  exposure: 1,
  sunAngle: 195,
  roughnessFloor: 0.55,
  flattenMetal: true,
  doubleSided: true,
  upAxis: "z",
  flipX: false,
  flipZ: false,
  spin180: false,
  showEdges: true,
  showShadows: true,
  autoRotate: false,
  background: SKY_BACKGROUND_HEX,
  cameraMode: "persp",
};

export const BACKGROUND_SWATCHES = [SKY_BACKGROUND_HEX, "#e9edf2", "#191b1f", "#ffffff"] as const;

export const BACKGROUND_LABELS: Record<string, string> = {
  [SKY_BACKGROUND_HEX]: "Studio sáng",
  "#e9edf2": "Xám sáng",
  "#191b1f": "Đen studio",
  "#ffffff": "Trắng",
};
