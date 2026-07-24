import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export async function hydrateSessionData() {
    await Promise.all([useCanvasStore.persist.rehydrate(), useCanvasFolderStore.persist.rehydrate(), useAssetStore.persist.rehydrate()]);
}

export async function flushSessionData() {
    await Promise.all([useCanvasStore.getState().flush(), useCanvasFolderStore.getState().flush(), useAssetStore.getState().flush()]);
}
