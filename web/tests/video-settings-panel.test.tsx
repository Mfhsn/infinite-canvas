import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";

describe("canvas Dream video resolution settings", () => {
    test("shows three choices for standard Seedance and a fixed 720p value for Fast and Mini", async () => {
        const { VideoSettingsPanel } = await import("@/components/video-settings-panel");
        const { canvasThemes } = await import("@/lib/canvas-theme");
        const { defaultConfig } = await import("@/stores/use-config-store");
        const renderModel = (model: string) =>
            renderToStaticMarkup(<VideoSettingsPanel config={{ ...defaultConfig, model: `dream-default::${model}`, videoModel: `dream-default::${model}` }} onConfigChange={() => undefined} theme={canvasThemes.light} showDreamResolution />);

        const standard = renderModel("doubao-seedance-2-0-260128");
        expect(standard).toContain(">720p<");
        expect(standard).toContain(">1080p<");
        expect(standard).toContain(">4K<");

        for (const model of ["doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615"]) {
            const fixed = renderModel(model);
            expect(fixed).toContain(">720p<");
            expect(fixed).toContain("当前模型固定使用 720p");
            expect(fixed).not.toContain(">1080p<");
            expect(fixed).not.toContain(">4K<");
        }
    }, 60_000);
});
