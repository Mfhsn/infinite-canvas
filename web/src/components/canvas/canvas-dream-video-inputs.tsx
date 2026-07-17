import { Image as ImageIcon, Music2, Video } from "lucide-react";
import { Segmented, Switch } from "antd";

import { useI18n } from "@/i18n/use-i18n";
import { boolConfig, isDreamSeedance20Model, normalizeDreamVideoMode, seedanceReferenceLabel } from "@/lib/seedance-video";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { NodeGenerationInput } from "./canvas-node-generation";
import { CanvasVideoFrameSlots } from "./canvas-video-frame-slots";

type CanvasDreamVideoInputsProps = {
    node: CanvasNodeData;
    config: AiConfig;
    inputs: NodeGenerationInput[];
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    className?: string;
    compact?: boolean;
};

export function CanvasDreamVideoInputs({ node, config, inputs, onConfigChange, className = "", compact = false }: CanvasDreamVideoInputsProps) {
    const { t } = useI18n();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const model = modelOptionName(config.videoModel || config.model);
    const is20 = isDreamSeedance20Model(model);
    const mode = normalizeDreamVideoMode(config.videoMode, model);
    const generateAudio = boolConfig(config.videoGenerateAudio, false);

    return (
        <div className={`cursor-default ${className}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
                {is20 ? (
                    <Segmented
                        size="small"
                        className="min-w-0"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, { videoMode: String(value) })}
                        options={[
                            { value: "start-end", label: t("settings.video.modeStartEnd") },
                            { value: "subject", label: t("settings.video.modeSubject") },
                        ]}
                    />
                ) : (
                    <div className="rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                        {t("settings.video.modeStartEnd")}
                    </div>
                )}
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium">
                    <span>{t("settings.video.generateAudio")}</span>
                    <Switch size="small" checked={generateAudio} onChange={(checked) => onConfigChange(node.id, { generateAudio: String(checked) })} />
                </label>
            </div>

            {mode === "start-end" ? <CanvasVideoFrameSlots node={node} inputs={inputs} onConfigChange={onConfigChange} /> : <CanvasSubjectReferencePanel inputs={inputs} compact={compact} />}
        </div>
    );
}

function CanvasSubjectReferencePanel({ inputs, compact }: { inputs: NodeGenerationInput[]; compact: boolean }) {
    const { t } = useI18n();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const images = inputs.filter((input) => input.type === "image" && input.image);
    const videos = inputs.filter((input) => input.type === "video" && input.video);
    const audios = inputs.filter((input) => input.type === "audio" && input.audio);

    return (
        <div>
            <div className="mb-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                {t("canvas.videoSubjectHint")}
            </div>
            <div className={`grid grid-cols-3 ${compact ? "gap-1.5" : "gap-2.5"}`}>
                <SubjectReferenceGroup icon={<ImageIcon className="size-3.5" />} title={t("video.referenceImages")} count={images.length} limit={9} theme={theme}>
                    {images.slice(0, compact ? 2 : 3).map((input, index) => (
                        <div key={input.nodeId} className="relative size-10 shrink-0 overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke }} title={input.title}>
                            <img src={input.image?.dataUrl} alt={input.title} className="size-full object-cover" draggable={false} />
                            <span className="absolute inset-x-0 bottom-0 bg-black/60 px-0.5 text-center text-[8px] text-white">@{seedanceReferenceLabel("image", index)}</span>
                        </div>
                    ))}
                </SubjectReferenceGroup>
                <SubjectReferenceGroup icon={<Video className="size-3.5" />} title={t("video.referenceVideos")} count={videos.length} limit={3} theme={theme}>
                    {videos.slice(0, compact ? 1 : 2).map((input, index) => (
                        <div key={input.nodeId} className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md border bg-black" style={{ borderColor: theme.node.stroke }} title={input.title}>
                            <video src={input.video?.url} className="size-full object-cover" muted preload="metadata" />
                            <span className="absolute inset-x-0 bottom-0 bg-black/60 px-0.5 text-center text-[8px] text-white">@{seedanceReferenceLabel("video", index)}</span>
                        </div>
                    ))}
                </SubjectReferenceGroup>
                <SubjectReferenceGroup icon={<Music2 className="size-3.5" />} title={t("video.referenceAudios")} count={audios.length} limit={3} theme={theme}>
                    {audios.slice(0, compact ? 1 : 2).map((input, index) => (
                        <div key={input.nodeId} className="flex h-10 min-w-0 flex-1 items-center gap-1 rounded-md border px-1.5" style={{ borderColor: theme.node.stroke }} title={input.title}>
                            <Music2 className="size-3 shrink-0" />
                            <span className="min-w-0 truncate text-[9px]">@{seedanceReferenceLabel("audio", index)}</span>
                        </div>
                    ))}
                </SubjectReferenceGroup>
            </div>
        </div>
    );
}

function SubjectReferenceGroup({
    icon,
    title,
    count,
    limit,
    theme,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    count: number;
    limit: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    children: React.ReactNode;
}) {
    return (
        <div className="min-w-0 rounded-xl border p-2" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <div className="mb-1.5 flex min-w-0 items-center gap-1 text-[10px] font-medium">
                {icon}
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <span className="shrink-0 opacity-55">
                    {count}/{limit}
                </span>
            </div>
            <div className="thin-scrollbar flex h-10 min-w-0 items-center gap-1.5 overflow-x-auto">
                {count ? children : <span className="w-full text-center text-xs opacity-35">—</span>}
            </div>
        </div>
    );
}
