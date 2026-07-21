import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Input, Modal } from "antd";
import { Download, Plus, Trash2 } from "lucide-react";

import { CanvasDeleteFolderDialog, type CanvasFolderDeleteCounts } from "@/components/canvas/canvas-delete-folder-dialog";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasFolderBreadcrumbs } from "@/components/canvas/canvas-folder-breadcrumbs";
import { CanvasFolderCard } from "@/components/canvas/canvas-folder-card";
import { CanvasLibraryToolbar } from "@/components/canvas/canvas-library-toolbar";
import { CanvasMoveDialog } from "@/components/canvas/canvas-move-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { useI18n } from "@/i18n/use-i18n";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { importCanvasArchive } from "@/lib/canvas/canvas-import";
import { applyFolderDeletionToFolders, applyFolderDeletionToProjects, getFolderDeletionImpact } from "@/lib/canvas/canvas-folder-actions";
import { findNearestActiveFolder } from "@/lib/canvas/canvas-library";
import { CanvasArchiveImportError } from "@/lib/canvas/canvas-import";
import { buildCanvasLibrarySearch, buildCanvasProjectUrl, buildProjectHandoffSearch, isCanvasAgentMode, parseCanvasLibraryRoute, type CanvasLibraryType } from "@/lib/canvas/canvas-library-route";
import { readZip } from "@/lib/zip";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import type { CanvasFolder, CanvasProject } from "@/types/canvas-library";

const MAX_FOLDER_TRAVERSAL = 10_000;
type MoveTarget = { kind: "project" | "folder"; id: string; name: string } | null;

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const route = parseCanvasLibraryRoute(searchParams);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const projectsHydrated = useCanvasStore((state) => state.hydrated);
    const projectsHydrationStatus = useCanvasStore((state) => state.hydrationStatus);
    const retryProjectsHydration = useCanvasStore((state) => state.retryHydration);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const foldersHydrated = useCanvasFolderStore((state) => state.hydrated);
    const foldersHydrationStatus = useCanvasFolderStore((state) => state.hydrationStatus);
    const retryFoldersHydration = useCanvasFolderStore((state) => state.retryHydration);
    const folders = useCanvasFolderStore((state) => state.folders);
    const createFolder = useCanvasFolderStore((state) => state.createFolder);
    const renameFolder = useCanvasFolderStore((state) => state.renameFolder);
    const moveFolder = useCanvasFolderStore((state) => state.moveFolder);
    const deleteFolder = useCanvasFolderStore((state) => state.deleteFolder);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const [draftQ, setDraftQ] = useState(route.q);
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [moveTarget, setMoveTarget] = useState<MoveTarget>(null);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const hydrated = projectsHydrated && foldersHydrated;
    const hydrationFailed = projectsHydrationStatus === "error" || foldersHydrationStatus === "error";
    const activeFolders = useMemo(() => folders.filter((folder) => !folder.deletedAt), [folders]);
    const currentFolder = route.folder ? activeFolders.find((folder) => folder.id === route.folder) || null : null;
    const currentFolderId = currentFolder?.id || null;

    const commitRoute = (patch: { folder?: string | null; q?: string; type?: CanvasLibraryType }, replace = false) => {
        const next = buildProjectHandoffSearch(searchParams);
        buildCanvasLibrarySearch({ folder: patch.folder === undefined ? currentFolderId : patch.folder, q: patch.q === undefined ? draftQ : patch.q, type: patch.type || route.type }).forEach((value, key) => next.set(key, value));
        setSearchParams(next, { replace });
    };
    const commitQuery = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        commitRoute({ q: draftQ }, true);
    };
    const enterProject = (id: string) => navigate(buildCanvasProjectUrl(id, searchParams));
    const createAndEnter = () => {
        const id = createProject(t("canvas.defaultTitle", { index: projects.length + 1 }), currentFolderId);
        enterProject(id);
    };

    useEffect(() => {
        setDraftQ(route.q);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [route.q]);

    useEffect(() => {
        if (draftQ === route.q) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => commitRoute({ q: draftQ }, true), 220);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [draftQ]);

    useEffect(() => {
        if (!hydrated || !route.folder || currentFolder) return;
        commitRoute({ folder: null }, true);
    }, [currentFolder, hydrated, route.folder]);

    useEffect(() => {
        const mode = searchParams.get("mode");
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        const id = mode === "new" ? createProject(t("canvas.defaultTitle", { index: projects.length + 1 })) : projects[0]?.id || createProject(t("canvas.defaultTitle", { index: projects.length + 1 }));
        enterProject(id);
    }, [createProject, hydrated, projects, searchParams]);

    const effectiveFolders = useMemo(() => activeFolders.map((folder) => ({ ...folder, parentId: findNearestActiveFolder(folder.parentId, folders).folderId })), [activeFolders, folders]);
    const directFolders = useMemo(() => effectiveFolders.filter((folder) => folder.parentId === currentFolderId), [effectiveFolders, currentFolderId]);
    const directProjects = useMemo(() => projects.filter((project) => findNearestActiveFolder(project.folderId, folders).folderId === currentFolderId), [currentFolderId, folders, projects]);
    const normalizedQuery = draftQ.trim().toLocaleLowerCase();
    const visibleFolders = route.type === "canvas" ? [] : directFolders.filter((folder) => !normalizedQuery || folder.name.toLocaleLowerCase().includes(normalizedQuery)).sort(compareResources);
    const visibleProjects = route.type === "folder" ? [] : directProjects.filter((project) => !normalizedQuery || project.title.toLocaleLowerCase().includes(normalizedQuery)).sort(compareResources);
    const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects]);
    const breadcrumbs = useMemo(() => buildBreadcrumbs(currentFolderId, effectiveFolders), [effectiveFolders, currentFolderId]);

    useEffect(() => {
        selectedIds.forEach((id) => {
            if (!visibleProjectIds.has(id)) toggleSelected(id, false);
        });
    }, [currentFolderId, route.type, route.q]);

    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const result = await importCanvasArchive(zip, currentFolderId);
            message.success(t("canvas.importSuccess", { count: result.projects }));
        } catch (error) {
            if (error instanceof CanvasArchiveImportError && error.compensationFailed) {
                message.error(`${t("canvas.importFailed")} (${error.importedProjects} projects, ${error.importedFolders} folders, ${error.writtenFiles} files require cleanup)`);
            } else message.error(t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };
    const confirmCreateFolder = () => {
        const name = newFolderName.trim();
        if (!name) return;
        createFolder(name, currentFolderId);
        setNewFolderName("");
        setNewFolderOpen(false);
    };
    const deletedFolder = activeFolders.find((folder) => folder.id === deleteTargetId) || null;
    const deleteCounts = deletedFolder ? countFolderResources(deletedFolder.id, activeFolders, projects) : { childFolders: 0, directCanvases: 0, totalResources: 0 };
    const confirmDeleteFolder = async () => {
        if (!deletedFolder) return;
        const previousProjects = useCanvasStore.getState().projects;
        const previousFolders = useCanvasFolderStore.getState().folders;
        const impact = getFolderDeletionImpact(deletedFolder.id, previousFolders, previousProjects);
        let tombstoneCommitted = false;
        deleteFolder(deletedFolder.id);
        try {
            await useCanvasFolderStore.getState().flush();
            tombstoneCommitted = true;
            useCanvasFolderStore.getState().replaceFolders(applyFolderDeletionToFolders(useCanvasFolderStore.getState().folders, impact));
            useCanvasStore.getState().replaceProjects(applyFolderDeletionToProjects(previousProjects, impact));
            await Promise.all([useCanvasFolderStore.getState().flush(), useCanvasStore.getState().flush()]);
            setDeleteTargetId(null);
        } catch (error) {
            if (!tombstoneCommitted) {
                useCanvasFolderStore.getState().replaceFolders(previousFolders);
                useCanvasStore.getState().replaceProjects(previousProjects);
            }
            message.error(error instanceof Error ? error.message : String(error));
        }
    };
    const moveDisabledIds = moveTarget?.kind === "folder" ? [moveTarget.id, ...collectDescendantIds(moveTarget.id, activeFolders)] : [];
    const performMove = (folderId: string | null) => {
        if (!moveTarget) return;
        if (moveTarget.kind === "project") updateProject(moveTarget.id, { folderId });
        else moveFolder(moveTarget.id, folderId);
        setMoveTarget(null);
    };

    if (hydrated && isCanvasAgentMode(searchParams.get("mode")) && searchParams.get("mode") !== "choose") {
        return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;
    }

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">{t("canvas.library")}</p>
                        <h1 className="mt-2 text-3xl font-semibold">{t("canvas.title")}</h1>
                    </div>
                    {selectedIds.length ? (
                        <div className="flex flex-wrap gap-2">
                            <Button
                                icon={<Download className="size-4" />}
                                onClick={() =>
                                    void exportCanvasProjects(
                                        projects.filter((project) => selectedIds.includes(project.id)),
                                        t("canvas.exportFilename", { count: selectedIds.length }),
                                        folders,
                                    )
                                }
                            >
                                {t("canvas.exportSelected")}
                            </Button>
                            <Button danger icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds(selectedIds)}>
                                {t("canvas.deleteSelected")}
                            </Button>
                        </div>
                    ) : null}
                </header>

                <CanvasFolderBreadcrumbs items={breadcrumbs} onNavigate={(folder) => commitRoute({ folder })} />
                <CanvasLibraryToolbar
                    query={draftQ}
                    type={route.type}
                    disabled={!hydrated}
                    onQueryChange={setDraftQ}
                    onQueryCommit={commitQuery}
                    onTypeChange={(type) => commitRoute({ type })}
                    onCreateFolder={() => setNewFolderOpen(true)}
                    onImport={() => inputRef.current?.click()}
                    onCreateCanvas={createAndEnter}
                />

                {hydrationFailed ? (
                    <section className="flex min-h-80 flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-lg font-medium">{t("canvas.libraryLoadFailed")}</h2>
                        <p className="mt-2 text-sm text-stone-500">{t("canvas.libraryLoadFailedDesc")}</p>
                        <Button
                            className="mt-5"
                            onClick={() => void Promise.all([projectsHydrationStatus === "error" ? retryProjectsHydration() : Promise.resolve(), foldersHydrationStatus === "error" ? retryFoldersHydration() : Promise.resolve()]).catch(() => undefined)}
                        >
                            {t("common.retry")}
                        </Button>
                    </section>
                ) : !hydrated ? (
                    <section className="flex min-h-80 items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">{t("canvas.loading")}</section>
                ) : visibleFolders.length || visibleProjects.length ? (
                    <section className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" aria-live="polite">
                        {visibleFolders.map((folder) => (
                            <CanvasFolderCard
                                key={folder.id}
                                folder={folder}
                                itemCount={effectiveFolders.filter((item) => item.parentId === folder.id).length + projects.filter((project) => findNearestActiveFolder(project.folderId, folders).folderId === folder.id).length}
                                onOpen={() => commitRoute({ folder: folder.id })}
                                onRename={(name) => renameFolder(folder.id, name)}
                                onMove={() => setMoveTarget({ kind: "folder", id: folder.id, name: folder.name })}
                                onDelete={() => setDeleteTargetId(folder.id)}
                            />
                        ))}
                        {visibleProjects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} openUrl={buildCanvasProjectUrl(project.id, searchParams)} onMove={() => setMoveTarget({ kind: "project", id: project.id, name: project.title })} />
                        ))}
                    </section>
                ) : (
                    <section className="flex min-h-80 flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">{projects.length || activeFolders.length ? t("canvas.emptyFolderTitle") : t("canvas.emptyTitle")}</h2>
                        <p className="mt-3 max-w-md text-sm text-stone-500">{projects.length || activeFolders.length ? t("canvas.emptyFolderDesc") : t("canvas.emptyDesc")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.new")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <Modal
                title={t("canvas.newFolderTitle")}
                open={newFolderOpen}
                centered
                okText={t("common.create")}
                cancelText={t("common.cancel")}
                okButtonProps={{ disabled: !newFolderName.trim() }}
                onOk={confirmCreateFolder}
                onCancel={() => setNewFolderOpen(false)}
            >
                <label className="block text-sm font-medium" htmlFor="new-canvas-folder-name">
                    {t("canvas.folderName")}
                </label>
                <Input id="new-canvas-folder-name" className="mt-2" autoFocus value={newFolderName} placeholder={t("canvas.folderNamePlaceholder")} onChange={(event) => setNewFolderName(event.target.value)} onPressEnter={confirmCreateFolder} />
            </Modal>
            <CanvasMoveDialog
                open={Boolean(moveTarget)}
                title={moveTarget?.kind === "folder" ? t("canvas.moveFolderTitle") : t("canvas.moveCanvasTitle")}
                folders={effectiveFolders}
                currentFolderId={
                    moveTarget?.kind === "project" ? findNearestActiveFolder(projects.find((project) => project.id === moveTarget.id)?.folderId, folders).folderId : effectiveFolders.find((folder) => folder.id === moveTarget?.id)?.parentId || null
                }
                disabledFolderIds={moveDisabledIds}
                onCancel={() => setMoveTarget(null)}
                onMove={performMove}
            />
            <CanvasDeleteFolderDialog open={Boolean(deletedFolder)} folderName={deletedFolder?.name || ""} counts={deleteCounts} onCancel={() => setDeleteTargetId(null)} onConfirm={() => void confirmDeleteFolder()} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}

function compareResources(a: { updatedAt: string; id: string; name?: string; title?: string }, b: { updatedAt: string; id: string; name?: string; title?: string }) {
    return b.updatedAt.localeCompare(a.updatedAt) || (a.name || a.title || "").localeCompare(b.name || b.title || "") || a.id.localeCompare(b.id);
}

function buildBreadcrumbs(folderId: string | null, folders: CanvasFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result: Array<{ id: string; name: string }> = [];
    const visited = new Set<string>();
    let current = folderId;
    while (current && result.length < MAX_FOLDER_TRAVERSAL && !visited.has(current)) {
        visited.add(current);
        const folder = byId.get(current);
        if (!folder) break;
        result.unshift({ id: folder.id, name: folder.name });
        current = folder.parentId;
    }
    return result;
}

function collectDescendantIds(folderId: string, folders: CanvasFolder[]) {
    const result: string[] = [];
    const queue = [folderId];
    const visited = new Set<string>();
    while (queue.length && visited.size < MAX_FOLDER_TRAVERSAL) {
        const parentId = queue.shift()!;
        if (visited.has(parentId)) continue;
        visited.add(parentId);
        for (const folder of folders) {
            if (folder.parentId !== parentId || visited.has(folder.id)) continue;
            result.push(folder.id);
            queue.push(folder.id);
        }
    }
    return result;
}

function countFolderResources(folderId: string, folders: CanvasFolder[], projects: CanvasProject[]): CanvasFolderDeleteCounts {
    const descendants = collectDescendantIds(folderId, folders);
    const subtreeIds = new Set([folderId, ...descendants]);
    return {
        childFolders: folders.filter((folder) => folder.parentId === folderId).length,
        directCanvases: projects.filter((project) => project.folderId === folderId).length,
        totalResources: descendants.length + projects.filter((project) => project.folderId && subtreeIds.has(project.folderId)).length,
    };
}
