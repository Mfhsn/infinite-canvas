import { Button, Modal } from "antd";

import { useI18n } from "@/i18n/use-i18n";

export type CanvasFolderDeleteCounts = { childFolders: number; directCanvases: number; totalResources: number };

export function CanvasDeleteFolderDialog({ open, folderName, counts, loading, onCancel, onConfirm }: { open: boolean; folderName: string; counts: CanvasFolderDeleteCounts; loading?: boolean; onCancel: () => void; onConfirm: () => void }) {
    const { t } = useI18n();
    return (
        <Modal
            title={t("canvas.deleteFolderTitle")}
            open={open}
            centered
            onCancel={onCancel}
            footer={
                <>
                    <Button onClick={onCancel}>{t("common.cancel")}</Button>
                    <Button danger type="primary" loading={loading} onClick={onConfirm}>
                        {t("common.delete")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-600 dark:text-stone-300">{t("canvas.deleteFolderConfirm", { name: folderName })}</p>
            <p className="mt-3 text-sm text-stone-500">{t("canvas.deleteFolderCounts", counts)}</p>
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("canvas.deleteFolderKeepsCanvases")}</p>
        </Modal>
    );
}
