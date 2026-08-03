import axios from "axios";
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { dreamApiProxyUrl, dreamMediaProxyUrl, isDreamMediaProxyTarget } from "@/services/api/dream-media";
import { CANVAS_SESSION_BINDING_HEADER, capturePlatformSessionBinding, clearPlatformSessionBinding } from "@/services/platform-session";
import type { AiConfig } from "@/stores/use-config-store";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";
process.env.VITE_AI_PLATFORM_ID = "6";
const { useUserStore } = await import("@/stores/use-user-store");

afterEach(() => {
    clearPlatformSessionBinding();
    useUserStore.setState({ projectContext: null });
});

function configuredDreamConfig(defaultConfig: AiConfig, model = "doubao-seedream-4.5"): AiConfig {
    const channel = defaultConfig.channels[0];
    if (!channel) throw new Error("Missing built-in Dream channel");
    const selectedModel = `${channel.id}::${model}`;
    return {
        ...defaultConfig,
        baseUrl: "http://example.test",
        apiKey: "access-token",
        apiFormat: "dream",
        platformId: 6,
        model: selectedModel,
        imageModel: selectedModel,
        videoModel: selectedModel,
        audioModel: selectedModel,
        channels: [
            {
                ...channel,
                baseUrl: "http://example.test",
                apiKey: "access-token",
                apiFormat: "dream",
                platformId: 6,
                models: Array.from(new Set([...channel.models, model])),
            },
        ],
    };
}

const referenceImage = {
    id: "source-image",
    name: "source.png",
    type: "image/png",
    dataUrl: "data:image/png;base64,aW1hZ2U=",
};

const lastReferenceImage = {
    ...referenceImage,
    id: "last-image",
    name: "last.png",
    dataUrl: "data:image/png;base64,bGFzdA==",
};

describe("Dream media proxy", () => {
    test("rewrites only approved Volcengine media URLs in development", () => {
        const mediaUrl = "https://aigc-platform-my.tos-ap-southeast-1.volces.com/output.jpeg?signature=test";
        expect(isDreamMediaProxyTarget(mediaUrl)).toBe(true);
        expect(dreamMediaProxyUrl(mediaUrl, true)).toBe(`/__dream_media_proxy?url=${encodeURIComponent(mediaUrl)}`);
        expect(dreamMediaProxyUrl(mediaUrl, false)).toBe(mediaUrl);
        expect(isDreamMediaProxyTarget("http://127.0.0.1/private")).toBe(false);
        expect(dreamMediaProxyUrl("http://127.0.0.1/private", true)).toBe("http://127.0.0.1/private");
    });

    test("rewrites only requests belonging to the configured Dream API origin", () => {
        expect(dreamApiProxyUrl("https://106.75.147.147/api/v1/task/example/status", "https://106.75.147.147", true)).toBe("/__dream_api_proxy/api/v1/task/example/status");
        expect(dreamApiProxyUrl("https://cdn.example.test/output.jpg", "https://106.75.147.147", true)).toBe("https://cdn.example.test/output.jpg");
        expect(dreamApiProxyUrl("https://106.75.147.147/api/v1/task/example/status", "https://106.75.147.147", false)).toBe("https://106.75.147.147/api/v1/task/example/status");
    });
});

describe("Dream points estimate request", () => {
    test("uses the documented endpoint and preserves an explicit zero estimate", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: { points: 0 } } });
        try {
            const { requestDreamPointsEstimate } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const request = { req_key: "doubao-seedream-4.5", platform_id: 6, count: 1, ref_image_count: 0, image_quality: "medium" as const, size: "2048x2048", width: 2048, height: 2048 };

            await expect(requestDreamPointsEstimate({ ...defaultConfig, baseUrl: "http://example.test", apiKey: "access-token" }, request)).resolves.toBe(0);
            expect(post.mock.calls[0]?.[0]).toBe("http://example.test/api/v1/projects/calculate-points");
            expect(post.mock.calls[0]?.[1]).toEqual(request);
        } finally {
            post.mockRestore();
        }
    });

    test("rejects null points so generation cannot continue", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: { points: null } } });
        try {
            const { requestDreamPointsEstimate } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");

            await expect(
                requestDreamPointsEstimate({ ...defaultConfig, baseUrl: "http://example.test", apiKey: "access-token" }, { req_key: "doubao-seedance-2-0-260128", platform_id: 6, count: 1, duration: 5, audio_flag: false, has_input: true }),
            ).rejects.toMatchObject({ key: "error.dream.pointsEstimateUnavailable" });
        } finally {
            post.mockRestore();
        }
    });
});

describe("Dream image request", () => {
    test("builds project fields only when the environment-controlled behavior is enabled", async () => {
        useUserStore.setState({
            projectContext: {
                localProjectId: 42,
                externalProjectId: "external-42",
                sourceSystem: "platform",
                expiresAt: "2026-07-24T00:00:00Z",
            },
        });
        const { dreamProjectRequestFields } = await import("@/services/api/dream");

        expect(dreamProjectRequestFields(true)).toEqual({ project_id: 42 });
        expect(dreamProjectRequestFields(false)).toEqual({});
    });

    test("requires the access token used as API Key", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: "https://example.test/image.png" } });
        try {
            const { requestDreamImageGeneration } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await expect(requestDreamImageGeneration({ ...defaultConfig, apiKey: "", platformId: 6 }, "test", 1)).rejects.toMatchObject({ key: "error.dream.authRequired" });
            expect(post).not.toHaveBeenCalled();
        } finally {
            post.mockRestore();
        }
    });

    test("sends bearer authorization and the configured platform ID", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: "https://example.test/image.png" } });
        try {
            const { requestDreamImageGeneration } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const images = await requestDreamImageGeneration({ ...defaultConfig, apiKey: "access-token", platformId: 6 }, "test", 1);
            const [, body, options] = post.mock.calls[0];
            expect(body).toMatchObject({ dream_image_req_key: "doubao-seedream-4.5", platform_id: 6, width: 2048, height: 2048, num_images: 1 });
            expect(options?.headers).toMatchObject({ Authorization: "Bearer access-token", "Content-Type": "application/json" });
            expect(images[0]?.dataUrl).toBe("https://example.test/image.png");
        } finally {
            post.mockRestore();
        }
    });

    test("uses only the platform binding for Dream integration requests", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-1" } }));
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: "https://example.test/image.png" } });
        try {
            const { requestDreamImageGeneration } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await requestDreamImageGeneration({ ...defaultConfig, apiKey: "", platformId: 6 }, "test", 1);

            expect(post.mock.calls[0]?.[2]?.headers).toEqual({ "Content-Type": "application/json", [CANVAS_SESSION_BINDING_HEADER]: "binding-1" });
            expect(post.mock.calls[0]?.[2]?.headers).not.toHaveProperty("Authorization");
        } finally {
            post.mockRestore();
        }
    });

    test("sends the calculated 4K dimensions for the selected 9:21 ratio", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: "https://example.test/image.png" } });
        try {
            const { requestDreamImageGeneration } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await requestDreamImageGeneration({ ...defaultConfig, apiKey: "access-token", platformId: 6, quality: "4k", size: "9:21" }, "test", 1);
            expect(post.mock.calls[0]?.[1]).toMatchObject({ dream_image_req_key: "doubao-seedream-4.5", script_text: "test", width: 2592, height: 6048 });
        } finally {
            post.mockRestore();
        }
    });

    for (const model of ["doubao-seedream-4.5", "doubao-seedream-5-0-260128"]) {
        test(`uploads reference images and sends asset IDs for ${model}`, async () => {
            const post = spyOn(axios, "post")
                .mockResolvedValueOnce({ data: { id: "asset-1", url: "https://example.test/uploaded.png" } })
                .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "https://example.test/image.png" } });
            try {
                const { requestDreamImageEdit } = await import("@/services/api/dream");
                const { defaultConfig } = await import("@/stores/use-config-store");
                const reference = { ...referenceImage, dataUrl: "data:image/png;base64,aW1hZ2U=" };
                await requestDreamImageEdit(configuredDreamConfig(defaultConfig, model), "follow the reference", [reference]);

                expect(post.mock.calls[0]?.[0]).toBe("http://example.test/api/v1/upload/upload/image");
                expect(post.mock.calls[0]?.[1]).toBeInstanceOf(FormData);
                expect((post.mock.calls[0]?.[1] as FormData).get("usage")).toBe("mixcut");
                expect(post.mock.calls[0]?.[2]?.headers).toEqual({ Authorization: "Bearer access-token" });
                expect(post.mock.calls[1]?.[0]).toBe("http://example.test/api/v1/dream/dream_image");
                expect(post.mock.calls[1]?.[1]).toMatchObject({ dream_image_req_key: model, image_asset_ids: ["asset-1"], script_text: "follow the reference", width: 2048, height: 2048 });
            } finally {
                post.mockRestore();
            }
        });
    }

    test("polls task status when the create endpoint returns a task ID", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: "task-123" } });
        const get = spyOn(axios, "get")
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: { done: true, failed: false, progress: 1 } } })
            .mockResolvedValueOnce({
                data: {
                    code: 0,
                    message: "ok",
                    data: [{ id: "image-1", video_url: "/storage/generated.jpeg", thumbnail_url: "/storage/thumbnail.jpeg" }],
                },
            });
        try {
            const { requestDreamImageGeneration } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const images = await requestDreamImageGeneration({ ...defaultConfig, baseUrl: "http://example.test", apiKey: "access-token", platformId: 6 }, "test", 1);
            expect(get.mock.calls.map(([url]) => url)).toEqual(["http://example.test/api/v1/task/task-123/status", "http://example.test/api/v1/task/task-123/results"]);
            expect(images).toHaveLength(1);
            expect(images[0]?.dataUrl).toBe("http://example.test/storage/generated.jpeg");
        } finally {
            post.mockRestore();
            get.mockRestore();
        }
    });

    test("polls inpainting tasks and resolves the returned image path", async () => {
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { id: "source-asset" } })
            .mockResolvedValueOnce({ data: { id: "mask-asset" } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "inpaint-task" } });
        const get = spyOn(axios, "get")
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: { done: true, failed: false, progress: 100 } } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: [{ image_url: "/storage/inpainted.png" }] } });
        try {
            const { requestDreamImageEdit } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const mask = { ...referenceImage, id: "mask", name: "mask.png" };
            const images = await requestDreamImageEdit(configuredDreamConfig(defaultConfig, "i2i_inpainting_edit"), "replace sky", [referenceImage], mask, 1);

            expect(post.mock.calls[2]?.[1]).toMatchObject({ req_key: "i2i_inpainting_edit", task_type: "dream", image_asset_ids: ["source-asset", "mask-asset"] });
            expect(get.mock.calls.map(([url]) => url)).toEqual(["http://example.test/api/v1/task/inpaint-task/status", "http://example.test/api/v1/task/inpaint-task/results"]);
            expect(get.mock.calls.every(([, options]) => options?.headers?.Authorization === "Bearer access-token")).toBe(true);
            expect(images[0]?.dataUrl).toBe("http://example.test/storage/inpainted.png");
        } finally {
            post.mockRestore();
            get.mockRestore();
        }
    });

    test("polls outpainting tasks and resolves the returned file path", async () => {
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { id: "source-asset" } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "outpaint-task" } });
        const get = spyOn(axios, "get")
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: { done: true, failed: false, progress: 100 } } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: [{ file_path: "/storage/outpainted.png" }] } });
        try {
            const { requestDreamImageEdit } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const images = await requestDreamImageEdit(configuredDreamConfig(defaultConfig, "i2i_outpainting"), "extend background", [referenceImage]);

            expect(post.mock.calls[1]?.[1]).toMatchObject({ req_key: "i2i_outpainting", task_type: "dream", image_asset_ids: ["source-asset"] });
            expect(get.mock.calls.map(([url]) => url)).toEqual(["http://example.test/api/v1/task/outpaint-task/status", "http://example.test/api/v1/task/outpaint-task/results"]);
            expect(images[0]?.dataUrl).toBe("http://example.test/storage/outpainted.png");
        } finally {
            post.mockRestore();
            get.mockRestore();
        }
    });

    test("shows the FastAPI detail returned by the server", async () => {
        const post = spyOn(axios, "post").mockRejectedValue({ isAxiosError: true, response: { status: 401, data: { detail: "未认证（缺少 Authorization 头）" } } });
        try {
            const { requestGeneration } = await import("@/services/api/image");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = { ...defaultConfig, apiKey: "invalid-token", channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "invalid-token" })) };
            await expect(requestGeneration(config, "test")).rejects.toThrow("未认证（缺少 Authorization 头）");
        } finally {
            post.mockRestore();
        }
    });
});

describe("Dream LLM request", () => {
    test("uses the built-in HTTPS endpoint and documented request envelope", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({
            data: {
                code: 0,
                message: "成功",
                data: { content: "这是模型回复" },
            },
        });
        try {
            const { requestImageQuestion } = await import("@/services/api/image");
            const { dreamLlmApiUrl } = await import("@/services/api/dream-llm");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = { ...configuredDreamConfig(defaultConfig, "doubao-1.5-pro"), systemPrompt: "你是画布助手" };
            const deltas: string[] = [];

            const answer = await requestImageQuestion(config, [{ role: "user", content: "你好" }], (text) => deltas.push(text));

            expect(answer).toBe("这是模型回复");
            expect(deltas).toEqual(["这是模型回复"]);
            expect(post.mock.calls[0]?.[0]).toBe("https://106.75.147.147/api/v1/ai-service/llm/chat");
            expect(post.mock.calls[0]?.[1]).toEqual({
                project_id: 0,
                platform_code: "ucloud",
                model_code: "doubao-1.5-pro",
                messages: [
                    { role: "system", content: "你是画布助手" },
                    { role: "user", content: "你好" },
                ],
            });
            expect(post.mock.calls[0]?.[2]?.headers).toMatchObject({ Authorization: "Bearer access-token", "Content-Type": "application/json" });
            expect(dreamLlmApiUrl(undefined, true)).toBe("/__dream_api_proxy/api/v1/ai-service/llm/chat");
            expect(() => dreamLlmApiUrl("http://106.75.147.147/api/v1/ai-service/llm/chat", false)).toThrow();
        } finally {
            post.mockRestore();
        }
    });

    test("accepts platform binding without an API key or Authorization header", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-llm" } }));
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, data: { content: "ok" } } });
        try {
            const { requestDreamLlmChat } = await import("@/services/api/dream-llm");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await requestDreamLlmChat({ ...defaultConfig, apiKey: "" }, [{ role: "user", content: "hello" }]);

            expect(post.mock.calls[0]?.[2]?.headers).toEqual({ "Content-Type": "application/json", [CANVAS_SESSION_BINDING_HEADER]: "binding-llm" });
            expect(post.mock.calls[0]?.[2]?.headers).not.toHaveProperty("Authorization");
        } finally {
            post.mockRestore();
        }
    });

    test("parses Doubao function-call markers and sends tool schemas through extra_params", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({
            data: {
                code: 0,
                message: "成功",
                data: { content: '<|FunctionCallBegin|>[{"name":"canvas_get_state","parameters":{}}]<|FunctionCallEnd|>' },
            },
        });
        try {
            const { requestToolResponse } = await import("@/services/api/image");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = configuredDreamConfig(defaultConfig, "doubao-1.5-pro");
            const tools = [{ type: "function" as const, function: { name: "canvas_get_state", description: "读取画布", parameters: { type: "object", properties: {} } } }];
            const result = await requestToolResponse(config, [{ role: "user", content: "你是谁" }], tools, "required");

            expect(result.content).toBe("");
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0]).toMatchObject({ type: "function", function: { name: "canvas_get_state", arguments: "{}" } });
            expect(post.mock.calls[0]?.[1]).toMatchObject({
                extra_params: {
                    tools,
                    tool_choice: "required",
                    parallel_tool_calls: false,
                },
            });
        } finally {
            post.mockRestore();
        }
    });

    test("keeps normal text while extracting multiple marker formats", async () => {
        const { parseDreamLlmContent } = await import("@/services/api/dream-llm");
        const result = parseDreamLlmContent('准备操作。<|FunctionCallBegin|>{"id":"call-1","function":{"name":"canvas_move_nodes","arguments":"{\\"items\\":[{\\"id\\":\\"n1\\",\\"dx\\":10}]}"}}<|FunctionCallEnd|>请稍候。');
        expect(result.content).toBe("准备操作。请稍候。");
        expect(result.toolCalls).toEqual([
            {
                id: "call-1",
                type: "function",
                function: { name: "canvas_move_nodes", arguments: '{"items":[{"id":"n1","dx":10}]}' },
            },
        ]);
    });
});

describe("Dream video request", () => {
    test("preserves explicit 2.0 reference mentions instead of appending every uploaded asset", async () => {
        const { ensureSeedanceReferenceMentions } = await import("@/lib/seedance-video");

        expect(ensureSeedanceReferenceMentions("让 @图片1 保持主体，参考背景运动", [{}], [{}], [{}])).toBe("让 @图片1 保持主体，参考背景运动");
    });

    test("keeps the create response as a task ID instead of treating it as a URL", async () => {
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { id: "first-asset" } })
            .mockResolvedValueOnce({ data: { id: "last-asset" } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "video-task" } });
        try {
            const { createVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = { ...configuredDreamConfig(defaultConfig, "doubao-seedance-1-5-pro-251215"), size: "21:9", videoSeconds: "11", videoMode: "start-end", videoSeed: "" };
            const task = await createVideoGenerationTask(config, "animate it", [
                { ...lastReferenceImage, videoRole: "last" },
                { ...referenceImage, videoRole: "first" },
            ]);

            expect(task).toEqual({ id: "video-task", provider: "dream", model: "dream-default::doubao-seedance-1-5-pro-251215" });
            expect(post.mock.calls.slice(0, 2).map((call) => (call[1] as FormData).get("file"))).toEqual([expect.objectContaining({ name: "source.png" }), expect.objectContaining({ name: "last.png" })]);
            expect(post.mock.calls[2]?.[1]).toMatchObject({
                action_type: "start-end2video",
                dream_video_req_key: "doubao-seedance-1-5-pro-251215",
                image_asset_ids: ["first-asset", "last-asset"],
                script_text: "animate it",
                aspect_ratio: "16:9",
                duration: 10,
                audio: false,
                seed: -1,
                platform_id: 6,
            });
            expect(post.mock.calls[2]?.[1]).not.toHaveProperty("video_ids");
            expect(post.mock.calls[2]?.[1]).not.toHaveProperty("audio_ids");
            expect(post.mock.calls[2]?.[2]?.headers).toMatchObject({ Authorization: "Bearer access-token" });
        } finally {
            post.mockRestore();
        }
    });

    test("sends flat multimodal reference IDs with the reference2video action for the 2.0 model", async () => {
        const videoUrl = URL.createObjectURL(new Blob([new Uint8Array(1024)], { type: "video/mp4" }));
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { id: "image-asset" } })
            .mockResolvedValueOnce({ data: { ok: true } })
            .mockResolvedValueOnce({ data: { code: 0, data: { asset: { id: "video-asset" } } } })
            .mockResolvedValueOnce({ data: { id: "audio-asset" } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "subject-task" } });
        try {
            const { createVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = { ...configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128"), size: "21:9", videoSeconds: "12", videoMode: "subject", videoGenerateAudio: "" };
            const task = await createVideoGenerationTask(
                config,
                "animate subject",
                [referenceImage],
                [{ id: "video", name: "clip.mp4", type: "video/mp4", url: videoUrl }],
                [{ id: "audio", name: "voice.mp3", type: "audio/mpeg", url: "data:audio/mpeg;base64,YXVkaW8=" }],
            );

            expect(task.id).toBe("subject-task");
            expect(post.mock.calls[4]?.[1]).toMatchObject({
                action_type: "reference2video",
                dream_video_req_key: "doubao-seedance-2-0-260128",
                image_asset_ids: ["image-asset"],
                video_ids: ["video-asset"],
                audio_ids: ["audio-asset"],
                script_text: "animate subject\n\n@图片1 @视频1 @音频1",
                aspect_ratio: "21:9",
                duration: 12,
                audio: false,
            });
            expect(post.mock.calls[4]?.[1]).not.toHaveProperty("subjects");
            expect(post.mock.calls[4]?.[1]).not.toHaveProperty("seed");
        } finally {
            post.mockRestore();
            URL.revokeObjectURL(videoUrl);
        }
    });

    test("keeps empty multimodal lists and uses the active platform project for a 2.0 image-only reference", async () => {
        useUserStore.setState({
            projectContext: {
                localProjectId: 42,
                externalProjectId: "external-42",
                sourceSystem: "platform",
                expiresAt: "2026-07-24T00:00:00Z",
            },
        });
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { id: "image-asset" } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "image-reference-task" } });
        try {
            const { createVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = {
                ...configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128"),
                size: "1:1",
                videoSeconds: "5",
                videoMode: "subject",
                videoGenerateAudio: "false",
            };

            const task = await createVideoGenerationTask(config, "做一个动效，人物从画面底部升起", [referenceImage]);

            expect(task.id).toBe("image-reference-task");
            expect(post.mock.calls[1]?.[1]).toMatchObject({
                platform_id: 6,
                project_id: 42,
                action_type: "reference2video",
                dream_video_req_key: "doubao-seedance-2-0-260128",
                image_asset_ids: ["image-asset"],
                video_ids: [],
                audio_ids: [],
                script_text: "做一个动效，人物从画面底部升起\n\n@图片1",
                aspect_ratio: "1:1",
                duration: 5,
                audio: false,
            });
            expect(post.mock.calls[1]?.[1]).not.toHaveProperty("subjects");
            expect(post.mock.calls[1]?.[1]).not.toHaveProperty("seed");
        } finally {
            post.mockRestore();
        }
    });

    test("requires prompts and mode-specific references before creating Dream video tasks", async () => {
        const post = spyOn(axios, "post").mockResolvedValue({ data: { code: 0, message: "ok", data: "video-task" } });
        try {
            const { createVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await expect(createVideoGenerationTask({ ...configuredDreamConfig(defaultConfig, "doubao-seedance-1-5-pro-251215"), videoMode: "start-end" }, "  ", [referenceImage, lastReferenceImage])).rejects.toMatchObject({ key: "video.promptRequired" });
            await expect(createVideoGenerationTask({ ...configuredDreamConfig(defaultConfig, "doubao-seedance-1-5-pro-251215"), videoMode: "start-end" }, "animate", [referenceImage])).rejects.toMatchObject({ key: "error.dream.startEndImagesRequired" });
            await expect(createVideoGenerationTask({ ...configuredDreamConfig(defaultConfig, "doubao-seedance-1-5-pro-251215"), videoMode: "subject" }, "animate", [referenceImage])).rejects.toMatchObject({ key: "error.dream.subjectModelRequired" });
            await expect(createVideoGenerationTask({ ...configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128"), videoMode: "subject" }, "animate")).rejects.toMatchObject({ key: "error.dream.subjectReferencesRequired" });
            await expect(
                createVideoGenerationTask(
                    { ...configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128"), videoMode: "subject" },
                    "animate",
                    Array.from({ length: 10 }, (_, index) => ({ ...referenceImage, id: `reference-${index}` })),
                ),
            ).rejects.toMatchObject({ key: "error.dream.imageReferenceLimit" });
            expect(post).not.toHaveBeenCalled();
        } finally {
            post.mockRestore();
        }
    });

    test("uploads subject audio references directly before sending audio_ids", async () => {
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { data: { asset_id: "audio-asset" } } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "audio-subject-task" } });
        try {
            const { createVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await createVideoGenerationTask(
                { ...configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128"), videoMode: "subject" },
                "use audio",
                [],
                [],
                [{ id: "audio", name: "voice.mp3", type: "audio/mpeg", url: "data:audio/mpeg;base64,YXVkaW8=" }],
            );

            expect(post.mock.calls[0]?.[0]).toBe("http://example.test/api/v1/upload/upload/audio");
            expect(post.mock.calls[0]?.[1]).toBeInstanceOf(FormData);
            expect((post.mock.calls[0]?.[1] as FormData).get("usage")).toBe("mixcut");
            expect((post.mock.calls[0]?.[1] as FormData).get("file")).toEqual(expect.objectContaining({ name: "voice.mp3", type: "audio/mpeg" }));
            expect(post.mock.calls[1]?.[1]).toMatchObject({ action_type: "reference2video", audio_ids: ["audio-asset"] });
        } finally {
            post.mockRestore();
        }
    });

    test("uploads subject videos in fixed chunks, finalizes, and falls back to upload status for the asset ID", async () => {
        const videoUrl = URL.createObjectURL(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "video/mp4" }));
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { ok: true } })
            .mockResolvedValueOnce({ data: { ok: true } })
            .mockResolvedValueOnce({ data: { code: 0, data: {} } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: "video-subject-task" } });
        const get = spyOn(axios, "get").mockResolvedValueOnce({ data: { code: 0, data: { asset: { id: "video-asset" } } } });
        try {
            const { createVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await createVideoGenerationTask({ ...configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128"), videoMode: "subject" }, "use video", [], [{ id: "video", name: "clip.mp4", type: "video/mp4", url: videoUrl }]);

            expect(post.mock.calls.slice(0, 2).map(([url]) => url)).toEqual(["http://example.test/api/v1/upload/upload/chunk", "http://example.test/api/v1/upload/upload/chunk"]);
            const firstChunk = post.mock.calls[0]?.[1] as FormData;
            const secondChunk = post.mock.calls[1]?.[1] as FormData;
            expect(firstChunk.get("upload_id")).toBeTruthy();
            expect(secondChunk.get("upload_id")).toBe(firstChunk.get("upload_id"));
            expect(firstChunk.get("chunk_index")).toBe("0");
            expect(secondChunk.get("chunk_index")).toBe("1");
            expect(post.mock.calls[2]?.[0]).toBe("http://example.test/api/v1/upload/upload/video");
            const finalizeBody = post.mock.calls[2]?.[1] as FormData;
            expect(finalizeBody).toBeInstanceOf(FormData);
            expect(finalizeBody.get("upload_id")).toBe(firstChunk.get("upload_id"));
            expect(finalizeBody.get("total_chunks")).toBe("2");
            expect(finalizeBody.get("file_ext")).toBe("mp4");
            expect(finalizeBody.get("usage")).toBe("mixcut");
            expect(post.mock.calls[2]?.[2]?.headers).toEqual({ Authorization: "Bearer access-token" });
            expect(get.mock.calls[0]?.[0]).toBe(`http://example.test/api/v1/upload/upload/status?upload_id=${firstChunk.get("upload_id")}`);
            expect(post.mock.calls[3]?.[1]).toMatchObject({ action_type: "reference2video", video_ids: ["video-asset"] });
        } finally {
            post.mockRestore();
            get.mockRestore();
            URL.revokeObjectURL(videoUrl);
        }
    });

    test("shows FastAPI 422 field details returned by the video endpoint", async () => {
        const post = spyOn(axios, "post").mockRejectedValue({
            isAxiosError: true,
            response: {
                status: 422,
                data: { detail: [{ loc: ["body", "image_asset_ids"], msg: "Field required", type: "missing" }] },
            },
        });
        try {
            const { createVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            await expect(createVideoGenerationTask(configuredDreamConfig(defaultConfig, "doubao-seedance-1-5-pro-251215"), "animate it", [referenceImage, lastReferenceImage])).rejects.toThrow("image_asset_ids: Field required");
        } finally {
            post.mockRestore();
        }
    });

    test("returns pending while the Dream task is still running", async () => {
        const get = spyOn(axios, "get").mockResolvedValue({ data: { code: 0, message: "ok", data: { done: false, failed: false, progress: 30 } } });
        try {
            const { pollVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = configuredDreamConfig(defaultConfig, "doubao-seedance-1-5-pro-251215");
            const state = await pollVideoGenerationTask(config, { id: "video-task", provider: "dream", model: config.model });

            expect(state).toEqual({ status: "pending" });
            expect(get.mock.calls[0]?.[0]).toBe("http://example.test/api/v1/task/video-task/status");
            expect(get.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer access-token" });
        } finally {
            get.mockRestore();
        }
    });

    test("loads Dream video results and downloads relative URLs with bearer authorization", async () => {
        const video = new Blob(["video"], { type: "video/mp4" });
        const get = spyOn(axios, "get")
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: { done: true, failed: false, progress: 100 } } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: [{ video_url: "/storage/video.mp4", thumbnail_url: "/storage/video.jpg" }] } })
            .mockResolvedValueOnce({ data: video });
        try {
            const { pollVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128");
            const state = await pollVideoGenerationTask(config, { id: "video-task", provider: "dream", model: config.model });

            expect(state).toEqual({ status: "completed", result: { blob: video } });
            expect(get.mock.calls.map(([url]) => url)).toEqual(["http://example.test/api/v1/task/video-task/status", "http://example.test/api/v1/task/video-task/results", "http://example.test/storage/video.mp4"]);
            expect(get.mock.calls.every(([, options]) => options?.headers?.Authorization === "Bearer access-token")).toBe(true);
        } finally {
            get.mockRestore();
        }
    });

    test("uses task detail error_message when a Dream task fails", async () => {
        const get = spyOn(axios, "get")
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: { done: false, failed: true, progress: 50 } } })
            .mockResolvedValueOnce({ data: { id: "video-task", status: "failed", error_message: "上游视频模型失败" } });
        try {
            const { pollVideoGenerationTask } = await import("@/services/api/video");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = configuredDreamConfig(defaultConfig, "doubao-seedance-2-0-260128");
            const state = await pollVideoGenerationTask(config, { id: "video-task", provider: "dream", model: config.model });

            expect(state.status).toBe("failed");
            if (state.status === "failed") expect(state.error).toMatchObject({ rawMessage: "上游视频模型失败" });
            expect(get.mock.calls.map(([url]) => url)).toEqual(["http://example.test/api/v1/task/video-task/status", "http://example.test/api/v1/task/video-task"]);
            expect(get.mock.calls.every(([, options]) => options?.headers?.Authorization === "Bearer access-token")).toBe(true);
        } finally {
            get.mockRestore();
        }
    });
});

describe("Dream TTS request", () => {
    test("downloads the synchronous audio_url with bearer authorization", async () => {
        const audio = new Blob(["audio"], { type: "audio/mpeg" });
        const post = spyOn(axios, "post").mockResolvedValue({ data: { audio_url: "/storage/speech.mp3" } });
        const get = spyOn(axios, "get").mockResolvedValue({ data: audio });
        try {
            const { requestDreamAudioGeneration } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const blob = await requestDreamAudioGeneration(configuredDreamConfig(defaultConfig, "tts-synthesize"), "你好");

            expect(blob).toBe(audio);
            expect(get.mock.calls[0]?.[0]).toBe("http://example.test/storage/speech.mp3");
            expect(get.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer access-token" });
        } finally {
            post.mockRestore();
            get.mockRestore();
        }
    });

    test("uses platform binding for Dream media without browser Authorization", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-media" } }));
        const audio = new Blob(["audio"], { type: "audio/mpeg" });
        const post = spyOn(axios, "post").mockResolvedValue({ data: { audio_url: "/storage/speech.mp3" } });
        const get = spyOn(axios, "get").mockResolvedValue({ data: audio });
        try {
            const { requestDreamAudioGeneration, requestDreamMediaBlob } = await import("@/services/api/dream");
            const { defaultConfig } = await import("@/stores/use-config-store");
            const config = { ...configuredDreamConfig(defaultConfig, "tts-synthesize"), apiKey: "" };
            await requestDreamAudioGeneration(config, "hello");
            await requestDreamMediaBlob(config, "/__dream_media_proxy?url=example");

            expect(post.mock.calls[0]?.[2]?.headers).toEqual({ "Content-Type": "application/json", [CANVAS_SESSION_BINDING_HEADER]: "binding-media" });
            expect(get.mock.calls[0]?.[1]?.headers).toEqual({ [CANVAS_SESSION_BINDING_HEADER]: "binding-media" });
            expect(get.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
            expect(get.mock.calls[1]?.[1]?.headers).toEqual({ [CANVAS_SESSION_BINDING_HEADER]: "binding-media" });
        } finally {
            post.mockRestore();
            get.mockRestore();
        }
    });
});
