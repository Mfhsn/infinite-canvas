import { FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";

export const navigationTools = [
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

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
