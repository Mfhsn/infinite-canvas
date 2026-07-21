import { useEffect, useMemo, useState } from "react";
import { Button, Popover } from "antd";
import { ArrowLeft, Check, ChevronDown, Folder, Grid2X2, Plus, Star } from "lucide-react";

import { CanvasProjectCover } from "@/components/canvas/canvas-project-cover";
import { useI18n } from "@/i18n/use-i18n";
import { findNearestActiveFolder } from "@/lib/canvas/canvas-library";
import { getCanvasProjectSwitcherView } from "@/lib/canvas/canvas-project-switcher";
import { canvasProjectTitle } from "@/lib/canvas/canvas-project-title";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export function CanvasProjectSwitcher({
    currentProjectId,
    title,
    onStartTitleEditing,
    onOpenProject,
    onViewProjects,
    onCreateProject,
}: {
    currentProjectId: string;
    title: string;
    onStartTitleEditing: () => void;
    onOpenProject: (projectId: string) => void;
    onViewProjects: (folderId: string | null) => void;
    onCreateProject: (folderId: string | null) => void;
}) {
    const { t, language } = useI18n();
    const projects = useCanvasStore((state) => state.projects);
    const folders = useCanvasFolderStore((state) => state.folders);
    const currentProject = projects.find((project) => project.id === currentProjectId);
    const currentFolderId = findNearestActiveFolder(currentProject?.folderId, folders).folderId;
    const [open, setOpen] = useState(false);
    const [folderId, setFolderId] = useState<string | null>(currentFolderId);

    useEffect(() => {
        if (open) setFolderId(currentFolderId);
    }, [currentFolderId, open]);

    const view = useMemo(() => getCanvasProjectSwitcherView(folderId, projects, folders), [folderId, folders, projects]);

    const content = (
        <section className="w-[360px] max-w-[calc(100vw-24px)] overflow-hidden" aria-label={t("canvas.switcher.title")}>
            <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-1 pb-3 dark:border-stone-700">
                <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} disabled={!folderId} onClick={() => setFolderId(view.currentFolder?.parentId || null)}>
                    {t("canvas.switcher.back")}
                </Button>
                <Button
                    type="text"
                    size="small"
                    icon={<Grid2X2 className="size-4" />}
                    onClick={() => {
                        setOpen(false);
                        onViewProjects(folderId);
                    }}
                >
                    {t("canvas.switcher.allProjects")}
                </Button>
            </div>

            <div className="flex min-h-9 items-center gap-1 overflow-x-auto border-b border-stone-200 px-1 py-2 text-xs text-stone-500 dark:border-stone-700">
                <button type="button" className="shrink-0 hover:text-stone-950 dark:hover:text-white" onClick={() => setFolderId(null)}>
                    {t("canvas.rootFolder")}
                </button>
                {view.breadcrumbs.map((folder) => (
                    <span key={folder.id} className="flex min-w-0 items-center gap-1">
                        <span>/</span>
                        <button type="button" className="max-w-32 truncate hover:text-stone-950 dark:hover:text-white" onClick={() => setFolderId(folder.id)}>
                            {folder.name}
                        </button>
                    </span>
                ))}
            </div>

            <div className="max-h-[min(520px,calc(100vh-180px))] overflow-y-auto py-2">
                {view.folders.map((folder) => (
                    <button key={folder.id} type="button" className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-left transition hover:bg-stone-100 dark:hover:bg-white/10" onClick={() => setFolderId(folder.id)}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                            <Folder className="size-5" fill="currentColor" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
                        <ChevronDown className="size-4 -rotate-90 text-stone-400" />
                    </button>
                ))}

                {view.projects.map((project) => {
                    const active = project.id === currentProjectId;
                    const displayTitle = canvasProjectTitle(project.title, t);
                    return (
                        <button
                            key={project.id}
                            type="button"
                            className={`flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition ${active ? "bg-stone-100 dark:bg-white/10" : "hover:bg-stone-100 dark:hover:bg-white/10"}`}
                            onClick={() => {
                                setOpen(false);
                                if (!active) onOpenProject(project.id);
                            }}
                        >
                            <span className="w-[72px] shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-700">
                                <CanvasProjectCover storageKey={project.coverStorageKey} title={displayTitle} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-sm font-medium">{displayTitle}</span>
                                    {project.isDefault ? <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label={t("canvas.defaultTag")} /> : null}
                                </span>
                                <span className="mt-1 block text-xs text-stone-500">{new Date(project.updatedAt).toLocaleString(language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                            </span>
                            {active ? <Check className="size-4 shrink-0" aria-label={t("canvas.switcher.current")} /> : null}
                        </button>
                    );
                })}

                {!view.folders.length && !view.projects.length ? <div className="px-4 py-10 text-center text-sm text-stone-500">{t("canvas.switcher.empty")}</div> : null}
            </div>

            <div className="border-t border-stone-200 pt-2 dark:border-stone-700">
                <Button
                    type="text"
                    block
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                        setOpen(false);
                        onCreateProject(folderId);
                    }}
                >
                    {t("canvas.switcher.newHere")}
                </Button>
            </div>
        </section>
    );

    return (
        <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomLeft" content={content} arrow={false} styles={{ content: { padding: 12, borderRadius: 8 } }}>
            <button
                type="button"
                className="flex max-w-[320px] min-w-0 items-center gap-1 rounded-md px-1 py-1 text-left text-lg font-semibold tracking-normal transition hover:bg-black/5 dark:hover:bg-white/10"
                aria-expanded={open}
                aria-label={t("canvas.switcher.open")}
                onDoubleClick={(event) => {
                    event.preventDefault();
                    setOpen(false);
                    onStartTitleEditing();
                }}
            >
                <span className="truncate">{title}</span>
                <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
        </Popover>
    );
}
