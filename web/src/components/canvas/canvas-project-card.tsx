import { useState } from "react";
import { Button, Dropdown, Input, Tag, type MenuProps } from "antd";
import { Check, Download, MoreHorizontal, Move, Pencil, Star, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { CanvasProjectCover } from "@/components/canvas/canvas-project-cover";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { canvasProjectTitle } from "@/lib/canvas/canvas-project-title";
import { useI18n } from "@/i18n/use-i18n";

export function CanvasProjectCard({ project, openUrl, onMove }: { project: CanvasProject; openUrl: string; onMove: () => void }) {
    const { t, language } = useI18n();
    const navigate = useNavigate();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(project.title);
    const selected = selectedIds.includes(project.id);
    const displayTitle = canvasProjectTitle(project.title, t);
    const open = () => navigate(openUrl);
    const saveTitle = () => {
        renameProject(project.id, title);
        setEditing(false);
    };
    const cancelRename = () => {
        setTitle(project.title);
        setEditing(false);
    };
    const menu: MenuProps = {
        items: [
            { key: "rename", icon: <Pencil className="size-4" />, label: t("canvas.rename") },
            { key: "move", icon: <Move className="size-4" />, label: t("canvas.move") },
            { key: "default", icon: <Star className="size-4" />, label: project.isDefault ? t("canvas.unsetDefault") : t("canvas.setDefault") },
            { key: "export", icon: <Download className="size-4" />, label: t("canvas.export") },
            { type: "divider" },
            { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.delete") },
        ],
        onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === "rename") setEditing(true);
            if (key === "move") onMove();
            if (key === "default") updateProject(project.id, { isDefault: !project.isDefault });
            if (key === "export") void exportCanvasProjects([project], displayTitle);
            if (key === "delete") setDeleteIds([project.id]);
        },
    };

    return (
        <article
            className="group relative flex min-h-56 cursor-pointer flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-white/5 dark:hover:border-stone-700 max-[390px]:min-h-32 max-[390px]:flex-row"
            onClick={() => !editing && open()}
        >
            <button type="button" className="block w-full shrink-0 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] max-[390px]:w-36" onClick={open} aria-label={t("canvas.openProject", { title: displayTitle })}>
                <CanvasProjectCover storageKey={project.coverStorageKey} title={displayTitle} />
            </button>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 p-4">
                <div className="flex min-w-0 items-start gap-2">
                    <input
                        type="checkbox"
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => toggleSelected(project.id, event.target.checked)}
                        className="mt-1 size-4 shrink-0 accent-stone-950 dark:accent-stone-100"
                        aria-label={t("canvas.selectProject", { title: displayTitle })}
                    />
                    <div className="min-w-0 flex-1">
                        {editing ? (
                            <Input value={title} autoFocus onClick={(event) => event.stopPropagation()} onChange={(event) => setTitle(event.target.value)} onPressEnter={saveTitle} onKeyDown={(event) => event.key === "Escape" && cancelRename()} />
                        ) : (
                            <button type="button" className="block w-full text-left focus-visible:outline-2" onClick={open}>
                                <h2 className="truncate text-base font-semibold">{displayTitle}</h2>
                            </button>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {project.isDefault ? <Tag color="gold">{t("canvas.defaultTag")}</Tag> : null}
                            <span className="text-xs text-stone-500">{t("canvas.projectStats", { nodes: project.nodes.length, connections: project.connections.length })}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-between gap-2" onClick={(event) => event.stopPropagation()}>
                    <p className="truncate text-xs text-stone-500">{t("canvas.updatedAt", { time: new Date(project.updatedAt).toLocaleString(language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                    {editing ? (
                        <span className="flex shrink-0">
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label={t("canvas.saveName")} />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={cancelRename} aria-label={t("canvas.cancelRename")} />
                        </span>
                    ) : (
                        <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
                            <Button type="text" size="small" shape="circle" icon={<MoreHorizontal className="size-5" />} aria-label={t("canvas.moreActions", { name: displayTitle })} onClick={(event) => event.stopPropagation()} />
                        </Dropdown>
                    )}
                </div>
            </div>
        </article>
    );
}
