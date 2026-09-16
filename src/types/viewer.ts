export type UpAxis = "y" | "z";
export type CameraMode = "persp" | "ortho";

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

// The default backdrop. ViewerEngine special-cases this exact value to
// render a soft neutral studio gradient instead of a flat fill.
export const SKY_BACKGROUND_HEX = "#eef1f4";

export const DEFAULT_SETTINGS: ViewerSettings = {
  sunIntensity: 3,
  skyIntensity: 1.2,
  exposure: 1,
  sunAngle: 35,
  roughnessFloor: 0.75,
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
