import { type ComponentType, useMemo } from "react";
import { Button } from "antd";
import { ArrowRight, FileText, ImagePlus, Images, Maximize2, Play, Plus, Sparkles, Video, Workflow } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { useI18n } from "@/i18n/use-i18n";
import { canvasProjectTitle } from "@/lib/canvas/canvas-project-title";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

type Icon = ComponentType<{ className?: string }>;
type VisualAsset = Extract<Asset, { kind: "image" | "video" }>;

const quickTools = [
    { path: "/canvas?mode=new", labelKey: "nav.canvas", descKey: "home.tool.canvasDesc", icon: Maximize2, featured: true },
    { path: "/image", labelKey: "nav.image", descKey: "home.tool.imageDesc", icon: ImagePlus },
    { path: "/video", labelKey: "nav.video", descKey: "home.tool.videoDesc", icon: Video },
    { path: "/prompts", labelKey: "nav.prompts", descKey: "home.tool.promptsDesc", icon: FileText },
    { path: "/assets", labelKey: "nav.assets", descKey: "home.tool.assetsDesc", icon: Images },
] as const;

export default function IndexPage() {
    const { t, language } = useI18n();
    const navigate = useNavigate();
    const projectsHydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const assets = useAssetStore((state) => state.assets);

    const recentProjects = useMemo(() => sortRecent(projects).slice(0, 3), [projects]);
    const recentAssets = useMemo(() => sortRecent(assets.filter(isVisualAsset)).slice(0, 4), [assets]);
    const latestProject = recentProjects[0];
    const latestAsset = recentAssets[0];

    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="relative isolate overflow-hidden">
                <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[44rem] bg-[radial-gradient(circle_at_78%_8%,rgba(255,107,53,0.16),transparent_34%),linear-gradient(to_bottom,rgba(120,113,108,0.06),transparent_70%)] dark:bg-[radial-gradient(circle_at_78%_8%,rgba(255,107,53,0.12),transparent_32%),linear-gradient(to_bottom,rgba(255,255,255,0.025),transparent_70%)]" />

                <section className="mx-auto grid w-full min-w-0 max-w-7xl grid-cols-[minmax(0,1fr)] gap-10 px-6 pb-12 pt-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] lg:items-center lg:gap-14 lg:pb-16 lg:pt-16">
                    <div className="min-w-0 max-w-2xl">
                        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            <span className="h-px w-10 bg-[#ff6b35]" />
                            {t("home.eyebrow")}
                        </div>
                        <h1 className="mt-7 text-[clamp(2.5rem,5.2vw,4rem)] font-semibold leading-[1.03] tracking-[-0.045em]">
                            <span className="block sm:whitespace-nowrap">{t("home.heroTitle")}</span>
                            <span className="mt-2 block text-[#d84f22] dark:text-[#ff7a4d]">
                                <span className="block sm:whitespace-nowrap">{t("home.heroAccentPrimary")}</span>
                                <span className="block sm:whitespace-nowrap">{t("home.heroAccentSecondary")}</span>
                            </span>
                        </h1>
                        <p className="mt-7 max-w-xl text-pretty text-base leading-8 text-muted-foreground sm:text-lg">{t("home.heroDesc")}</p>

                        <div className="mt-9 flex flex-wrap items-center gap-3">
                            <Button
                                type="primary"
                                size="large"
                                className="!h-11 !border-[#ff6b35] !bg-[#ff6b35] !px-5 !font-semibold !text-[#171717] hover:!border-[#ff7a4d] hover:!bg-[#ff7a4d]"
                                icon={<Plus className="size-4" />}
                                onClick={() => navigate("/canvas?mode=new")}
                            >
                                {t("home.newCanvas")}
                            </Button>
                            <Button size="large" className="!h-11 !px-5" icon={latestProject ? <Play className="size-4" /> : <ImagePlus className="size-4" />} onClick={() => navigate(latestProject ? `/canvas/${latestProject.id}` : "/image")}>
                                {latestProject ? t("home.continueCreating") : t("home.quickImage")}
                            </Button>
                        </div>

                        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-2">
                                <span className="size-1.5 rounded-full bg-[#ff6b35]" />
                                {t("home.signal.local")}
                            </span>
                            <span className="inline-flex items-center gap-2">
                                <span className="size-1.5 rounded-full bg-foreground/35" />
                                {t("home.signal.connected")}
                            </span>
                        </div>
                    </div>

                    <WorkflowPreview asset={latestAsset} t={t} />
                </section>
            </div>

            <section className="mx-auto w-full max-w-7xl px-6 py-10 sm:py-12">
                <SectionHeading title={t("home.quickStartTitle")} description={t("home.quickStartDesc")} />
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-10">
                    {quickTools.map((tool, index) => (
                        <QuickToolCard key={tool.path} path={tool.path} icon={tool.icon} index={index} title={t(tool.labelKey)} description={t(tool.descKey)} action={t("home.enterTool")} featured={"featured" in tool && tool.featured} />
                    ))}
                </div>
            </section>

            {projectsHydrated ? (
                recentProjects.length ? (
                    <section className="mx-auto w-full max-w-7xl px-6 py-10 sm:py-12">
                        <SectionHeading title={t("home.recentTitle")} description={t("home.recentDesc")} action={{ label: t("home.viewAllCanvases"), path: "/canvas" }} />
                        <div className="mt-7 grid gap-4 md:grid-cols-3">
                            {recentProjects.map((project, index) => (
                                <RecentProjectCard key={project.id} project={project} index={index} language={language} t={t} />
                            ))}
                        </div>
                    </section>
                ) : (
                    <StarterPath t={t} />
                )
            ) : null}

            {assetsHydrated && recentAssets.length ? (
                <section className="mx-auto w-full max-w-7xl px-6 py-10 sm:py-12">
                    <SectionHeading title={t("home.recentAssetsTitle")} description={t("home.recentAssetsDesc")} action={{ label: t("home.viewAllAssets"), path: "/assets" }} />
                    <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
                        {recentAssets.map((asset) => (
                            <Link
                                key={asset.id}
                                to="/assets"
                                aria-label={t("home.openAsset", { title: asset.title })}
                                className="group overflow-hidden rounded-2xl border !bg-card !text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-[#ff6b35]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b35] motion-reduce:transform-none motion-reduce:transition-none"
                            >
                                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                                    <AssetVisual asset={asset} className="transition duration-300 group-hover:scale-[1.02] motion-reduce:transform-none motion-reduce:transition-none" />
                                    <span className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
                                        {asset.kind === "video" ? t("home.assetVideo") : t("home.assetImage")}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-3 p-4">
                                    <span className="truncate text-sm font-medium">{asset.title}</span>
                                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transform-none" />
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>
            ) : null}

            <div className="mx-auto w-full max-w-7xl px-6 pb-16 pt-8">
                <div className="h-px bg-border" />
                <div className="flex flex-wrap items-center justify-between gap-4 py-7 text-xs text-muted-foreground">
                    <span>{t("home.footerLine")}</span>
                    <Link to="/canvas?mode=new" className="inline-flex min-h-8 items-center gap-2 font-medium text-foreground hover:text-[#d84f22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b35]">
                        {t("home.footerAction")}
                        <ArrowRight className="size-3.5" />
                    </Link>
                </div>
            </div>
        </main>
    );
}

function WorkflowPreview({ asset, t }: { asset?: VisualAsset; t: ReturnType<typeof useI18n>["t"] }) {
    return (
        <div className="relative min-h-[410px] w-full min-w-0 max-w-full overflow-hidden rounded-[28px] border border-black/10 bg-[#161616] text-[#f8f5ee] shadow-[0_28px_90px_rgba(38,30,24,0.13)] dark:border-white/15 dark:bg-[#f0ece3] dark:text-[#181716] dark:shadow-none">
            <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.07)_1px,transparent_1px)] [background-size:36px_36px] dark:opacity-15 dark:[background-image:linear-gradient(rgba(0,0,0,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,.18)_1px,transparent_1px)]" />
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/10 px-5 py-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55 dark:border-black/10 dark:text-black/50">
                <span className="inline-flex items-center gap-2">
                    <Workflow className="size-3.5" />
                    {t("home.workflowLabel")}
                </span>
                <span>{t("home.workflowStatus")}</span>
            </div>

            <svg aria-hidden="true" viewBox="0 0 640 410" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full text-[#ff6b35]">
                <path d="M172 145 C 270 145, 275 216, 382 216" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 7" opacity="0.72" />
                <path d="M470 285 C 420 350, 286 330, 214 344" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.72" />
                <circle cx="172" cy="145" r="4" fill="currentColor" />
                <circle cx="382" cy="216" r="4" fill="currentColor" />
                <circle cx="214" cy="344" r="4" fill="currentColor" />
            </svg>

            <div className="absolute left-[6%] top-[22%] z-10 w-[38%] max-w-52 rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-md dark:border-black/10 dark:bg-white/70">
                <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-white/50 dark:text-black/45">
                    <Sparkles className="size-3.5 text-[#ff7a4d]" />
                    {t("home.workflowIdeaLabel")}
                </div>
                <p className="mt-3 text-sm font-medium leading-6">{t("home.workflowIdeaText")}</p>
            </div>

            <div className="absolute right-[5%] top-[28%] z-10 w-[48%] overflow-hidden rounded-2xl border border-white/15 bg-black/40 shadow-2xl dark:border-black/10 dark:bg-white">
                <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_28%_28%,#ffb36b,transparent_28%),radial-gradient(circle_at_72%_36%,#c26dff,transparent_34%),linear-gradient(135deg,#20233a,#0f1016)]">
                    {asset ? <AssetVisual asset={asset} /> : <FallbackArtwork />}
                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent p-4 text-white">
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-white/60">{t("home.workflowOutputLabel")}</p>
                            <p className="mt-1 text-sm font-medium">{asset?.title || t("home.workflowOutputText")}</p>
                        </div>
                        <span className="flex size-8 items-center justify-center rounded-full bg-white/15 backdrop-blur">{asset?.kind === "video" ? <Play className="size-3.5" /> : <ImagePlus className="size-3.5" />}</span>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-[7%] left-[12%] z-10 w-[38%] max-w-52 rounded-xl border border-white/15 bg-[#242424] p-4 dark:border-black/10 dark:bg-[#fffaf0]">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-white/45 dark:text-black/45">{t("home.workflowCanvasLabel")}</p>
                        <p className="mt-2 text-sm font-medium">{t("home.workflowCanvasText")}</p>
                    </div>
                    <Maximize2 className="size-5 text-[#ff7a4d]" />
                </div>
            </div>
        </div>
    );
}

function FallbackArtwork() {
    return (
        <div aria-hidden="true" className="absolute inset-0">
            <div className="absolute left-[13%] top-[14%] h-[58%] w-[34%] rotate-[-8deg] rounded-[42%_58%_48%_52%] bg-[#ff6b35]/90 mix-blend-screen" />
            <div className="absolute right-[9%] top-[22%] size-[46%] rounded-full bg-[#8b5cf6]/70 blur-sm mix-blend-screen" />
            <div className="absolute bottom-[-18%] left-[31%] h-[54%] w-[52%] rotate-12 rounded-[48%] border-[18px] border-[#f8f5ee]/40" />
        </div>
    );
}

function AssetVisual({ asset, className }: { asset: VisualAsset; className?: string }) {
    if (asset.kind === "video") {
        return <video src={asset.data.url} poster={asset.coverUrl || undefined} muted playsInline preload="metadata" aria-hidden="true" className={cn("size-full object-cover", className)} />;
    }
    return <img src={asset.coverUrl || asset.data.dataUrl} alt={asset.title} className={cn("size-full object-cover", className)} />;
}

function SectionHeading({ title, description, action }: { title: string; description: string; action?: { label: string; path: string } }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
            <div>
                <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">{title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            {action ? (
                <Link to={action.path} className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-foreground hover:text-[#d84f22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b35]">
                    {action.label}
                    <ArrowRight className="size-4" />
                </Link>
            ) : null}
        </div>
    );
}

function QuickToolCard({ path, icon: ToolIcon, index, title, description, action, featured }: { path: string; icon: Icon; index: number; title: string; description: string; action: string; featured?: boolean }) {
    return (
        <Link
            to={path}
            className={cn(
                "group flex min-h-52 flex-col justify-between rounded-2xl border !bg-card p-5 !text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-[#ff6b35]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b35] motion-reduce:transform-none motion-reduce:transition-none lg:col-span-2",
                featured && "!bg-foreground !text-background sm:col-span-2 lg:col-span-2",
            )}
        >
            <div className="flex items-start justify-between gap-4">
                <span className={cn("flex size-10 items-center justify-center rounded-xl bg-muted text-foreground", featured && "bg-background/10 text-background")}>
                    <ToolIcon className="size-5" />
                </span>
                <span className={cn("font-mono text-[10px] tracking-wider text-muted-foreground", featured && "text-background/45")}>0{index + 1}</span>
            </div>
            <div className="mt-8">
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className={cn("mt-2 text-sm leading-6 text-muted-foreground", featured && "text-background/65")}>{description}</p>
                <span className={cn("mt-5 inline-flex items-center gap-2 text-xs font-semibold", featured ? "text-[#ff8a62] dark:text-[#b83a12]" : "text-foreground")}>
                    {action}
                    <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5 motion-reduce:transform-none" />
                </span>
            </div>
        </Link>
    );
}

function RecentProjectCard({ project, index, language, t }: { project: CanvasProject; index: number; language: string; t: ReturnType<typeof useI18n>["t"] }) {
    const updatedAt = new Intl.DateTimeFormat(language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(project.updatedAt));
    return (
        <Link
            to={`/canvas/${project.id}`}
            aria-label={t("home.openProject", { title: canvasProjectTitle(project.title, t) })}
            className="group relative min-h-56 overflow-hidden rounded-2xl border !bg-card p-5 !text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-[#ff6b35]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b35] motion-reduce:transform-none motion-reduce:transition-none"
        >
            <div aria-hidden="true" className="absolute right-[-10%] top-[-18%] size-40 rounded-full border border-[#ff6b35]/20" />
            <div aria-hidden="true" className="absolute right-[8%] top-[12%] size-20 rounded-full border border-dashed border-foreground/10" />
            <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-start justify-between gap-4">
                    <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">CANVAS / 0{index + 1}</span>
                    <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transform-none" />
                </div>
                <div className="mt-14">
                    <h3 className="truncate text-xl font-semibold tracking-[-0.025em]">{canvasProjectTitle(project.title, t)}</h3>
                    <p className="mt-3 text-sm text-muted-foreground">{t("home.projectStats", { nodes: project.nodes.length, connections: project.connections.length })}</p>
                    <p className="mt-5 text-xs text-muted-foreground">{t("home.projectUpdated", { time: updatedAt })}</p>
                </div>
            </div>
        </Link>
    );
}

function StarterPath({ t }: { t: ReturnType<typeof useI18n>["t"] }) {
    const steps = [
        { title: t("home.starterGenerateTitle"), description: t("home.starterGenerateDesc") },
        { title: t("home.starterArrangeTitle"), description: t("home.starterArrangeDesc") },
        { title: t("home.starterReuseTitle"), description: t("home.starterReuseDesc") },
    ];
    return (
        <section className="mx-auto w-full max-w-7xl px-6 py-10 sm:py-12">
            <SectionHeading title={t("home.starterTitle")} description={t("home.starterDesc")} />
            <div className="mt-7 grid overflow-hidden rounded-2xl border bg-card md:grid-cols-3">
                {steps.map((step, index) => (
                    <div key={step.title} className="relative p-6 md:border-r md:last:border-r-0">
                        <span className="text-xs font-semibold text-[#d84f22] dark:text-[#ff7a4d]">0{index + 1}</span>
                        <h3 className="mt-8 text-lg font-semibold">{step.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function sortRecent<T extends { updatedAt: string }>(items: T[]) {
    return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function isVisualAsset(asset: Asset): asset is VisualAsset {
    return asset.kind === "image" || asset.kind === "video";
}
