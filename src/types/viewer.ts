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
  contrast: number;
  sunAngle: number;
  flattenMetal: boolean;
  doubleSided: boolean;
  upAxis: UpAxis;
  flipX: boolean;
  flipZ: boolean;
  spin180: boolean;
  showEdges: boolean;
  /** Line geometry shipped inside the glTF itself (CAD/BIM outlines), not the viewer's own edges overlay. */
  showModelLines: boolean;
  /** Minimum angle (degrees) between two faces for their shared edge to be drawn. Higher = fewer edges on curved surfaces. */
  edgeAngle: number;
  showShadows: boolean;
  autoRotate: boolean;
  /** Supersampling: renders at a higher resolution, then downsamples. Smoother thin lines, heavier on the GPU. */
  antialias: boolean;
  showFps: boolean;
  /** While the camera moves, draw only the largest parts of the model. */
  lodWhileMoving: boolean;
  background: string;
  cameraMode: CameraMode;
  /** Selection outline colour (CSS hex). */
  selectionColor: string;
  /** Selection translucent face-fill colour (CSS hex). */
  selectionFillColor: string;
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
  showGrid: boolean;
}

export const DEFAULT_HOLOGRAM_SETTINGS: HologramSettings = {
  color: "#00bfff",
  rimPower: 6,
  opacity: 0.3,
  scanlineDensity: 15,
  scanlineSpeed: 0.3,
  flickerIntensity: 0,
  showEdges: false,
  bloomIntensity: 0,
  depthPrepass: false,
  showGrid: true,
};

// The default backdrop. the sky Background component special-cases this exact value to
// render a soft neutral studio gradient instead of a flat fill.
export const SKY_BACKGROUND_HEX = "#eef1f4";

export const DEFAULT_SETTINGS: ViewerSettings = {
  sunIntensity: 2,
  skyIntensity: 0.9,
  exposure: 1,
  contrast: 1.5,
  sunAngle: 195,
  flattenMetal: true,
  doubleSided: true,
  upAxis: "z",
  flipX: false,
  flipZ: false,
  spin180: false,
  showEdges: true,
  showModelLines: false,
  edgeAngle: 35,
  showShadows: true,
  autoRotate: false,
  antialias: false,
  showFps: true,
  lodWhileMoving: false,
  background: SKY_BACKGROUND_HEX,
  cameraMode: "persp",
  selectionColor: "#ff9800",
  selectionFillColor: "#ff9800",
};

export const BACKGROUND_SWATCHES = [SKY_BACKGROUND_HEX, "#e9edf2", "#191b1f", "#ffffff"] as const;

export const BACKGROUND_LABELS: Record<string, string> = {
  [SKY_BACKGROUND_HEX]: "Studio sáng",
  "#e9edf2": "Xám sáng",
  "#191b1f": "Đen studio",
  "#ffffff": "Trắng",
};

/** A note pinned to a point on the model surface (position is in the model pivot's local space). */
export interface Comment {
  id: number;
  position: [number, number, number];
  text: string;
}

export type MarkupTool = "off" | "pen" | "line" | "arrow" | "rect" | "circle";

/** A shape drawn over the model; points are a polyline in the model pivot's local space. */
export interface MarkupStroke {
  id: number;
  color: string;
  width: number;
  points: [number, number, number][];
}
