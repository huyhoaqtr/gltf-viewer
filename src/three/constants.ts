export const EDGE_BUILD_FRAME_BUDGET_MS = 14; 
export const MODEL_BUILD_FRAME_BUDGET_MS = 8; 
export const EDGE_WORKER_POOL_MAX = 18; 
export const EDGE_WORKER_BATCH_MESH_COUNT = 260; 
export const EDGE_WORKER_BATCH_VERTEX_COUNT = 100_000;

/**
 * Merged batches are split into spatial chunks of at most this many triangles, so frustum
 * culling can skip the chunks that are off-screen (a single model-wide batch per material
 * always intersects the view and is never culled). Smaller = better culling, more draw calls.
 */
export const MERGE_CHUNK_MAX_TRIANGLES = 120_000;

/**
 * While the camera moves, each merged batch draws only its largest parts, up to this
 * fraction of its triangles (parts are stored largest-first, so this is a prefix of the
 * index buffer). Everything is drawn again once the camera settles.
 */
export const INTERACTION_LOD_TRIANGLE_RATIO = 0.35;

export const EDGE_THRESHOLD_ANGLE = 35; // degrees; low angles trace every facet seam on curved surfaces (a 24-sided cylinder is 15° per facet)
export const EDGE_COLOR = 0x1b1e20;
export const SELECTION_COLOR = 0xff9800;

export const CUBE_NAV = {
  marginX: 18,
  marginTop: 68,
  size: 132,
} as const;

/** Hologram mode skips the edges overlay on models heavier than this. */
export const HOLOGRAM_EDGES_MAX_TRIANGLES = 6_000_000;
export const SELECTION_FILL_OPACITY = 0.2;

/** Time spent merging meshes per frame before yielding, so a big model never freezes the tab. */
export const MERGE_FRAME_BUDGET_MS = 10;

/** Merged batches become visible (and are uploaded to the GPU) up to this many triangles per frame. */
export const REVEAL_TRIANGLES_PER_FRAME = 600_000;

/** Line-art objects folded into one merged object at a time, so a huge same-material group is merged in slices. */
export const LINE_ART_CHUNK_OBJECTS = 1500;

/** Upper bound on the number of workers used to merge meshes in parallel. */
export const MERGE_WORKER_POOL_MAX = 8;
