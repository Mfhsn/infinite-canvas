import type { CSSProperties } from "react";
import { useState } from "react";
import { App } from "antd";
import { BookOpen, Coins, Keyboard, Languages, LogOut, Settings2, UserRound } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { PlatformProjectWorkspace } from "@/components/layout/platform-project-workspace";
import { DOCS_URL, ENV_SHOW_CONFIG, ENV_SHOW_DOCS, ENV_SHOW_SHORTCUTS } from "@/constant/env";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    compact?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ showConfig = true, compact = false, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const { language, t, toggleLanguage } = useI18n();
    const { message } = App.useApp();
    const [loggingOut, setLoggingOut] = useState(false);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const userStatus = useUserStore((state) => state.status);
    const profile = useUserStore((state) => state.profile);
    const currentPoints = useUserStore((state) => state.currentPoints);
    const logout = useUserStore((state) => state.logout);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const desktopOnlyClass = compact ? "hidden sm:inline-flex" : "";
    const logoutUser = async () => {
        setLoggingOut(true);
        try {
            await logout();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("common.failed"));
            setLoggingOut(false);
        }
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {userStatus === "authenticated" ? (
                <PlatformProjectWorkspace
                    compact={compact}
                    className="inline-flex h-7 shrink-0 items-center justify-center gap-1 px-1 text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"
                    style={iconStyle}
                />
            ) : null}
            {userStatus === "authenticated" && profile ? (
                <div className={cn("mr-1 inline-flex min-w-0 items-center gap-2 text-xs", compact && "max-w-40")} style={iconStyle} title={`${profile.nickname || profile.username} · ${t("user.points", { points: currentPoints ?? "--" })}`}>
                    <UserRound className="size-4 shrink-0" />
                    <span className="max-w-24 truncate font-medium">{profile.nickname || profile.username}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 opacity-70">
                        <Coins className="size-3.5" />
                        {t("user.points", { points: currentPoints ?? "--" })}
                    </span>
                </div>
            ) : null}
            {ENV_SHOW_DOCS ? <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={cn(naturalIconClass, desktopOnlyClass)} style={iconStyle} aria-label={t("action.docs")} title={t("action.docs")}>
                <BookOpen className="size-4" />
            </a> : null}
            {showConfig && ENV_SHOW_CONFIG ? (
                <button type="button" className={cn(naturalIconClass, desktopOnlyClass)} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("action.config")} title={t("action.config")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <button type="button" className={cn(naturalIconClass, "w-auto gap-1 px-1")} style={iconStyle} onClick={toggleLanguage} aria-label={t("action.language")} title={t("action.language")}>
                <Languages className="size-4" />
                <span className="text-[10px] font-semibold leading-none">{language === "zh-CN" ? "EN" : "中"}</span>
            </button>
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={theme === "dark" ? t("action.switchToLight") : t("action.switchToDark")}
                title={theme === "dark" ? t("action.switchToLight") : t("action.switchToDark")}
            />
            {onOpenShortcuts && ENV_SHOW_SHORTCUTS ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("action.shortcuts")} title={t("action.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {userStatus === "authenticated" ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => void logoutUser()} disabled={loggingOut} aria-label={t("action.logout")} title={t("action.logout")}>
                    <LogOut className={cn("size-4", loggingOut && "animate-pulse")} />
                </button>
            ) : null}
        </div>
    );
}
