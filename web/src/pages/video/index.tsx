import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Segmented, Tag, Typography } from "antd";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoSettingsSummary } from "@/components/video-settings-panel";
import { ENV_AI_TASK_TIMEOUT_MS } from "@/constant/env";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import {
    boolConfig,
    defaultDreamVideoMode,
    dreamOmniReferenceIssue,
    isBuiltInDreamVideoConfig,
    isDreamSeedance20Model,
    isSeedanceVideoConfig,
    normalizeDreamVideoDuration,
    normalizeDreamVideoMode,
    normalizeDreamVideoRatio,
    normalizeDreamVideoSeed,
    normalizeSeedanceRatio,
    seedanceReferenceLabel,
    seedanceVideoReferenceError,
    SEEDANCE_REFERENCE_LIMITS,
} from "@/lib/seedance-video";
import { deleteStoredMedia, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { useI18n } from "@/i18n/use-i18n";
import { formatGenerationLogTime, normalizeGenerationLogStatus, type GenerationLogStatus } from "@/lib/generation-log";
import { localizeError } from "@/lib/app-error";
import { getDocumentStore } from "@/services/storage/document-store";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: GenerationLogStatus;
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

type StoredGenerationLog = Omit<Partial<GenerationLog>, "status"> & {
    status?: GenerationLogStatus | "生成中" | "成功" | "失败";
    time?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoMode" | "videoSeed" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const logStore = getDocumentStore("video_generation_logs");
type ReferenceUploadTarget = "first" | "last" | "image" | "video" | "audio";

export default function VideoPage() {
    const { message } = App.useApp();
    const { t } = useI18n();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const referenceUploadTargetRef = useRef<ReferenceUploadTarget>("image");
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const requestConfig = { ...effectiveConfig, model, videoModel: model };
    const isDreamVideo = isBuiltInDreamVideoConfig(requestConfig);
    const dreamMode = normalizeDreamVideoMode(effectiveConfig.videoMode, modelOptionName(model));
    const startEndMode = isDreamVideo && dreamMode === "start-end";
    const subjectMode = isDreamVideo && dreamMode === "subject";
    const [firstFrame, lastFrame] = startEndReferenceImages(references);
    const hasSubjectReference = Boolean(references.length || videoReferences.length || audioReferences.length);
    const canGenerate = Boolean(prompt.trim()) && (!isDreamVideo || (startEndMode ? Boolean(firstFrame && lastFrame) : hasSubjectReference));

    const selectVideoModel = (value: string) => {
        updateConfig("videoModel", value);
        updateConfig("videoMode", defaultDreamVideoMode(modelOptionName(value)));
    };

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    useEffect(() => {
        if (!isDreamVideo) return;
        if (effectiveConfig.videoMode !== dreamMode) updateConfig("videoMode", dreamMode);
        if (dreamMode === "start-end") {
            setReferences((current) => withStartEndRoles(current));
            setVideoReferences((current) => (current.length ? [] : current));
            setAudioReferences((current) => (current.length ? [] : current));
            return;
        }
        setReferences((current) => (current.some((item) => item.videoRole) ? current.map(({ videoRole: _videoRole, ...item }) => item) : current));
    }, [dreamMode, effectiveConfig.videoMode, isDreamVideo, updateConfig]);

    const openReferenceUpload = (target: ReferenceUploadTarget) => {
        const input = fileInputRef.current;
        if (!input) return;
        referenceUploadTargetRef.current = target;
        input.accept = target === "first" || target === "last" || target === "image" ? "image/*" : target === "video" ? "video/mp4,video/quicktime,.mp4,.mov" : "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";
        input.multiple = target !== "first" && target !== "last";
        input.click();
    };

    const addReferences = async (files?: FileList | null, target = referenceUploadTargetRef.current) => {
        const selectedFiles = Array.from(files || []);
        if (target === "first" || target === "last") {
            const file = selectedFiles.find((item) => item.type.startsWith("image/"));
            if (!file) {
                message.warning(t("video.imageRequiredForFrame"));
                return;
            }
            if (file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes) {
                message.warning(t("video.imageTooLarge"));
                return;
            }
            const image = await uploadImage(file);
            const reference: ReferenceImage = { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, videoRole: target };
            setReferences((current) => setStartEndReference(current, target, reference));
            return;
        }
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning(t("video.unsupportedReferences"));
        const imageFiles = target === "image" ? selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length) : [];
        const videoFiles = target === "video" ? selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - videoReferences.length) : [];
        const audioFiles = target === "audio" ? selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.audios - audioReferences.length) : [];
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning(t("video.imageTooLarge"));
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning(t("video.videoTooLarge"));
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning(t("video.audioTooLarge"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadMediaFile(file, "video-reference");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const uploadedAudioReferences = await Promise.all(
            audioFiles.map(async (file) => {
                const audio = await uploadMediaFile(file, "audio-reference");
                return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
            }),
        );
        const nextAudioReferences = subjectMode ? uploadedAudioReferences : filterAudioReferencesByDuration(audioReferences, uploadedAudioReferences, () => message.warning(t("video.audioDurationInvalid")));
        setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.audios));
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("image.noClipboardImage"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            message.success(t("image.referencesRead", { count: nextReferences.length }));
        } catch {
            message.error(t("image.noClipboardImage"));
        }
    };
    const generate = async () => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setElapsedMs(0);
        setRunning(true);
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences);
            const log = buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, durationMs: 0, status: "pending", task });
            await saveLog(log);
            void pollGenerationLog(log, snapshot.config);
        } catch (error) {
            const errorMessage = localizeError(error, t, "common.generateFailed");
            setResults([{ id: nanoid(), status: "failed", error: errorMessage }]);
            await saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: snapshot.config,
                    references: snapshot.references,
                    videoReferences: snapshot.videoReferences,
                    audioReferences: snapshot.audioReferences,
                    durationMs: performance.now() - batchStartedAt,
                    status: "failed",
                    error: errorMessage,
                }),
            );
            message.error(errorMessage);
            setRunning(false);
        }
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("video.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("image.configRequired"));
            openConfigDialog(true);
            return null;
        }
        const snapshotConfig = buildVideoConfig(effectiveConfig, model);
        if (isBuiltInDreamVideoConfig(snapshotConfig)) {
            const mode = normalizeDreamVideoMode(snapshotConfig.videoMode, modelOptionName(model));
            if (mode === "start-end") {
                const frames = orderedStartEndReferences(references);
                if (frames.length !== 2) {
                    message.error(t("video.startEndFramesRequired"));
                    return null;
                }
                return { text, config: snapshotConfig, references: frames, videoReferences: [], audioReferences: [] };
            }
            const referenceIssue = dreamOmniReferenceIssue(references, videoReferences, audioReferences);
            if (referenceIssue) {
                message.error(t(referenceIssue.key, referenceIssue.params));
                return null;
            }
            return { text, config: snapshotConfig, references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
        }
        const videoReferenceError = seedanceVideoReferenceError(videoReferences);
        if (videoReferenceError) {
            message.error(`${t(videoReferenceError.key, videoReferenceError.params)} ${t("video.referenceHint")}`);
            return null;
        }
        return { text, config: snapshotConfig, references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const retryResult = () => {
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: t("video.generatedVideoTitle"),
            coverUrl: "",
            tags: [],
            source: t("video.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success(t("image.addedAsset"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            const reference = { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
            setReferences((value) => (startEndMode ? setStartEndReference(value, firstFrame ? "last" : "first", { ...reference, videoRole: firstFrame ? "last" : "first" }) : [...value, reference].slice(0, SEEDANCE_REFERENCE_LIMITS.images)));
        } else if (payload.kind === "video") {
            if (!startEndMode)
                setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height }].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const mediaKeys = logs
            .filter((log) => selectedLogIds.includes(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        void Promise.all([deleteStoredMedia(mediaKeys), ...selectedLogIds.map((id) => logStore.removeItem(id))]).then(refreshLogs);
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog) => {
        await logStore.setItem(log.id, serializeLog(log));
        await refreshLogs();
    };

    const refreshLogs = async () => {
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "pending" && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        try {
            const delayMs = log.task.provider === "seedance" ? 5000 : 2500;
            const maxAttempts = Math.max(1, Math.ceil(ENV_AI_TASK_TIMEOUT_MS / delayMs));
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
                if (state.status === "completed") {
                    const stored = await storeGeneratedVideo(state.result);
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored.url,
                        storageKey: stored.storageKey,
                        durationMs: Date.now() - log.createdAt,
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                    };
                    setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
                    await saveLog({ ...log, status: "success", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined });
                    message.success(t("video.generatedSuccess"));
                    return;
                }
                if (state.status === "failed") throw state.error;
                if (attempt === maxAttempts - 1) throw new Error(t("video.timeout"));
                await delay(delayMs);
            }
        } catch (error) {
            const errorMessage = localizeError(error, t, "common.generateFailed");
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            await saveLog({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoMode) updateConfig("videoMode", log.config.videoMode);
        if (log.config.videoSeed) updateConfig("videoSeed", log.config.videoSeed);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || t("common.generateFailed") }]);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[260px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[560px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div className="flex items-start justify-between gap-3">
                            <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("video.title")}</h1>
                            <div className="flex shrink-0 gap-2 lg:hidden">
                                <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    {t("common.history")}
                                </Button>
                                <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("common.settings")}
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <VideoModelSetting config={effectiveConfig} model={model} onModelChange={selectVideoModel} openConfigDialog={openConfigDialog} />

                            {isDreamVideo && isDreamSeedance20Model(modelOptionName(model)) ? (
                                <div className="space-y-2">
                                    <span className="block text-base font-semibold">{t("settings.video.mode")}</span>
                                    <Segmented
                                        block
                                        value={dreamMode}
                                        onChange={(value) => updateConfig("videoMode", String(value))}
                                        options={[
                                            { value: "subject", label: t("settings.video.modeSubject") },
                                            { value: "start-end", label: t("settings.video.modeStartEnd") },
                                        ]}
                                    />
                                </div>
                            ) : null}

                            {startEndMode ? (
                                <StartEndReferencePanel firstFrame={firstFrame} lastFrame={lastFrame} onUpload={openReferenceUpload} onRemove={(role) => setReferences((current) => current.filter((item) => item.videoRole !== role))} />
                            ) : (
                                <>
                                    <div className="min-w-0">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-base font-semibold">{t("video.referenceImages")}</span>
                                            <div className="flex gap-2">
                                                <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                                    {t("image.clipboard")}
                                                </Button>
                                                <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => openReferenceUpload("image")}>
                                                    {t("common.upload")}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700">
                                            {references.map((item, index) => (
                                                <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                                    <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                                    <button
                                                        type="button"
                                                        className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
                                                        onClick={() => setPrompt((value) => appendReferenceMention(value, "image", index))}
                                                    >
                                                        @{seedanceReferenceLabel("image", index)}
                                                    </button>
                                                    <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                                    <button
                                                        type="button"
                                                        className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                        onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                        aria-label={t("video.referenceImages")}
                                                    >
                                                        <Trash2 className="size-3.5" />
                                                    </button>
                                                </div>
                                            ))}
                                            {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{t("video.noReferenceImages")}</div> : null}
                                        </div>
                                    </div>

                                    <div className="min-w-0">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-base font-semibold">{t("video.referenceVideos")}</span>
                                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => openReferenceUpload("video")}>
                                                {t("common.upload")}
                                            </Button>
                                        </div>
                                        <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700">
                                            {videoReferences.map((item, index) => (
                                                <div key={item.id} className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800">
                                                    <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                                    <button
                                                        type="button"
                                                        className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
                                                        onClick={() => setPrompt((value) => appendReferenceMention(value, "video", index))}
                                                    >
                                                        @{seedanceReferenceLabel("video", index)}
                                                    </button>
                                                    <ReferenceOrderButtons index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                                    <button
                                                        type="button"
                                                        className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                        onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                        aria-label={t("video.referenceVideos")}
                                                    >
                                                        <Trash2 className="size-3.5" />
                                                    </button>
                                                </div>
                                            ))}
                                            {!videoReferences.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{t("video.noReferenceVideos")}</div> : null}
                                        </div>
                                    </div>

                                    <div className="min-w-0">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-base font-semibold">{t("video.referenceAudios")}</span>
                                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => openReferenceUpload("audio")}>
                                                {t("common.upload")}
                                            </Button>
                                        </div>
                                        <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700">
                                            {audioReferences.map((item, index) => (
                                                <div key={item.id} className="group relative flex h-20 w-48 shrink-0 flex-col justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900">
                                                    <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                                        <Music2 className="size-4 shrink-0" />
                                                        <button
                                                            type="button"
                                                            className="shrink-0 rounded bg-stone-200 px-1 text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200"
                                                            onClick={() => setPrompt((value) => appendReferenceMention(value, "audio", index))}
                                                        >
                                                            @{seedanceReferenceLabel("audio", index)}
                                                        </button>
                                                        <span className="truncate">{item.name}</span>
                                                    </div>
                                                    <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                                    <ReferenceOrderButtons index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                                    <button
                                                        type="button"
                                                        className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                        onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                        aria-label={t("video.referenceAudios")}
                                                    >
                                                        <Trash2 className="size-3.5" />
                                                    </button>
                                                </div>
                                            ))}
                                            {!audioReferences.length ? <div className="flex min-w-full items-center justify-center text-center text-sm text-stone-500">{t("video.noReferenceAudios")}</div> : null}
                                        </div>
                                    </div>
                                </>
                            )}

                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("common.prompt")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("common.promptLibrary")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("common.myAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("video.promptPlaceholder")} />
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model, t)} · {videoSettingsSummary(requestConfig, t)}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("common.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                {t("common.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">{t("video.results")}</h2>
                            {running ? <Tag className="m-0 px-2 py-1">{t("image.waiting", { time: formatDuration(elapsedMs, t) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || t("common.generateFailed")} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("video.noResults")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("common.history")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={previewGenerationLog}
                />
            </Drawer>
            <Drawer title={t("common.settings")} placement="bottom" height="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <VideoModelSetting config={effectiveConfig} model={model} onModelChange={selectVideoModel} openConfigDialog={openConfigDialog} />
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("video.deleteLogsTitle")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("video.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="col-span-2">
            <VideoSettingsPanel config={{ ...config, model, videoModel: model }} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" />
        </div>
    );
}

function VideoModelSetting({ config, model, onModelChange, openConfigDialog }: { config: AiConfig; model: string; onModelChange: (model: string) => void; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const { t } = useI18n();
    return (
        <label className="col-span-2 block min-w-0">
            <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("common.model")}</span>
            <ModelPicker config={config} value={model} onChange={onModelChange} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
        </label>
    );
}

function StartEndReferencePanel({ firstFrame, lastFrame, onUpload, onRemove }: { firstFrame?: ReferenceImage; lastFrame?: ReferenceImage; onUpload: (target: "first" | "last") => void; onRemove: (target: "first" | "last") => void }) {
    const { t } = useI18n();
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <FrameReferenceCard title={t("video.firstFrame")} image={firstFrame} onUpload={() => onUpload("first")} onRemove={() => onRemove("first")} />
            <FrameReferenceCard title={t("video.lastFrame")} image={lastFrame} onUpload={() => onUpload("last")} onRemove={() => onRemove("last")} />
        </div>
    );
}

function FrameReferenceCard({ title, image, onUpload, onRemove }: { title: string; image?: ReferenceImage; onUpload: () => void; onRemove: () => void }) {
    const { t } = useI18n();
    return (
        <div className="min-w-0">
            <div className="mb-2 text-base font-semibold">{title}</div>
            <div className="group relative flex aspect-video min-h-36 items-center justify-center overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
                {image ? (
                    <img src={image.dataUrl} alt={image.name} className="size-full object-cover" />
                ) : (
                    <Button type="text" icon={<Upload className="size-4" />} onClick={onUpload}>
                        {t("common.upload")}
                    </Button>
                )}
                {image ? (
                    <>
                        <Button className="!absolute !inset-0 !h-full !w-full !rounded-none !border-0 !bg-transparent !text-transparent hover:!bg-black/10" onClick={onUpload} aria-label={t("common.upload")} />
                        <button type="button" className="absolute right-2 top-2 hidden size-7 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={onRemove} aria-label={t("common.delete")}>
                            <Trash2 className="size-3.5" />
                        </button>
                    </>
                ) : null}
            </div>
        </div>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useI18n();
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs, t)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        {t("common.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    const { t } = useI18n();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("common.generating")}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useI18n();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("common.generateFailed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("common.retry")}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useI18n();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("common.history")}</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("common.create")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.deselect") : t("common.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("video.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { language, t } = useI18n();
    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{log.title || t("common.untitled")}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red"}>
                        {videoLogStatusLabel(log.status, t)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs, t)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{formatGenerationLogTime(log.createdAt, language)}</Tag>
                </div>
            </div>
        </button>
    );
}

function videoLogStatusLabel(status: GenerationLog["status"], t: ReturnType<typeof useI18n>["t"]) {
    if (status === "pending") return t("video.status.pending");
    if (status === "success") return t("video.status.success");
    return t("video.status.failed");
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: StoredGenerationLog[] = [];
        await logStore.iterate<StoredGenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: StoredGenerationLog): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "",
        prompt: log.prompt || "",
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: normalizeGenerationLogStatus(log.status, "success"),
        task: log.task,
        video,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function startEndReferenceImages(items: ReferenceImage[]): [ReferenceImage | undefined, ReferenceImage | undefined] {
    const first = items.find((item) => item.videoRole === "first") || items.find((item) => !item.videoRole);
    const last = items.find((item) => item.videoRole === "last") || items.find((item) => item !== first && !item.videoRole);
    return [first, last];
}

function orderedStartEndReferences(items: ReferenceImage[]) {
    return startEndReferenceImages(items).filter((item): item is ReferenceImage => Boolean(item));
}

function withStartEndRoles(items: ReferenceImage[]) {
    const [first, last] = startEndReferenceImages(items);
    const next: ReferenceImage[] = [];
    if (first) next.push({ ...first, videoRole: "first" });
    if (last) next.push({ ...last, videoRole: "last" });
    if (next.length === items.length && next.every((item, index) => item.id === items[index]?.id && item.videoRole === items[index]?.videoRole)) return items;
    return next;
}

function setStartEndReference(items: ReferenceImage[], role: "first" | "last", reference: ReferenceImage) {
    const [first, last] = startEndReferenceImages(items);
    return withStartEndRoles(role === "first" ? [{ ...reference, videoRole: "first" }, ...(last ? [{ ...last, videoRole: "last" as const }] : [])] : [...(first ? [{ ...first, videoRole: "first" as const }] : []), { ...reference, videoRole: "last" }]);
}

function appendReferenceMention(prompt: string, kind: "image" | "video" | "audio", index: number) {
    const token = `@${seedanceReferenceLabel(kind, index)}`;
    if (prompt.includes(token)) return prompt;
    return prompt.trimEnd() ? `${prompt.trimEnd()} ${token}` : token;
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: () => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > 15000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn();
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: StoredGenerationLog): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoMode: log.config?.videoMode || "start-end",
        videoSeed: log.config?.videoSeed || "-1",
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "false",
        videoWatermark: log.config?.videoWatermark || "false",
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    videoReferences,
    audioReferences,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoMode: config.videoMode,
        videoSeed: config.videoSeed,
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12),
        prompt,
        model,
        config: logConfig,
        references,
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const dream = isBuiltInDreamVideoConfig({ ...config, model, videoModel: model });
    const seedance = isSeedanceVideoConfig({ ...config, model });
    const modelName = modelOptionName(model);
    return {
        ...config,
        model,
        videoModel: model,
        size: dream ? normalizeDreamVideoRatio(config.size, modelName) : seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSize(config.size),
        videoMode: dream ? normalizeDreamVideoMode(config.videoMode, modelName) : config.videoMode,
        videoSeed: dream ? String(normalizeDreamVideoSeed(config.videoSeed)) : config.videoSeed,
        videoSeconds: dream ? String(normalizeDreamVideoDuration(config.videoSeconds, modelName)) : normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, dream ? false : true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
