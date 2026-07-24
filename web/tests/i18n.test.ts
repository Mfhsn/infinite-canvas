import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, test } from "bun:test";

import { translate } from "@/i18n/messages";
import { formatGenerationLogTime, normalizeGenerationLogStatus } from "@/lib/generation-log";
import { AppError, localizeError, localizeStoredError, storeError } from "@/lib/app-error";
import { useLanguageStore } from "@/stores/use-language-store";

describe("application localization", () => {
    beforeEach(() => {
        useLanguageStore.setState({ language: "zh-CN" });
    });

    test("translates the same key and interpolates parameters in both locales", () => {
        expect(translate("zh-CN", "home.projectStats", { nodes: 3, connections: 2 })).toBe("3 个节点 · 2 条连接");
        expect(translate("en-US", "home.projectStats", { nodes: 3, connections: 2 })).toBe("3 nodes · 2 connections");
        expect(translate("zh-CN", "user.points", { points: 42 })).toBe("积分 42");
        expect(translate("en-US", "auth.login")).toBe("Sign in");
        expect(translate("zh-CN", "platformProject.id", { id: "project-1" })).toBe("项目 ID：project-1");
        expect(translate("en-US", "auth.registerSuccess")).toContain("Registration succeeded");
    });

    test("switches the persisted application language without mutating unrelated state", () => {
        expect(useLanguageStore.getState().language).toBe("zh-CN");
        useLanguageStore.getState().toggleLanguage();
        expect(useLanguageStore.getState().language).toBe("en-US");
        useLanguageStore.getState().setLanguage("zh-CN");
        expect(useLanguageStore.getState().language).toBe("zh-CN");
    });

    test("migrates legacy localized log statuses and formats timestamps at render time", () => {
        expect(normalizeGenerationLogStatus("生成中", "failed")).toBe("pending");
        expect(normalizeGenerationLogStatus("成功", "failed")).toBe("success");
        expect(normalizeGenerationLogStatus("失败", "success")).toBe("failed");
        expect(normalizeGenerationLogStatus("pending", "failed")).toBe("pending");

        const timestamp = Date.UTC(2026, 6, 14, 2, 12, 49);
        expect(formatGenerationLogTime(timestamp, "zh-CN")).not.toBe(formatGenerationLogTime(timestamp, "en-US"));
    });

    test("keeps local service errors language-neutral until the current UI locale renders them", () => {
        const error = new AppError("error.image.invalidRatio");
        const stored = storeError(error, "common.generateFailed");

        expect(error.message).toBe("error.image.invalidRatio");
        expect(localizeError(error, (key, params) => translate("zh-CN", key, params), "common.generateFailed")).toBe("图像比例必须是正数，例如 9:16");
        expect(localizeStoredError(stored, (key, params) => translate("en-US", key, params), "common.generateFailed")).toBe("The image ratio must be positive, for example 9:16");
    });

    test("renders legacy object-shaped canvas errors without crashing", () => {
        const translator = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en-US", key, params);

        expect(localizeStoredError({ message: "Dream API connection failed" } as never, translator, "common.generateFailed")).toBe("Dream API connection failed");
        expect(localizeStoredError({ key: "canvas.allImagesFailed" } as never, translator, "common.generateFailed")).toBe("All images failed to generate");
        expect(localizeStoredError({} as never, translator, "common.generateFailed")).toBe("Generation failed");
    });

    test("normalizes FastAPI validation details before rendering retry errors", () => {
        const translator = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en-US", key, params);
        const detail = [{ type: "missing", loc: ["body", "image_asset_ids"], msg: "Field required", input: null }];
        const error = new AppError("error.requestFailed", undefined, { rawMessage: detail as never });

        expect(error.message).toBe("image_asset_ids: Field required");
        expect(localizeError(error, translator, "common.generateFailed")).toBe("image_asset_ids: Field required");
        expect(storeError(error, "common.generateFailed")).toBe("image_asset_ids: Field required");
        expect(localizeStoredError(detail, translator, "common.generateFailed")).toBe("image_asset_ids: Field required");
    });
});

describe("online canvas agent protocol boundary", () => {
    test("keeps the internal system prompt and tool schemas byte-for-byte stable", () => {
        const source = readFileSync(new URL("../src/components/canvas/canvas-assistant-panel.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
        const protocol = source.slice(source.indexOf("const ONLINE_AGENT_PROMPT"), source.indexOf("type OnlineAgentTab"));
        expect(createHash("sha256").update(protocol).digest("hex")).toBe("4a9b2adbcda898607cda8a2b835dbbe61b25f55455315c27a8a5820fc657f4c5");
    });
});
