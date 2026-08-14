import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { publicAssetPath } from "@/lib/app-base-path";
import { cn } from "@/lib/utils";
import { modelOptionDisplayName, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useI18n } from "@/i18n/use-i18n";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    showChannel?: boolean;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig, showChannel = true }: ModelPickerProps) {
    const { t } = useI18n();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";
    const resolvedPlaceholder = placeholder || t("modelPicker.placeholder");
    const displayLabel = (model: string) => (showChannel ? modelOptionLabel(config, model, t) : modelOptionDisplayName(model));

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? displayLabel(current) : resolvedPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? displayLabel(current) : resolvedPlaceholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={displayLabel(model)}>
                            <ModelLabel config={config} model={model} t={t} showChannel={showChannel} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability, t)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability: ModelCapability | undefined, t: ReturnType<typeof useI18n>["t"]) {
    const label = capability ? t(`modelPicker.capability.${capability}`) : "";
    if (capability && config.models.length) return t("modelPicker.configureSelectable");
    return config.models.length ? t("modelPicker.noMatching", { label }) : t("modelPicker.addChannels");
}

function ModelLabel({ config, model, t, showChannel }: { config: AiConfig; model: string; t: ReturnType<typeof useI18n>["t"]; showChannel: boolean }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{showChannel ? modelOptionLabel(config, model, t) : modelOptionDisplayName(model)}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return publicAssetPath("icons/claude.svg");
    if (name.includes("gemini") || name.includes("google")) return publicAssetPath("icons/gemini.svg");
    if (name.includes("gpt") || name.includes("openai")) return publicAssetPath("icons/openai.svg");
    if (name.includes("grok") || name.includes("grok")) return publicAssetPath("icons/grok.svg");
    if (name.includes("deepseek") || name.includes("deepseek")) return publicAssetPath("icons/deepseek.svg");
    if (name.includes("glm") || name.includes("glm")) return publicAssetPath("icons/glm.svg");
    return "";
}
