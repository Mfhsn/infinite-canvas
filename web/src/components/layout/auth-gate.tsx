import type { ReactNode } from "react";
import { Alert, Button, Card, Spin, Typography } from "antd";
import { RefreshCw } from "lucide-react";

import { useI18n } from "@/i18n/use-i18n";
import { PlatformProjectOnboarding } from "@/components/layout/platform-project-onboarding";
import { publicAssetPath } from "@/lib/app-base-path";
import { useUserStore } from "@/stores/use-user-store";

export function AuthGate({ children }: { children: ReactNode }) {
    const { t } = useI18n();
    const status = useUserStore((state) => state.status);
    const initializationError = useUserStore((state) => state.error);
    const initialize = useUserStore((state) => state.initialize);

    if (status === "disabled" || status === "authenticated") return <>{children}</>;
    if (status === "project_required") return <PlatformProjectOnboarding />;

    if (status === "initializing") {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-background text-foreground">
                <Spin size="large" tip={t("auth.initializing")} />
            </div>
        );
    }

    return (
        <div className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
            <Card className="w-full max-w-md" styles={{ body: { padding: 32 } }}>
                <div className="mb-6 flex items-center gap-3">
                    <span className="size-9 shrink-0 bg-current" style={{ mask: `url(${publicAssetPath("logo.svg")}) center / contain no-repeat`, WebkitMask: `url(${publicAssetPath("logo.svg")}) center / contain no-repeat` }} />
                    <div className="min-w-0">
                        <Typography.Title level={3} style={{ margin: 0 }}>
                            {t("auth.platformSessionTitle")}
                        </Typography.Title>
                        <Typography.Text type="secondary">{t("auth.platformSessionSubtitle")}</Typography.Text>
                    </div>
                </div>
                <Alert
                    className="mb-5"
                    type={status === "error" ? "error" : "info"}
                    showIcon
                    message={status === "error" ? t("auth.initializeFailed") : t("auth.platformSessionMissing")}
                    description={status === "error" ? initializationError || t("auth.unknownError") : t("auth.platformSessionHint")}
                />
                <Button type="primary" block size="large" icon={<RefreshCw className="size-4" />} onClick={() => void initialize()}>
                    {t("auth.retryPlatformSession")}
                </Button>
            </Card>
        </div>
    );
}
