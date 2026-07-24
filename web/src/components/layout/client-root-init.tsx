import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { AuthGate } from "@/components/layout/auth-gate";
import { createDreamApiChannel, useConfigStore } from "@/stores/use-config-store";
import { useI18n } from "@/i18n/use-i18n";
import { getLastStorageError, STORAGE_ERROR_EVENT } from "@/services/storage/types";
import { useUserStore } from "@/stores/use-user-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { t } = useI18n();
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const initializedPlatform = useRef(false);
    const initializePlatform = useUserStore((state) => state.initialize);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (initializedPlatform.current) return;
        initializedPlatform.current = true;
        void initializePlatform();
    }, [initializePlatform]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const hasApiKeyParam = searchParams.has("apiKey") || searchParams.has("apikey");
        if (!baseUrl && !hasApiKeyParam) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        // Credentials are never imported from URLs. This also removes legacy
        // apiKey query parameters before browser history, logs, or referrers can
        // retain them.
        if (!baseUrl) return;
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                baseUrl,
                            }
                          : channel,
                  )
                : [createDreamApiChannel({ baseUrl })],
        );
        updateConfig("baseUrl", baseUrl);
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

    return <AuthGate>{children}</AuthGate>;
}
