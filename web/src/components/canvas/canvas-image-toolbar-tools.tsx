import type { ReactNode } from "react";
import { Brush, Camera, Copy, Grid2x2, Lock, LockOpen, Maximize2, Scissors, Sparkles, Upload, ZoomIn } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import type { I18nKey, I18nTranslator } from "@/i18n/messages";

export type ImageNodeActionToolId = "copyPrompt" | "reversePrompt" | "replace" | "resize" | "maskEdit" | "crop" | "split" | "upscale" | "superResolve" | "angle" | "view";
export type ImageQuickToolId = "info" | "delete" | "saveAsset" | "download" | "edit" | ImageNodeActionToolId;

export type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
};

export type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    defaultVisible: boolean;
    panelLabel: I18nKey;
    label: I18nKey | ((node: CanvasNodeData) => I18nKey);
    title: I18nKey | ((node: CanvasNodeData) => I18nKey);
    icon: (node: CanvasNodeData) => ReactNode;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers) => void;
};

export type ImageQuickToolsConfig = {
    ids: ImageQuickToolId[];
    showLabels: boolean;
};

export const IMAGE_QUICK_TOOLS_STORAGE_KEY = "canvas-image-quick-tools-v6";

const defaultBaseToolIds: ImageQuickToolId[] = ["info", "delete", "saveAsset", "download", "edit"];

export const imageToolDefinitions: ImageToolDefinition[] = [
    {
        id: "copyPrompt",
        defaultVisible: true,
        panelLabel: "canvas.tool.copyPrompt",
        label: "canvas.tool.copyPrompt",
        title: "canvas.tool.copyPromptDesc",
        icon: () => <Copy className="size-4" />,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "replace",
        defaultVisible: true,
        panelLabel: "canvas.tool.replaceImage",
        label: "canvas.tool.replaceImage",
        title: "canvas.tool.replaceImage",
        icon: () => <Upload className="size-4" />,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "resize",
        defaultVisible: false,
        panelLabel: "canvas.tool.lockRatio",
        label: (node) => (node.metadata?.freeResize ? "canvas.tool.freeRatio" : "canvas.tool.lockRatio"),
        title: (node) => (node.metadata?.freeResize ? "canvas.tool.toLockedRatio" : "canvas.tool.toFreeRatio"),
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-4" /> : <Lock className="size-4" />),
        active: (node) => Boolean(node.metadata?.freeResize),
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
    {
        id: "maskEdit",
        defaultVisible: true,
        panelLabel: "canvas.tool.localEdit",
        label: "canvas.tool.localEdit",
        title: "canvas.tool.localEditDesc",
        icon: () => <Brush className="size-4" />,
        run: (node, handlers) => handlers.onMaskEdit(node),
    },
    {
        id: "crop",
        defaultVisible: true,
        panelLabel: "canvas.tool.crop",
        label: "canvas.tool.crop",
        title: "canvas.tool.cropDesc",
        icon: () => <Scissors className="size-4" />,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "split",
        defaultVisible: true,
        panelLabel: "canvas.tool.split",
        label: "canvas.tool.split",
        title: "canvas.tool.splitDesc",
        icon: () => <Grid2x2 className="size-4" />,
        run: (node, handlers) => handlers.onSplit(node),
    },
    {
        id: "upscale",
        defaultVisible: true,
        panelLabel: "canvas.tool.upscale",
        label: "canvas.tool.upscale",
        title: "canvas.tool.upscaleDesc",
        icon: () => <ZoomIn className="size-4" />,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "superResolve",
        defaultVisible: false,
        panelLabel: "canvas.tool.superResolution",
        label: "canvas.tool.superResolution",
        title: "canvas.tool.superResolutionDesc",
        icon: () => <Sparkles className="size-4" />,
        run: (node, handlers) => handlers.onSuperResolve(node),
    },
    {
        id: "angle",
        defaultVisible: false,
        panelLabel: "canvas.tool.multiAngle",
        label: "canvas.tool.multiAngle",
        title: "canvas.tool.multiAngleDesc",
        icon: () => <Camera className="size-4" />,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "view",
        defaultVisible: true,
        panelLabel: "canvas.tool.viewLarge",
        label: "canvas.tool.viewLarge",
        title: "canvas.tool.viewLargeDesc",
        icon: () => <Maximize2 className="size-4" />,
        run: (node, handlers) => handlers.onViewImage(node),
    },
];

export const defaultImageQuickToolIds: ImageQuickToolId[] = [...defaultBaseToolIds, ...imageToolDefinitions.filter((tool) => tool.defaultVisible).map((tool) => tool.id)];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers, t: I18nTranslator) {
    return imageToolDefinitions.map((tool) => ({
        id: tool.id,
        label: t(resolveToolKey(tool.label, node)),
        title: t(resolveToolKey(tool.title, node)),
        icon: tool.icon(node),
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers),
    }));
}

export function normalizeImageQuickToolIds(value: unknown[]) {
    const allIds: ImageQuickToolId[] = [...defaultBaseToolIds, ...imageToolDefinitions.map((tool) => tool.id)];
    const ids = new Set(allIds);
    return allIds.filter((id) => value.includes(id) && ids.has(id));
}

export function readImageQuickToolsConfig(value: unknown): ImageQuickToolsConfig {
    if (Array.isArray(value)) return { ids: normalizeImageQuickToolIds(value), showLabels: true };
    if (!value || typeof value !== "object") return { ids: defaultImageQuickToolIds, showLabels: true };
    const data = value as Partial<ImageQuickToolsConfig>;
    return {
        ids: Array.isArray(data.ids) ? normalizeImageQuickToolIds(data.ids) : defaultImageQuickToolIds,
        showLabels: data.showLabels !== false,
    };
}

function resolveToolKey(value: I18nKey | ((node: CanvasNodeData) => I18nKey), node: CanvasNodeData) {
    return typeof value === "function" ? value(node) : value;
}
