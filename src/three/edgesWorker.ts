// Runs inside a dedicated Worker: computes hard-edge line segments for a
// batch of geometries off the main thread. Pure typed-array math (no
// DOM/GPU access), so this is a clean fit for parallelizing across cores.
//
// @ts-nocheck — this file targets the worker global (`self`/`postMessage`),
// which conflicts with the "DOM" lib the rest of the app's tsconfig uses;
// scoping the escape hatch to this one small file is simpler than splitting
// out a second tsconfig just for it.
import { extractEdgeSegments } from "./edgeExtraction";

self.onmessage = (e) => {
  const { token, items, threshold } = e.data;
  const results = [];
  const transfer = [];

  for (const item of items) {
    try {
      const positions = extractEdgeSegments(item.position, item.index, threshold);
      results.push({ id: item.id, positions });
      transfer.push(positions.buffer);
    } catch {
      // very dense / degenerate geometry — skip silently, same as before
      results.push({ id: item.id, positions: null });
    }
  }

  self.postMessage({ token, results }, transfer);
};
