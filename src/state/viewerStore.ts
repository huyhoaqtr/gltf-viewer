import { create } from "zustand";
import { HOLOGRAM_EDGES_MAX_TRIANGLES } from "../three/constants";
import {
  DEFAULT_HOLOGRAM_SETTINGS,
  DEFAULT_SETTINGS,
  type HologramSettings,
  type Comment,
  type MarkupStroke,
  type MarkupTool,
  type ModelStats,
  type ViewMode,
  type ViewerSettings,
} from "../types/viewer";

/** Whether the edges overlay should be shown right now, for the active view mode. */
export function selectEdgesEnabled(s: Pick<ViewerStore, "viewMode" | "settings" | "hologramSettings" | "stats">): boolean {
  if (s.viewMode !== "hologram") return s.settings.showEdges;
  const tooHeavy = !!s.stats && s.stats.triangleCount > HOLOGRAM_EDGES_MAX_TRIANGLES;
  return s.hologramSettings.showEdges && !tooHeavy;
}

export interface FpsStats {
  fps: number;
  ms: number;
  calls: number;
  triangles: number;
}

interface ViewerStore {
  // Single source of truth for viewer settings: the control panel writes
  // here and the R3F scene components read from it.
  settings: ViewerSettings;
  updateSetting: <K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) => void;
  resetOrientationSettings: () => void;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleHologram: () => void;
  hologramSettings: HologramSettings;
  updateHologramSetting: <K extends keyof HologramSettings>(key: K, value: HologramSettings[K]) => void;

  fpsStats: FpsStats | null;
  setFpsStats: (stats: FpsStats) => void;

  /** View cube: camera looks straight at a face / pointer is over the cube (drives the arrow buttons). */
  cubeAligned: boolean;
  cubeHover: boolean;
  setCubeAligned: (v: boolean) => void;
  setCubeHover: (v: boolean) => void;

  panelOpen: boolean;
  togglePanel: () => void;

  fileName: string | null;
  stats: ModelStats | null;
  setFileName: (name: string | null) => void;
  setStats: (stats: ModelStats | null) => void;

  loading: boolean;
  loadingText: string;
  setLoading: (loading: boolean, text?: string) => void;

  toast: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;

  selectedName: string | null;
  setSelectedName: (name: string | null) => void;

  hasHidden: boolean;
  setHasHidden: (v: boolean) => void;

  /** Comment pins: positions are in the model pivot's local space. */
  comments: Comment[];
  commentMode: boolean;
  activeCommentId: number | null;
  toggleCommentMode: () => void;
  addComment: (position: [number, number, number]) => void;
  updateComment: (id: number, text: string) => void;
  removeComment: (id: number) => void;
  clearComments: () => void;
  setActiveComment: (id: number | null) => void;

  /** Markup drawing: while a tool is active the left button draws and the right button orbits. */
  markupTool: MarkupTool;
  markupColor: string;
  markupWidth: number;
  strokes: MarkupStroke[];
  setMarkupTool: (tool: MarkupTool) => void;
  setMarkupColor: (color: string) => void;
  setMarkupWidth: (width: number) => void;
  addStroke: (stroke: Omit<MarkupStroke, "id">) => void;
  undoStroke: () => void;
  clearStrokes: () => void;

  dropzoneVisible: boolean;
  setDropzoneVisible: (v: boolean) => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
}

export const useViewerStore = create<ViewerStore>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  updateSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
  resetOrientationSettings: () =>
    set((s) => ({
      settings: {
        ...s.settings,
        upAxis: DEFAULT_SETTINGS.upAxis,
        flipX: DEFAULT_SETTINGS.flipX,
        flipZ: DEFAULT_SETTINGS.flipZ,
        spin180: DEFAULT_SETTINGS.spin180,
      },
    })),

  viewMode: "standard",
  setViewMode: (viewMode) => set({ viewMode }),
  toggleHologram: () => set((s) => ({ viewMode: s.viewMode === "hologram" ? "standard" : "hologram" })),
  hologramSettings: { ...DEFAULT_HOLOGRAM_SETTINGS },
  updateHologramSetting: (key, value) => set((s) => ({ hologramSettings: { ...s.hologramSettings, [key]: value } })),

  fpsStats: null,
  setFpsStats: (fpsStats) => set({ fpsStats }),

  cubeAligned: false,
  cubeHover: false,
  setCubeAligned: (cubeAligned) => set({ cubeAligned }),
  setCubeHover: (cubeHover) => set({ cubeHover }),

  panelOpen: true,
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  fileName: null,
  stats: null,
  // A new model invalidates the pins placed on the previous one.
  setFileName: (name) => set({ fileName: name, comments: [], activeCommentId: null, strokes: [] }),
  setStats: (stats) => set({ stats }),

  loading: false,
  loadingText: "",
  setLoading: (loading, text) => set({ loading, loadingText: text ?? "" }),

  toast: null,
  showToast: (message) => set({ toast: message }),
  clearToast: () => set({ toast: null }),

  selectedName: null,
  setSelectedName: (name) => set({ selectedName: name }),

  hasHidden: false,
  setHasHidden: (v) => set({ hasHidden: v }),

  comments: [],
  commentMode: false,
  activeCommentId: null,
  toggleCommentMode: () =>
    set((s) => ({ commentMode: !s.commentMode, markupTool: s.commentMode ? s.markupTool : "off" })),
  addComment: (position) =>
    set((s) => {
      const id = s.comments.reduce((m, k) => Math.max(m, k.id), 0) + 1;
      return { comments: [...s.comments, { id, position, text: "" }], activeCommentId: id };
    }),
  updateComment: (id, text) => set((s) => ({ comments: s.comments.map((k) => (k.id === id ? { ...k, text } : k)) })),
  removeComment: (id) =>
    set((s) => ({
      comments: s.comments.filter((k) => k.id !== id),
      activeCommentId: s.activeCommentId === id ? null : s.activeCommentId,
    })),
  clearComments: () => set({ comments: [], activeCommentId: null }),
  setActiveComment: (id) => set({ activeCommentId: id }),

  markupTool: "off",
  markupColor: "#e0435a",
  markupWidth: 3,
  strokes: [],
  // Comment pins and drawing both own the left button, so only one is active at a time.
  setMarkupTool: (markupTool) => set((s) => ({ markupTool, commentMode: markupTool === "off" ? s.commentMode : false })),
  setMarkupColor: (markupColor) => set({ markupColor }),
  setMarkupWidth: (markupWidth) => set({ markupWidth }),
  addStroke: (stroke) =>
    set((s) => ({ strokes: [...s.strokes, { ...stroke, id: s.strokes.reduce((m, k) => Math.max(m, k.id), 0) + 1 }] })),
  undoStroke: () => set((s) => ({ strokes: s.strokes.slice(0, -1) })),
  clearStrokes: () => set({ strokes: [] }),

  dropzoneVisible: true,
  setDropzoneVisible: (v) => set({ dropzoneVisible: v }),
  dragOver: false,
  setDragOver: (v) => set({ dragOver: v }),
}));
