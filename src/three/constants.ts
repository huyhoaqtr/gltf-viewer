const THREE_VERSION = "0.160.1";

export const DRACO_DECODER_PATH = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/libs/draco/`;

export const EDGE_BUILD_FRAME_BUDGET_MS = 14; 
export const MODEL_BUILD_FRAME_BUDGET_MS = 8; 
export const EDGE_WORKER_POOL_MAX = 18; 
export const EDGE_WORKER_BATCH_MESH_COUNT = 260; 
export const EDGE_WORKER_BATCH_VERTEX_COUNT = 100_000;

export const EDGE_THRESHOLD_ANGLE = 15; // degrees; low angles trace every subdivision seam on curved geometry
export const EDGE_COLOR = 0x1b1e20;
export const SELECTION_COLOR = 0xffbf54;

export const CUBE_NAV = {
  marginX: 18,
  marginTop: 68,
  size: 108,
} as const;
