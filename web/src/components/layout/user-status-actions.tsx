import type { CSSProperties } from "react";
import { BookOpen, Keyboard, Languages, Settings2 } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { DOCS_URL } from "@/constant/env";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    compact?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ showConfig = true, compact = false, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const { language, t, toggleLanguage } = useI18n();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const desktopOnlyClass = compact ? "hidden sm:inline-flex" : "";

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={cn(naturalIconClass, desktopOnlyClass)} style={iconStyle} aria-label={t("action.docs")} title={t("action.docs")}>
                <BookOpen className="size-4" />
            </a>
            {showConfig ? (
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
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("action.shortcuts")} title={t("action.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
