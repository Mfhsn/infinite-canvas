import { App, Button, Modal } from "antd";

import { getBlobRepository } from "@/services/storage/runtime";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { useI18n } from "@/i18n/use-i18n";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const { t } = useI18n();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = async () => {
        const state = useCanvasStore.getState();
        const covers = state.projects.filter((project) => ids.includes(project.id)).flatMap((project) => (project.coverStorageKey ? [project.coverStorageKey] : []));
        deleteProjects(ids);
        try {
            await useCanvasStore.getState().flush();
        } catch (error) {
            useCanvasStore.getState().replaceProjects(state.projects);
            void useCanvasStore
                .getState()
                .flush()
                .catch(() => undefined);
            message.error(error instanceof Error ? error.message : String(error));
            return;
        }
        if (covers.length) {
            const repository = await getBlobRepository();
            await Promise.allSettled(covers.map((storageKey) => repository.delete(storageKey)));
        }
        cleanupImages();
        removeSelectedIds(ids);
        setDeleteIds([]);
    };

    return (
        <Modal
            title={t("canvas.deleteProjectsTitle")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{t("common.cancel")}</Button>
                    <Button danger type="primary" onClick={() => void confirm()}>
                        {t("common.delete")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">{t("canvas.deleteProjectsConfirm", { count: ids.length })}</p>
        </Modal>
    );
}
