import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, RefreshCw, Square, X } from "lucide-react";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useI18n } from "@/i18n/use-i18n";
import { localizeError } from "@/lib/app-error";
import { useCanvasGenerationPointsEstimate } from "@/hooks/use-generation-points-estimate";
import { defaultDreamVideoMode, isBuiltInDreamVideoConfig, normalizeDreamVideoMode } from "@/lib/seedance-video";
import { isCanvasStartEndFrameSelectionComplete, resolveCanvasStartEndFrameInputs, type NodeGenerationInput } from "./canvas-node-generation";
import { CanvasDreamVideoInputs } from "./canvas-dream-video-inputs";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void | Promise<void>;
    onStop: (nodeId: string) => void;
    onReferenceImagesUpload: (nodeId: string, files: File[]) => Promise<void>;
    onReferenceImageRemove: (nodeId: string, referenceNodeId: string) => void;
    inputs?: NodeGenerationInput[];
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, onReferenceImagesUpload, onReferenceImageRemove, inputs = [], mentionReferences = [], onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const { t } = useI18n();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const [isUploadingReferences, setIsUploadingReferences] = useState(false);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const imageReferences = mentionReferences.filter((reference) => reference.kind === "image" && reference.nodeId !== node.id);
    const isDreamVideo = mode === "video" && isBuiltInDreamVideoConfig(config);
    const dreamVideoMode = isDreamVideo ? normalizeDreamVideoMode(config.videoMode, modelOptionName(config.videoModel || config.model)) : null;
    const showStartEndFrames = dreamVideoMode === "start-end";
    const frameSelection = resolveCanvasStartEndFrameInputs(node, inputs);
    const hasStartEndFrames = isCanvasStartEndFrameSelectionComplete(frameSelection);
    const hasMediaReferences = inputs.some((input) => input.type === "image" || input.type === "video" || input.type === "audio");
    const canGenerate = Boolean(prompt.trim()) && (!isDreamVideo || (showStartEndFrames ? hasStartEndFrames : hasMediaReferences));
    const pointsEstimate = useCanvasGenerationPointsEstimate({ config, mode, node, inputs, prompt });
    const estimateRequired = Boolean(pointsEstimate.spec);
    const estimateLoading = estimateRequired && pointsEstimate.query.isFetching;
    const estimateFailed = estimateRequired && (pointsEstimate.query.isError || pointsEstimate.query.isRefetchError);
    const estimatedPoints = pointsEstimate.query.data;

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    }, [isEditingExistingContent, node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };

    const submit = async () => {
        const text = prompt.trim();
        if (!text || isRunning || !canGenerate) return;
        if (estimateRequired && (estimateFailed || estimatedPoints === undefined)) {
            const result = await pointsEstimate.query.refetch();
            if (!result.isSuccess || result.data === undefined) return;
        }
        await onGenerate(node.id, mode, text);
        setPrompt("");
    };

    const uploadReferences = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        if (!files.length) return;
        setIsUploadingReferences(true);
        try {
            await onReferenceImagesUpload(node.id, files);
        } finally {
            setIsUploadingReferences(false);
        }
    };

    return (
        <div
            className="rounded-2xl border p-4 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasResourceMentionTextarea
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={() => void submit()}
                className="thin-scrollbar h-24 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent, t)}
            />

            {isDreamVideo ? <CanvasDreamVideoInputs node={node} config={config} inputs={inputs} onConfigChange={onConfigChange} className="mt-3" /> : null}

            {mode === "image" ? (
                <div className="mt-3 flex min-w-0 items-center gap-2">
                    <input ref={referenceInputRef} type="file" accept="image/*" multiple hidden onChange={uploadReferences} />
                    <Button
                        className="!h-9 shrink-0 !rounded-xl !border-dashed !px-3"
                        icon={<ImagePlus className="size-4" />}
                        loading={isUploadingReferences}
                        disabled={isRunning}
                        style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                        onClick={() => referenceInputRef.current?.click()}
                    >
                        {t(imageReferences.length ? "canvas.referenceImageAdd" : "canvas.referenceImageUpload")}
                    </Button>
                    {imageReferences.length ? (
                        <>
                            <span className="shrink-0 text-xs" style={{ color: theme.node.muted }}>
                                {t("canvas.referenceImageCount", { count: imageReferences.length })}
                            </span>
                            <div className="thin-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5">
                                {imageReferences.map((reference) => (
                                    <div key={reference.nodeId} className="relative size-9 shrink-0 overflow-hidden rounded-lg border" style={{ background: theme.node.fill, borderColor: theme.node.stroke }} title={reference.title}>
                                        <img src={reference.previewUrl} alt={reference.title} className="size-full object-cover" draggable={false} />
                                        <button
                                            type="button"
                                            className="absolute right-0 top-0 grid size-4 place-items-center rounded-bl-md opacity-80 transition hover:opacity-100"
                                            style={{ background: theme.toolbar.panel, color: theme.node.text }}
                                            aria-label={t("canvas.referenceImageRemove", { name: reference.title })}
                                            onClick={() => onReferenceImageRemove(node.id, reference.nodeId)}
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <span className="min-w-0 truncate text-xs" style={{ color: theme.node.muted }}>
                            {t("canvas.referenceImageHint")}
                        </span>
                    )}
                </div>
            ) : null}

            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2.5">
                <CanvasPromptLibrary onSelect={updatePrompt} />
                {mode === "image" ? (
                    <>
                        <div className="min-w-[180px] flex-[1_1_200px]">
                            <ModelPicker className="!h-10 !w-full !min-w-0" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" fullWidth showChannel={false} onMissingConfig={() => openConfigDialog(true)} />
                        </div>
                        <div className="min-w-[210px] flex-[1.15_1_230px] [&>span]:w-full">
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !w-full !max-w-none !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </div>
                    </>
                ) : mode === "video" ? (
                    <>
                        <div className="min-w-[180px] flex-[1_1_200px]">
                            <ModelPicker
                                className="!h-10 !w-full !min-w-0"
                                config={config}
                                value={config.model}
                                onChange={(model) => onConfigChange(node.id, videoModelPatch(model))}
                                capability="video"
                                fullWidth
                                showChannel={false}
                                onMissingConfig={() => openConfigDialog(true)}
                            />
                        </div>
                        <div className="min-w-[200px] flex-[1_1_220px] [&>span]:w-full">
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !w-full !max-w-none !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </div>
                    </>
                ) : mode === "audio" ? (
                    <>
                        <div className="min-w-[180px] flex-[1_1_200px]">
                            <ModelPicker className="!h-10 !w-full !min-w-0" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" fullWidth showChannel={false} onMissingConfig={() => openConfigDialog(true)} />
                        </div>
                        <div className="min-w-[200px] flex-[1_1_220px] [&>span]:w-full">
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !w-full !max-w-none !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </div>
                    </>
                ) : (
                    <div className="min-w-[240px] flex-1">
                        <ModelPicker className="!h-10 !w-full !min-w-0" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" fullWidth showChannel={false} onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                )}
                <Button
                    type="primary"
                    className="ml-auto !h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && (!canGenerate || estimateLoading)}
                    onClick={() => (isRunning ? onStop(node.id) : void submit())}
                    aria-label={isRunning ? t("canvas.stopGenerationOk") : t("common.generate")}
                    title={estimateFailed ? localizeError(pointsEstimate.query.error, t, "error.dream.pointsEstimateFailed") : undefined}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">{t("common.stop")}</span>
                            </>
                        ) : estimateLoading ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <span className="text-xs font-medium">{t("canvas.pointsEstimating")}</span>
                            </>
                        ) : estimateFailed ? (
                            <>
                                <RefreshCw className="size-4" />
                                <span className="text-xs font-medium">{t("common.retry")}</span>
                            </>
                        ) : (
                            <>
                                {estimateRequired && estimatedPoints !== undefined ? (
                                    <span className="inline-flex min-w-10 items-center justify-center gap-1 text-xs font-medium tabular-nums">
                                        <CreditSymbol />
                                        {estimatedPoints.toLocaleString()}
                                    </span>
                                ) : null}
                                <ArrowUp className="size-4" />
                            </>
                        )}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const model = node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model);
    const config = {
        ...globalConfig,
        model,
        videoModel: mode === "video" ? model : globalConfig.videoModel,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        imageQuality: node.metadata?.imageQuality || globalConfig.imageQuality || defaultConfig.imageQuality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoMode: node.metadata?.videoMode || defaultDreamVideoMode(modelOptionName(model)),
        videoSeed: node.metadata?.videoSeed || globalConfig.videoSeed || defaultConfig.videoSeed,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
    if (mode === "video" && isBuiltInDreamVideoConfig(config)) config.videoMode = normalizeDreamVideoMode(config.videoMode, modelOptionName(model));
    return config;
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean, t: ReturnType<typeof useI18n>["t"]) {
    if (mode === "video") return t("canvas.node.prompt.video");
    if (mode === "audio") return t("canvas.node.prompt.audio");
    if (mode === "image") return t(hasImageContent ? "canvas.node.prompt.editImage" : "canvas.node.prompt.image");
    return t(hasTextContent ? "canvas.node.prompt.editText" : "canvas.node.prompt.text");
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoMode") return { videoMode: value };
    if (key === "videoSeed") return { videoSeed: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function videoModelPatch(model: string) {
    return { model, videoMode: defaultDreamVideoMode(modelOptionName(model)) };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
