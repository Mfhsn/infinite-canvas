import { Breadcrumb } from "antd";
import { Home } from "lucide-react";

import { useI18n } from "@/i18n/use-i18n";

export type CanvasFolderBreadcrumb = { id: string; name: string };

export function CanvasFolderBreadcrumbs({ items, onNavigate }: { items: CanvasFolderBreadcrumb[]; onNavigate: (folderId: string | null) => void }) {
    const { t } = useI18n();
    return (
        <nav aria-label={t("canvas.folderBreadcrumbs")}>
            <Breadcrumb
                items={[
                    {
                        title: (
                            <button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-stone-950 focus-visible:outline-2 dark:hover:text-white" onClick={() => onNavigate(null)}>
                                <Home className="size-3.5" aria-hidden />
                                {t("canvas.rootFolder")}
                            </button>
                        ),
                    },
                    ...items.map((item, index) => ({
                        title:
                            index === items.length - 1 ? (
                                <span aria-current="page">{item.name}</span>
                            ) : (
                                <button type="button" className="rounded px-1 py-0.5 hover:text-stone-950 focus-visible:outline-2 dark:hover:text-white" onClick={() => onNavigate(item.id)}>
                                    {item.name}
                                </button>
                            ),
                    })),
                ]}
            />
        </nav>
    );
}
