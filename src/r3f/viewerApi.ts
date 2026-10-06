/**
 * Imperative actions the DOM UI (top bar, drop zone, selection panel) needs
 * to trigger inside the R3F scene. The scene registers its ModelController
 * here on mount; before that (or after unmount) calls are no-ops.
 */
export interface ViewerApi {
  loadFile: (file: File) => void;
  fitToView: () => void;
  hideSelected: () => void;
  isolateSelected: () => void;
  showAllObjects: () => void;
}

let impl: ViewerApi | null = null;

export function registerViewerApi(api: ViewerApi | null) {
  impl = api;
}

export const viewerApi: ViewerApi = {
  loadFile: (file) => impl?.loadFile(file),
  fitToView: () => impl?.fitToView(),
  hideSelected: () => impl?.hideSelected(),
  isolateSelected: () => impl?.isolateSelected(),
  showAllObjects: () => impl?.showAllObjects(),
};
