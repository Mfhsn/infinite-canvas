import { App, Button, Progress, Tag } from "antd";
import { Database, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n/use-i18n";
import { migrateBrowserDataToMysql, type BrowserDataMigrationResult } from "@/services/storage/migrate-browser-data";
import { getStorageRuntimeConfig } from "@/services/storage/runtime";
import type { StorageRuntimeConfig } from "@/services/storage/types";

export function StorageSettingsPanel() {
    const { message } = App.useApp();
    const { t } = useI18n();
    const [config, setConfig] = useState<StorageRuntimeConfig>();
    const [error, setError] = useState("");
    const [migrating, setMigrating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState<BrowserDataMigrationResult>();

    useEffect(() => {
        void getStorageRuntimeConfig()
            .then(setConfig)
            .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, []);

    const migrate = async () => {
        setMigrating(true);
        setProgress(0);
        setResult(undefined);
        try {
            const next = await migrateBrowserDataToMysql((completed, total) => setProgress(total ? Math.round((completed / total) * 100) : 100));
            setResult(next);
            if (next.failures.length) message.warning(t("config.storage.importPartial", { count: next.failures.length }));
            else message.success(t("config.storage.importDone", { documents: next.documents, files: next.blobs }));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setMigrating(false);
        }
    };

    return (
        <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Database className="size-4" />
                        {t("config.storage.title")}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-stone-500">{t("config.storage.desc")}</div>
                </div>
                <Tag color={config?.driver === "mysql" ? "blue" : "default"}>{config ? t(config.driver === "mysql" ? "config.storage.mysql" : "config.storage.browser") : error ? t("config.storage.unavailable") : t("common.loading")}</Tag>
            </div>
            {config ? (
                <div className="mt-4 grid gap-2 rounded-md bg-stone-50 p-3 text-xs dark:bg-stone-900 md:grid-cols-2">
                    <div>
                        {t("config.storage.driver")}: <strong>{config.driver}</strong>
                    </div>
                    <div>
                        {t("config.storage.namespace")}: <strong>{config.namespace}</strong>
                    </div>
                </div>
            ) : null}
            {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
            <div className="mt-4 text-xs leading-5 text-stone-500">{t("config.storage.switchHint")}</div>
            {config?.driver === "mysql" ? (
                <div className="mt-4 rounded-md border border-dashed border-stone-300 p-3 dark:border-stone-700">
                    <div className="text-sm font-medium">{t("config.storage.importTitle")}</div>
                    <div className="mt-1 text-xs leading-5 text-stone-500">{t("config.storage.importDesc")}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button type="primary" icon={<UploadCloud className="size-4" />} loading={migrating} onClick={() => void migrate()}>
                            {t("config.storage.importAction")}
                        </Button>
                        {migrating || progress ? <Progress className="max-w-72" percent={progress} size="small" /> : null}
                    </div>
                    {result ? (
                        <>
                            <div className="mt-3 text-xs text-stone-500">{t("config.storage.importResult", { documents: result.documents, files: result.blobs, failures: result.failures.length })}</div>
                            {result.documents || result.blobs ? (
                                <Button className="mt-2" size="small" onClick={() => window.location.reload()}>
                                    {t("config.storage.reload")}
                                </Button>
                            ) : null}
                            {result.failures.length ? (
                                <ul className="thin-scrollbar mt-2 max-h-28 overflow-y-auto rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300">
                                    {result.failures.map((failure) => (
                                        <li key={failure.key} className="break-all">
                                            {failure.key}: {failure.message}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
