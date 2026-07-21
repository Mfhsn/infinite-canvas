import { useState } from "react";
import { Button, Dropdown, Input, type MenuProps } from "antd";
import { Check, Folder, MoreHorizontal, Move, Pencil, Trash2, X } from "lucide-react";

import { useI18n } from "@/i18n/use-i18n";

export type CanvasFolderCardFolder = { id: string; name: string; updatedAt: string };

export function CanvasFolderCard({ folder, itemCount, onOpen, onRename, onMove, onDelete }: { folder: CanvasFolderCardFolder; itemCount: number; onOpen: () => void; onRename: (name: string) => void; onMove: () => void; onDelete: () => void }) {
    const { t, language } = useI18n();
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(folder.name);
    const save = () => {
        const nextName = name.trim();
        if (nextName && nextName !== folder.name) onRename(nextName);
        setEditing(false);
    };
    const cancel = () => {
        setName(folder.name);
        setEditing(false);
    };
    const menu: MenuProps = {
        items: [
            { key: "rename", icon: <Pencil className="size-4" />, label: t("canvas.rename") },
            { key: "move", icon: <Move className="size-4" />, label: t("canvas.move") },
            { type: "divider" },
            { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.delete") },
        ],
        onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === "rename") setEditing(true);
            if (key === "move") onMove();
            if (key === "delete") onDelete();
        },
    };

    return (
        <article
            className="group flex min-h-32 cursor-pointer items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-sm focus-within:ring-2 focus-within:ring-stone-400 dark:border-stone-800 dark:bg-white/5 dark:hover:border-stone-700 sm:min-h-40 sm:flex-col sm:items-stretch sm:justify-between"
            onClick={() => !editing && onOpen()}
        >
            <div className="flex min-w-0 flex-1 items-center gap-4 text-left sm:flex-col sm:items-start">
                <button
                    type="button"
                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 focus-visible:outline-2 dark:bg-amber-400/10 dark:text-amber-300 sm:size-16"
                    onClick={onOpen}
                    aria-label={t("canvas.openFolder", { name: folder.name })}
                >
                    <Folder className="size-7" fill="currentColor" aria-hidden />
                </button>
                <div className="min-w-0 max-w-full">
                    {editing ? (
                        <Input value={name} autoFocus onClick={(event) => event.stopPropagation()} onChange={(event) => setName(event.target.value)} onPressEnter={save} onKeyDown={(event) => event.key === "Escape" && cancel()} />
                    ) : (
                        <button type="button" className="block max-w-full truncate text-left text-base font-semibold focus-visible:outline-2" onClick={onOpen}>
                            {folder.name}
                        </button>
                    )}
                    <span className="mt-1 block text-xs text-stone-500">{t("canvas.folderItemCount", { count: itemCount })}</span>
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 sm:mt-4" onClick={(event) => event.stopPropagation()}>
                <span className="hidden text-xs text-stone-500 sm:block">{new Date(folder.updatedAt).toLocaleDateString(language)}</span>
                {editing ? (
                    <span className="flex">
                        <Button type="text" shape="circle" size="small" icon={<Check className="size-4" />} aria-label={t("canvas.saveName")} onClick={save} />
                        <Button type="text" shape="circle" size="small" icon={<X className="size-4" />} aria-label={t("canvas.cancelRename")} onClick={cancel} />
                    </span>
                ) : (
                    <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
                        <Button type="text" shape="circle" icon={<MoreHorizontal className="size-5" />} aria-label={t("canvas.moreActions", { name: folder.name })} onClick={(event) => event.stopPropagation()} />
                    </Dropdown>
                )}
            </div>
        </article>
    );
}
