import { FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";
import { ENV_SHOW_IMAGE_WORKBENCH, ENV_SHOW_VIDEO_WORKBENCH } from "@/constant/env";

const allNavigationTools = [
    {
        slug: "canvas",
        labelKey: "nav.canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        labelKey: "nav.image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        labelKey: "nav.video",
        icon: Video,
    },
    {
        slug: "prompts",
        labelKey: "nav.prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        labelKey: "nav.assets",
        icon: Images,
    },
] as const;

export const navigationTools = allNavigationTools.filter((tool) => {
    if (tool.slug === "image") return ENV_SHOW_IMAGE_WORKBENCH;
    if (tool.slug === "video") return ENV_SHOW_VIDEO_WORKBENCH;
    return true;
});

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
