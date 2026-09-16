// Runs inside a dedicated Worker: computes EdgesGeometry for a batch of mesh
// geometries off the main thread. EdgesGeometry is pure typed-array math (no
// DOM/GPU access), so this is a clean fit for parallelizing across cores.
//
// @ts-nocheck — this file targets the worker global (`self`/`postMessage`),
// which conflicts with the "DOM" lib the rest of the app's tsconfig uses;
// scoping the escape hatch to this one small file is simpler than splitting
// out a second tsconfig just for it.
import * as THREE from "three";

self.onmessage = (e) => {
  const { token, items, threshold } = e.data;
  const results = [];
  const transfer = [];

  for (const item of items) {
    try {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(item.position, 3));
      if (item.index) geo.setIndex(new THREE.BufferAttribute(item.index, 1));
      const edges = new THREE.EdgesGeometry(geo, threshold);
      const positions = edges.attributes.position.array;
      results.push({ id: item.id, positions });
      transfer.push(positions.buffer);
    } catch {
      // very dense / degenerate geometry — skip silently, same as before
      results.push({ id: item.id, positions: null });
    }
  }

  self.postMessage({ token, results }, transfer);
};
