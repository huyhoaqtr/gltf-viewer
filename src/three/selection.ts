import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { EDGE_THRESHOLD_ANGLE, SELECTION_COLOR, SELECTION_FILL_OPACITY } from "./constants";
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
  /** Meshes (batch meshes excluded) currently selected as one logical group. */
  selectedMeshes: THREE.Mesh[] = [];

  private selectedParts: { batch: MergedBatch; part: MergedPart }[] = [];
  private highlights: THREE.Object3D[] = [];
  private hidden = new Set<THREE.Object3D>();
  private isolated = false;
  private mergedBatches: MergedBatch[] = [];
  private edgeColor = new THREE.Color(SELECTION_COLOR);
  private fillColor = new THREE.Color(SELECTION_COLOR);

  constructor(
    private getRoot: () => THREE.Object3D | null,
    private callbacks: SelectionCallbacks
  ) {}

  get hasSelection(): boolean {
    return this.selectedMeshes.length > 0 || this.selectedParts.length > 0;
  }

  get hasHidden(): boolean {
    if (this.hidden.size > 0 || this.isolated) return true;
    return this.mergedBatches.some((b) => b.parts.some((p) => p.hidden));
  }

  /** Recolours the outline and face fill, including any currently shown. */
  setColors(edge: string, fill: string) {
    this.edgeColor.set(edge);
    this.fillColor.set(fill);
    this.highlights.forEach((h) => {
      const mat = (h as THREE.Mesh).material as THREE.Material & { color: THREE.Color };
      mat.color.copy((h as LineSegments2).isLineSegments2 ? this.edgeColor : this.fillColor);
    });
  }

  /** Call after (re)building merged draw batches for the current model. */
  setMergedBatches(batches: MergedBatch[]) {
    this.mergedBatches = batches;
  }

  /**
   * Selects every visible piece of the logical object (see tagLogicalGroups
   * in meshMerging) that the clicked mesh/part belongs to — merged parts and
   * still-individual meshes alike.
   */
  private selectGroup(groupId: number | undefined, fallbackMesh: THREE.Mesh, fallbackPart: MergedPart | null) {
    const parts: { batch: MergedBatch; part: MergedPart }[] = [];
    const meshes: THREE.Mesh[] = [];

    if (groupId === undefined) {
      const batch = fallbackMesh.userData.mergedBatch as MergedBatch | undefined;
      if (batch && fallbackPart) parts.push({ batch, part: fallbackPart });
      else meshes.push(fallbackMesh);
    } else {
      this.mergedBatches.forEach((batch) =>
        batch.parts.forEach((part) => {
          if (part.groupId === groupId && !part.hidden) parts.push({ batch, part });
        })
      );
      this.getRoot()?.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && m.visible && !m.userData.mergedBatch && m.userData.groupId === groupId) meshes.push(m);
      });
    }

    this.selectedParts = parts;
    this.selectedMeshes = meshes;
    this.refreshHighlight();

    const count = parts.length + meshes.length;
    const base =
      fallbackPart?.groupName ?? (fallbackMesh.userData.groupName as string | undefined) ?? fallbackMesh.name;
    const label = base || "(no name)";
    console.log("[select]", {
      groupId,
      name: label,
      extras: fallbackPart?.groupUserData ?? fallbackMesh.userData.groupUserData ?? {},
      members: [
        ...parts.map(({ part }) => ({ name: part.name, triangles: part.indexCount / 3, merged: true })),
        ...meshes.map((m) => ({
          name: m.name || "(no name)",
          triangles: (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
          merged: false,
        })),
      ],
    });
    this.callbacks.onSelectionChange(count > 1 ? `${label} (${count} bộ phận)` : label);
  }

  clear() {
    this.selectedMeshes = [];
    this.selectedParts = [];
    this.refreshHighlight();
    this.callbacks.onSelectionChange(null);
  }

  /** Reset all selection/hide/isolate state — call when a new model loads. */
  reset() {
    this.clear();
    this.hidden.clear();
    this.isolated = false;
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
        this.selectGroup(part.groupId, obj, part);
        return;
      }
      this.selectGroup(obj.userData.groupId as number | undefined, obj, null);
      return;
    }
    this.clear();
  }

  hideSelected() {
    if (!this.hasSelection) return;
    this.selectedParts.forEach(({ batch, part }) => setPartVisible(batch, part, false));
    this.selectedMeshes.forEach((mesh) =>
      this.partsOf(mesh).forEach((o) => {
        o.visible = false;
        syncLineArtLinks(o, false);
        this.hidden.add(o);
      })
    );
    this.clear();
    this.callbacks.onHiddenChange(this.hasHidden);
  }

  isolateSelected() {
    const root = this.getRoot();
    if (!this.hasSelection || !root) return;

    this.isolated = true;
    const keepParts = new Set(this.selectedParts.map((p) => p.part));
    const keep = new Set(this.selectedMeshes.flatMap((m) => this.partsOf(m)));
    this.mergedBatches.forEach((b) => b.parts.forEach((p) => setPartVisible(b, p, keepParts.has(p))));
    root.traverse((obj) => {
      if (obj.userData.isEdgeOverlay || this.highlights.includes(obj) || obj.userData.mergedBatch) return;
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
      if (obj.userData.isEdgeOverlay || this.highlights.includes(obj) || obj.userData.mergedBatch) return;
      if (isRenderablePart(obj)) {
        obj.visible = true;
        syncLineArtLinks(obj, true);
      }
    });
    this.mergedBatches.forEach((b) => b.parts.forEach((p) => setPartVisible(b, p, true)));
    this.hidden.clear();
    this.isolated = false;
    this.callbacks.onHiddenChange(this.hasHidden);
  }

  /** Re-apply the LineMaterial's screen resolution after a resize. */
  onResize() {
    this.highlights.forEach((h) => {
      if ((h as LineSegments2).isLineSegments2) {
        ((h as LineSegments2).material as LineMaterial).resolution.set(window.innerWidth, window.innerHeight);
      }
    });
  }

  private partsOf(obj: THREE.Object3D): THREE.Object3D[] {
    const list: THREE.Object3D[] = [obj];
    obj.parent?.children.forEach((sib) => {
      if (sib === obj) return;
      if (sib.userData.isEdgeOverlay || this.highlights.includes(sib)) return;
      const s = sib as Partial<THREE.LineSegments & THREE.Line & THREE.Points>;
      if (s.isLineSegments || s.isLine || s.isPoints) list.push(sib);
    });
    return list;
  }

  private refreshHighlight() {
    this.highlights.forEach((h) => {
      const o = h as THREE.Mesh;
      h.parent?.remove(h);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    this.highlights = [];

    this.selectedParts.forEach(({ batch, part }) => {
      const geo = extractPartGeometry(batch, part);
      this.addHighlight(batch.mesh, geo);
      geo.dispose();
    });
    this.selectedMeshes.forEach((mesh) => this.addHighlight(mesh, mesh.geometry));
  }

  private addHighlight(host: THREE.Mesh, sourceGeo: THREE.BufferGeometry) {
    // Translucent face tint. Own position-only geometry copy so disposing it
    // later never touches the source mesh's GPU buffers.
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute("position", sourceGeo.attributes.position.clone());
    if (sourceGeo.index) fillGeo.setIndex(sourceGeo.index.clone());
    const fill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: this.fillColor,
        transparent: true,
        opacity: SELECTION_FILL_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    fill.raycast = () => {};
    fill.renderOrder = 998;
    host.add(fill);
    this.highlights.push(fill);

    const edges = new THREE.EdgesGeometry(sourceGeo, EDGE_THRESHOLD_ANGLE);
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(edges.attributes.position.array as Float32Array);
    edges.dispose();

    const mat = new LineMaterial({
      color: this.edgeColor,
      linewidth: 1, // thin, screen-space pixels
      worldUnits: false,
      depthTest: false, // always draw on top, never hidden behind other objects
      transparent: true,
    });
    mat.resolution.set(window.innerWidth, window.innerHeight);

    const line = new LineSegments2(lineGeo, mat);
    line.raycast = () => {};
    line.renderOrder = 999;
    // Child of the host mesh (local space) so it exactly follows the mesh's
    // real transform, including any orientation/mirror fix applied higher up
    // via the pivot group.
    host.add(line);
    this.highlights.push(line);
  }
}
