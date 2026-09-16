import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { EDGE_THRESHOLD_ANGLE, SELECTION_COLOR } from "./constants";
import {
  extractPartGeometry,
  findPartAtFaceIndex,
  setPartVisible,
  setLineArtRangeVisible,
  type MergedBatch,
  type MergedPart,
  type LineArtLink,
} from "./meshMerging";

type RenderablePart = THREE.Mesh | THREE.LineSegments | THREE.Line | THREE.Points;

function isRenderablePart(obj: THREE.Object3D): obj is RenderablePart {
  const o = obj as Partial<THREE.Mesh & THREE.LineSegments & THREE.Line & THREE.Points>;
  return !!(o.isMesh || o.isLineSegments || o.isLine || o.isPoints);
}

/** A mesh that stayed its own individual Object3D (not merged into a batch)
 * may carry links to decorative line-art siblings folded elsewhere (see
 * meshMerging's mergeLineArtByMaterial) — mask those in lockstep so hiding
 * the mesh doesn't leave its sketch/outline stranded and still visible. */
function syncLineArtLinks(obj: THREE.Object3D, visible: boolean) {
  const links = obj.userData.lineArtLinks as LineArtLink[] | undefined;
  links?.forEach((link) => setLineArtRangeVisible(link.batch, link.rangeIndex, visible));
}

export interface SelectionCallbacks {
  onSelectionChange: (name: string | null) => void;
  onHiddenChange: (hasHidden: boolean) => void;
}

/**
 * Owns click-selection, the orange outline highlight, and hide/isolate/show-all.
 *
 * Some BIM/CAD exports bake decorative line-art (real glTF LINES-mode
 * primitives — e.g. a tree's branch sketch) as a *separate sibling node*
 * right next to the solid "fill" mesh for the same visual part, rather than
 * as a single combined mesh. Hiding just the mesh would leave that line-art
 * fully visible. `partsOf()` treats any Line/LineSegments/Points sibling
 * under the same immediate parent as belonging to the same logical part, and
 * hide/isolate/showAll toggle it together with the mesh — but only for a
 * mesh that's still its own THREE.Mesh; `syncLineArtLinks()` carries the
 * same pairing for a mesh whose line-art sibling got folded into a merged
 * LineArtBatch elsewhere (`mesh.userData.lineArtLinks`, set up in
 * meshMerging.ts). A mesh folded into a merged draw batch itself is
 * addressed as a {batch, part} pair instead — `setPartVisible` there masks
 * its own linked line-art the same way (`MergedPart.lineArt`).
 */
export class SelectionController {
  selected: THREE.Mesh | null = null;

  private selectedPart: { batch: MergedBatch; part: MergedPart } | null = null;
  private highlight: LineSegments2 | null = null;
  private hidden = new Set<THREE.Object3D>();
  private isolated: THREE.Object3D | { batch: MergedBatch; part: MergedPart } | null = null;
  private mergedBatches: MergedBatch[] = [];

  constructor(
    private getRoot: () => THREE.Object3D | null,
    private callbacks: SelectionCallbacks
  ) {}

  get hasHidden(): boolean {
    if (this.hidden.size > 0 || this.isolated !== null) return true;
    return this.mergedBatches.some((b) => b.parts.some((p) => p.hidden));
  }

  /** Call after (re)building merged draw batches for the current model. */
  setMergedBatches(batches: MergedBatch[]) {
    this.mergedBatches = batches;
  }

  select(mesh: THREE.Mesh, faceIndex?: number) {
    const batch = mesh.userData.mergedBatch as MergedBatch | undefined;
    const part = batch && faceIndex !== undefined ? findPartAtFaceIndex(batch, faceIndex) : null;
    this.selected = mesh;
    this.selectedPart = batch && part ? { batch, part } : null;
    this.refreshHighlight();
    this.callbacks.onSelectionChange((this.selectedPart?.part.name ?? mesh.name) || "(không tên)");
  }

  clear() {
    this.selected = null;
    this.selectedPart = null;
    this.refreshHighlight();
    this.callbacks.onSelectionChange(null);
  }

  /** Reset all selection/hide/isolate state — call when a new model loads. */
  reset() {
    this.clear();
    this.hidden.clear();
    this.isolated = null;
    this.mergedBatches = [];
  }

  pickFromRaycast(hits: THREE.Intersection[]) {
    for (const h of hits) {
      const obj = h.object as THREE.Mesh;
      if (!obj.isMesh || !obj.visible) continue;
      const batch = obj.userData.mergedBatch as MergedBatch | undefined;
      if (batch) {
        const part = h.faceIndex !== undefined ? findPartAtFaceIndex(batch, h.faceIndex) : null;
        if (!part || part.hidden) continue; // hit a masked/degenerate triangle — keep looking
        this.select(obj, h.faceIndex);
        return;
      }
      this.select(obj);
      return;
    }
    this.clear();
  }

  hideSelected() {
    if (!this.selected) return;
    if (this.selectedPart) {
      setPartVisible(this.selectedPart.batch, this.selectedPart.part, false);
      this.clear();
      this.callbacks.onHiddenChange(this.hasHidden);
      return;
    }
    this.partsOf(this.selected).forEach((o) => {
      o.visible = false;
      syncLineArtLinks(o, false);
      this.hidden.add(o);
    });
    this.clear();
    this.callbacks.onHiddenChange(this.hasHidden);
  }

  isolateSelected() {
    const root = this.getRoot();
    if (!this.selected || !root) return;

    if (this.selectedPart) {
      const { batch: keepBatch, part: keepPart } = this.selectedPart;
      this.isolated = { batch: keepBatch, part: keepPart };
      this.mergedBatches.forEach((b) => b.parts.forEach((p) => setPartVisible(b, p, b === keepBatch && p === keepPart)));
      root.traverse((obj) => {
        if (obj.userData.isEdgeOverlay || obj === this.highlight || obj.userData.mergedBatch) return;
        if (isRenderablePart(obj)) {
          obj.visible = false;
          syncLineArtLinks(obj, false);
        }
      });
      this.callbacks.onHiddenChange(this.hasHidden);
      return;
    }

    this.isolated = this.selected;
    const keep = new Set(this.partsOf(this.selected));
    this.mergedBatches.forEach((b) => b.parts.forEach((p) => setPartVisible(b, p, false)));
    root.traverse((obj) => {
      if (obj.userData.isEdgeOverlay || obj === this.highlight || obj.userData.mergedBatch) return;
      if (isRenderablePart(obj)) {
        const v = keep.has(obj);
        obj.visible = v;
        syncLineArtLinks(obj, v);
      }
    });
    this.callbacks.onHiddenChange(this.hasHidden);
  }

  showAll() {
    const root = this.getRoot();
    root?.traverse((obj) => {
      if (obj.userData.isEdgeOverlay || obj === this.highlight || obj.userData.mergedBatch) return;
      if (isRenderablePart(obj)) {
        obj.visible = true;
        syncLineArtLinks(obj, true);
      }
    });
    this.mergedBatches.forEach((b) => b.parts.forEach((p) => setPartVisible(b, p, true)));
    this.hidden.clear();
    this.isolated = null;
    this.callbacks.onHiddenChange(this.hasHidden);
  }

  /** Re-apply the LineMaterial's screen resolution after a resize. */
  onResize() {
    if (this.highlight) {
      (this.highlight.material as LineMaterial).resolution.set(window.innerWidth, window.innerHeight);
    }
  }

  private partsOf(obj: THREE.Object3D): THREE.Object3D[] {
    const list: THREE.Object3D[] = [obj];
    obj.parent?.children.forEach((sib) => {
      if (sib === obj) return;
      if (sib.userData.isEdgeOverlay || sib === this.highlight) return;
      const s = sib as Partial<THREE.LineSegments & THREE.Line & THREE.Points>;
      if (s.isLineSegments || s.isLine || s.isPoints) list.push(sib);
    });
    return list;
  }

  private refreshHighlight() {
    if (this.highlight) {
      this.highlight.parent?.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as LineMaterial).dispose();
      this.highlight = null;
    }
    if (!this.selected) return;

    let edgeSourceGeo: THREE.BufferGeometry = this.selected.geometry;
    let ownsSourceGeo = false;
    if (this.selectedPart) {
      edgeSourceGeo = extractPartGeometry(this.selectedPart.batch, this.selectedPart.part);
      ownsSourceGeo = true;
    }

    const edges = new THREE.EdgesGeometry(edgeSourceGeo, EDGE_THRESHOLD_ANGLE);
    if (ownsSourceGeo) edgeSourceGeo.dispose();
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(edges.attributes.position.array as Float32Array);
    edges.dispose();

    const mat = new LineMaterial({
      color: SELECTION_COLOR,
      linewidth: 1, // thin, screen-space pixels
      worldUnits: false, 
      depthTest: false, // always draw on top, never hidden behind other objects
      transparent: true,
    });
    mat.resolution.set(window.innerWidth, window.innerHeight);

    const line = new LineSegments2(lineGeo, mat);
    line.raycast = () => {};
    line.renderOrder = 999;
    // Child of the mesh itself (local space) so it exactly follows the
    // mesh's real transform, including any orientation/mirror fix applied
    // higher up via the pivot group.
    this.selected.add(line);
    this.highlight = line;
  }
}
