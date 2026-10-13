import { FileLoader } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import wasmWrapperUrl from "three/examples/jsm/libs/draco/draco_wasm_wrapper.js?url";
import wasmBinaryUrl from "three/examples/jsm/libs/draco/draco_decoder.wasm?url";

const LIBRARY_URLS: Record<string, string> = {
  "draco_wasm_wrapper.js": wasmWrapperUrl,
  "draco_decoder.wasm": wasmBinaryUrl,
};

/**
 * DRACOLoader whose decoder files come from the three package via Vite asset
 * imports, so no CDN or static copy is needed. Relies on the private
 * `_loadLibrary` hook, which exists in three r160.
 */
export class BundledDRACOLoader extends DRACOLoader {
  _loadLibrary(name: string, responseType: "text" | "arraybuffer") {
    const loader = new FileLoader(this.manager);
    loader.setResponseType(responseType);
    return new Promise((resolve, reject) => {
      loader.load(LIBRARY_URLS[name] ?? name, resolve, undefined, reject);
    });
  }
}
