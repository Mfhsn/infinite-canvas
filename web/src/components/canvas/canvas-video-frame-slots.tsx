import { Image as ImageIcon } from "lucide-react";
import { Select } from "antd";

import { useI18n } from "@/i18n/use-i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { resolveCanvasStartEndFrameInputs, type NodeGenerationInput } from "./canvas-node-generation";

type CanvasVideoFrameSlotsProps = {
    node: CanvasNodeData;
    inputs: NodeGenerationInput[];
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    className?: string;
};

export function CanvasVideoFrameSlots({ node, inputs, onConfigChange, className = "" }: CanvasVideoFrameSlotsProps) {
    const { t } = useI18n();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const imageInputs = inputs.filter((input) => input.type === "image" && input.image);
    const selection = resolveCanvasStartEndFrameInputs(node, inputs);

    const changeFrame = (role: "first" | "last", nodeId: string) => {
        onConfigChange(node.id, {
            videoFirstFrameNodeId: role === "first" ? nodeId : selection.first?.nodeId,
            videoLastFrameNodeId: role === "last" ? nodeId : selection.last?.nodeId,
        });
    };

    return (
        <div className={`cursor-default ${className}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]" style={{ color: theme.node.muted }}>
                <span>{t("canvas.videoFramesHint")}</span>
                <span className="shrink-0 font-medium">{Math.min(imageInputs.length, 2)}/2</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
                <VideoFrameSlot
                    label={t("video.firstFrame")}
                    placeholder={t("canvas.videoFrameSelect")}
                    emptyLabel={t("canvas.videoFrameConnectImage")}
                    selected={selection.first}
                    inputs={imageInputs}
                    disabledNodeId={selection.last?.nodeId}
                    theme={theme}
                    onChange={(nodeId) => changeFrame("first", nodeId)}
                />
                <VideoFrameSlot
                    label={t("video.lastFrame")}
                    placeholder={t("canvas.videoFrameSelect")}
                    emptyLabel={t("canvas.videoFrameConnectImage")}
                    selected={selection.last}
                    inputs={imageInputs}
                    disabledNodeId={selection.first?.nodeId}
                    theme={theme}
                    onChange={(nodeId) => changeFrame("last", nodeId)}
                />
            </div>
        </div>
    );
}

function VideoFrameSlot({
    label,
    placeholder,
    emptyLabel,
    selected,
    inputs,
    disabledNodeId,
    theme,
    onChange,
}: {
    label: string;
    placeholder: string;
    emptyLabel: string;
    selected?: NodeGenerationInput;
    inputs: NodeGenerationInput[];
    disabledNodeId?: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onChange: (nodeId: string) => void;
}) {
    return (
        <div className="min-w-0 rounded-xl border p-2.5" style={{ borderColor: selected ? theme.node.activeStroke : theme.node.stroke, background: theme.node.fill }}>
            <div className="mb-2 truncate text-xs font-semibold">{label}</div>
            <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}>
                    {selected?.image ? <img src={selected.image.dataUrl} alt={selected.title} className="size-full object-cover" draggable={false} /> : <ImageIcon className="size-4 opacity-45" />}
                </div>
                <Select
                    size="small"
                    className="min-w-0 flex-1"
                    value={selected?.nodeId}
                    placeholder={inputs.length ? placeholder : emptyLabel}
                    disabled={!inputs.length}
                    onChange={onChange}
                    options={inputs.map((input, index) => ({
                        value: input.nodeId,
                        label: input.title || input.image?.name || `${index + 1}`,
                        disabled: input.nodeId === disabledNodeId && input.nodeId !== selected?.nodeId,
                    }))}
                    optionRender={(option) => {
                        const input = inputs.find((item) => item.nodeId === option.value);
                        return (
                            <div className="flex min-w-0 items-center gap-2">
                                {input?.image ? <img src={input.image.dataUrl} alt="" className="size-8 shrink-0 rounded object-cover" /> : null}
                                <span className="truncate">{String(option.label)}</span>
                            </div>
                        );
                    }}
                />
            </div>
        </div>
    );
}
