import { create } from "zustand";
import { HOLOGRAM_EDGES_MAX_TRIANGLES } from "../three/constants";
import {
  DEFAULT_HOLOGRAM_SETTINGS,
  DEFAULT_SETTINGS,
  type HologramSettings,
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

  panelOpen: true,
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  fileName: null,
  stats: null,
  setFileName: (name) => set({ fileName: name }),
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

  dropzoneVisible: true,
  setDropzoneVisible: (v) => set({ dropzoneVisible: v }),
  dragOver: false,
  setDragOver: (v) => set({ dragOver: v }),
}));
