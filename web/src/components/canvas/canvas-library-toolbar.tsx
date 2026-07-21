import { Button, Input, Segmented } from "antd";
import { FileUp, FolderPlus, Plus, Search } from "lucide-react";

import type { CanvasLibraryType } from "@/lib/canvas/canvas-library-route";
import { useI18n } from "@/i18n/use-i18n";

type Props = {
    query: string;
    type: CanvasLibraryType;
    disabled?: boolean;
    onQueryChange: (value: string) => void;
    onQueryCommit: () => void;
    onTypeChange: (value: CanvasLibraryType) => void;
    onCreateFolder: () => void;
    onImport: () => void;
    onCreateCanvas: () => void;
};

export function CanvasLibraryToolbar({ query, type, disabled, onQueryChange, onQueryCommit, onTypeChange, onCreateFolder, onImport, onCreateCanvas }: Props) {
    const { t } = useI18n();
    return (
        <section className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" aria-label={t("canvas.libraryTools")}>
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                    allowClear
                    value={query}
                    disabled={disabled}
                    prefix={<Search className="size-4 text-stone-400" aria-hidden />}
                    placeholder={t("canvas.searchPlaceholder")}
                    aria-label={t("canvas.searchPlaceholder")}
                    className="max-w-md"
                    onChange={(event) => onQueryChange(event.target.value)}
                    onBlur={onQueryCommit}
                    onPressEnter={onQueryCommit}
                />
                <Segmented
                    value={type}
                    disabled={disabled}
                    aria-label={t("canvas.filterType")}
                    options={[
                        { value: "all", label: t("canvas.filterAll") },
                        { value: "canvas", label: t("canvas.filterCanvas") },
                        { value: "folder", label: t("canvas.filterFolder") },
                    ]}
                    onChange={(value) => onTypeChange(value as CanvasLibraryType)}
                />
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Button disabled={disabled} icon={<FolderPlus className="size-4" />} onClick={onCreateFolder}>
                    {t("canvas.newFolder")}
                </Button>
                <Button disabled={disabled} icon={<FileUp className="size-4" />} onClick={onImport}>
                    {t("canvas.import")}
                </Button>
                <Button disabled={disabled} type="primary" icon={<Plus className="size-4" />} onClick={onCreateCanvas}>
                    {t("canvas.new")}
                </Button>
            </div>
        </section>
    );
}
