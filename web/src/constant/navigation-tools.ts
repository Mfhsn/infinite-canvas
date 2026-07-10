import { FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        labelKey: "nav.canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        labelKey: "nav.image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        labelKey: "nav.video",
        icon: Video,
    },
    {
        slug: "prompts",
        label: "提示词库",
        labelKey: "nav.prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        label: "我的素材",
        labelKey: "nav.assets",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
