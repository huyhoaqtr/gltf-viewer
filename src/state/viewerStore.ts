import { create } from "zustand";
import { DEFAULT_SETTINGS, type ModelStats, type ViewerSettings } from "../types/viewer";

interface ViewerStore {
  // Mirrors the engine's current settings so React inputs stay controlled.
  // Components update this AND call the matching ViewerEngine setter.
  settings: ViewerSettings;
  updateSetting: <K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) => void;
  resetOrientationSettings: () => void;

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
      settings: { ...s.settings, upAxis: "y", flipX: false, flipZ: false, spin180: false },
    })),

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
