import { Modal, Tree } from "antd";

import { useI18n } from "@/i18n/use-i18n";

export type CanvasMoveFolder = { id: string; name: string; parentId: string | null };
const MAX_TREE_DEPTH = 1_000;

export function CanvasMoveDialog({
    open,
    title,
    folders,
    currentFolderId,
    disabledFolderIds = [],
    onCancel,
    onMove,
}: {
    open: boolean;
    title: string;
    folders: CanvasMoveFolder[];
    currentFolderId: string | null;
    disabledFolderIds?: string[];
    onCancel: () => void;
    onMove: (folderId: string | null) => void;
}) {
    const { t } = useI18n();
    const disabled = new Set(disabledFolderIds);
    const treeData = [
        {
            key: "__root__",
            title: t("canvas.rootFolder"),
            children: buildTree(folders, null, disabled),
        },
    ];
    return (
        <Modal title={title} open={open} centered footer={null} onCancel={onCancel} destroyOnHidden>
            <p className="mb-4 text-sm text-stone-500">{t("canvas.moveHint")}</p>
            <Tree
                blockNode
                defaultExpandAll
                selectedKeys={[currentFolderId || "__root__"]}
                treeData={treeData}
                aria-label={t("canvas.moveDestination")}
                onSelect={(keys, info) => {
                    if (!keys.length || info.node.disabled) return;
                    onMove(keys[0] === "__root__" ? null : String(keys[0]));
                }}
            />
        </Modal>
    );
}

function buildTree(folders: CanvasMoveFolder[], parentId: string | null, disabled: Set<string>, visited = new Set<string>(), depth = 0): Array<{ key: string; title: string; disabled: boolean; children: ReturnType<typeof buildTree> }> {
    if (depth >= MAX_TREE_DEPTH) return [];
    return folders
        .filter((folder) => folder.parentId === parentId && !visited.has(folder.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((folder) => {
            const nextVisited = new Set(visited).add(folder.id);
            return { key: folder.id, title: folder.name, disabled: disabled.has(folder.id), children: buildTree(folders, folder.id, disabled, nextVisited, depth + 1) };
        });
}
