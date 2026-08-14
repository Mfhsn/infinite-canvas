import { queryOptions, useQuery } from "@tanstack/react-query";

import { buildNodeGenerationContextFromInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { buildDreamImagePointsSpec, buildDreamTextPointsSpec, buildDreamVideoPointsSpec, type DreamPointsEstimateSpec } from "@/lib/dream-points";
import { isBuiltInDreamVideoConfig, normalizeDreamVideoMode } from "@/lib/seedance-video";
import { requestDreamPointsEstimate } from "@/services/api/dream";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";

export function dreamPointsEstimateQueryOptions(spec: DreamPointsEstimateSpec | null) {
    return queryOptions({
        queryKey: spec ? ["dream-points-estimate", spec.config.baseUrl, spec.request] : ["dream-points-estimate", "disabled"],
        queryFn: ({ signal }) => {
            if (!spec) throw new Error("Dream points estimation is not supported for this request");
            return requestDreamPointsEstimate(spec.config, spec.request, { signal });
        },
        enabled: Boolean(spec),
        staleTime: 15_000,
        retry: false,
    });
}

export function useGenerationPointsEstimate(spec: DreamPointsEstimateSpec | null) {
    return useQuery(dreamPointsEstimateQueryOptions(spec));
}

export function useCanvasGenerationPointsEstimate(options: { config: AiConfig; mode: CanvasGenerationMode; node: CanvasNodeData; inputs: NodeGenerationInput[]; prompt: string }) {
    const isDreamVideo = options.mode === "video" && isBuiltInDreamVideoConfig(options.config);
    const videoMode = isDreamVideo ? normalizeDreamVideoMode(options.config.videoMode, modelOptionName(options.config.videoModel || options.config.model)) : null;
    const context = buildNodeGenerationContextFromInputs(options.node, options.inputs, options.prompt, {
        useStartEndFrames: videoMode === "start-end",
        includeAllMediaReferences: videoMode === "subject",
    });
    const sourceImageCount = options.mode === "image" && options.node.type === CanvasNodeType.Image && options.node.metadata?.content ? 1 : 0;
    const spec =
        options.mode === "image"
            ? buildDreamImagePointsSpec(options.config, options.config.count, context.referenceImages.length + sourceImageCount)
            : options.mode === "text"
              ? buildDreamTextPointsSpec(options.config, options.node.type === CanvasNodeType.Config ? options.config.count : 1)
              : options.mode === "video"
                ? buildDreamVideoPointsSpec(options.config, { imageCount: context.referenceImages.length, videoCount: context.referenceVideos.length })
                : null;
    return { spec, query: useGenerationPointsEstimate(spec) };
}
