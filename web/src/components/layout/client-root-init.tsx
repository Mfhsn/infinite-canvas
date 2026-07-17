import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createDreamApiChannel, useConfigStore } from "@/stores/use-config-store";
import { useI18n } from "@/i18n/use-i18n";
import { getLastStorageError, STORAGE_ERROR_EVENT } from "@/services/storage/types";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { t } = useI18n();
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createDreamApiChannel({ baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success(t("app.localConfigImported"));
    }, [config.channels, message, openConfigDialog, t, updateConfig]);

    useEffect(() => {
        const handleStorageError = (event: Event) => {
            const detail = (event as CustomEvent<string>).detail;
            message.error({ content: t("error.storage.failed", { detail }), key: "storage-error", duration: 6 });
        };
        window.addEventListener(STORAGE_ERROR_EVENT, handleStorageError);
        const pendingError = getLastStorageError();
        if (pendingError) message.error({ content: t("error.storage.failed", { detail: pendingError }), key: "storage-error", duration: 6 });
        return () => window.removeEventListener(STORAGE_ERROR_EVENT, handleStorageError);
    }, [message, t]);

    return <>{children}</>;
}
