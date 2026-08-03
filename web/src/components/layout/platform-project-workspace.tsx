import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Alert, App, Button, Empty, Form, Input, Modal, Popover, Spin, Tag } from "antd";
import { BriefcaseBusiness, Check, ChevronDown, Coins, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { parsePlatformProjectSkillIds, usePlatformProjectStore } from "@/stores/use-platform-project-store";
import { useUserStore } from "@/stores/use-user-store";

type CreateProjectValues = {
    name: string;
    tag: string;
    skill: string;
    skillModel?: string;
    content?: string;
};

export function PlatformProjectWorkspace({ className, style, compact = false }: { className?: string; style?: CSSProperties; compact?: boolean }) {
    const { t } = useI18n();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [form] = Form.useForm<CreateProjectValues>();
    const projects = usePlatformProjectStore((state) => state.projects);
    const loadStatus = usePlatformProjectStore((state) => state.loadStatus);
    const creating = usePlatformProjectStore((state) => state.creating);
    const selectingProjectId = usePlatformProjectStore((state) => state.selectingProjectId);
    const error = usePlatformProjectStore((state) => state.error);
    const loadProjects = usePlatformProjectStore((state) => state.loadProjects);
    const createProject = usePlatformProjectStore((state) => state.createProject);
    const selectProject = usePlatformProjectStore((state) => state.selectProject);
    const currentPoints = useUserStore((state) => state.currentPoints);
    const permissionIds = useUserStore((state) => state.permissionIds);
    const currentProjectId = useUserStore((state) => state.projectContext?.externalProjectId || "");
    const currentProject = useMemo(() => projects.find((project) => project.projectId === currentProjectId), [currentProjectId, projects]);
    const currentName = currentProject?.name || currentProjectId || t("platformProject.unknown");

    const changeOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) void loadProjects().catch(() => undefined);
    };

    const select = async (projectId: string) => {
        if (projectId === currentProjectId) return;
        try {
            await selectProject(projectId);
            setOpen(false);
            navigate("/canvas", { replace: true });
            message.success(t("platformProject.switchSuccess"));
        } catch (selectionError) {
            message.error(selectionError instanceof Error ? selectionError.message : t("platformProject.switchFailed"));
        }
    };

    const create = async (values: CreateProjectValues) => {
        const skill = parsePlatformProjectSkillIds(values.skill);
        if (!skill.length) {
            form.setFields([{ name: "skill", errors: [t("platformProject.skillRequired")] }]);
            return;
        }
        try {
            await createProject({
                name: values.name.trim(),
                tag: values.tag.trim(),
                skill,
                content: values.content?.trim() || null,
                skillModel: values.skillModel
                    ?.split(/[,，\n]+/)
                    .map((item) => item.trim())
                    .filter(Boolean),
            });
            setCreateOpen(false);
            form.resetFields();
            message.success(t("platformProject.createSuccess"));
        } catch (creationError) {
            message.error(creationError instanceof Error ? creationError.message : t("platformProject.createFailed"));
        }
    };

    const content = (
        <section className="w-[390px] max-w-[calc(100vw-24px)]" aria-label={t("platformProject.workspace")}>
            <div className="rounded-lg bg-stone-50 p-3 dark:bg-white/5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs text-stone-500">{t("platformProject.current")}</div>
                        <div className="mt-1 truncate text-sm font-semibold">{currentName}</div>
                        <div className="mt-1 truncate text-xs text-stone-500">{t("platformProject.id", { id: currentProjectId || "--" })}</div>
                    </div>
                    <Tag color="green" icon={<Check className="size-3" />}>
                        {t("platformProject.active")}
                    </Tag>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-600 dark:text-stone-300">
                    <span className="inline-flex items-center gap-1">
                        <Coins className="size-3.5" />
                        {t("user.points", { points: currentPoints ?? "--" })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="size-3.5" />
                        {t("platformProject.permissions", { permissions: permissionIds.length ? permissionIds.join(", ") : "--" })}
                    </span>
                </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-medium">{t("platformProject.available")}</span>
                <Button type="text" size="small" icon={<RefreshCw className={cn("size-4", loadStatus === "loading" && "animate-spin")} />} onClick={() => void loadProjects().catch(() => undefined)}>
                    {t("common.refresh")}
                </Button>
            </div>

            {error && loadStatus === "error" ? <Alert className="mt-2" type="error" showIcon message={error} /> : null}
            <div className="mt-2 max-h-[360px] overflow-y-auto">
                {loadStatus === "loading" && !projects.length ? (
                    <div className="grid min-h-28 place-items-center">
                        <Spin />
                    </div>
                ) : projects.length ? (
                    projects.map((project) => {
                        const active = project.projectId === currentProjectId;
                        const switching = selectingProjectId === project.projectId;
                        return (
                            <button
                                key={project.projectId}
                                type="button"
                                disabled={active || Boolean(selectingProjectId)}
                                className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition", active ? "bg-stone-100 dark:bg-white/10" : "hover:bg-stone-100 disabled:opacity-60 dark:hover:bg-white/10")}
                                onClick={() => void select(project.projectId)}
                            >
                                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
                                    <BriefcaseBusiness className="size-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{project.name}</span>
                                    <span className="mt-1 block truncate text-xs text-stone-500">{project.projectId}</span>
                                    <span className="mt-1 block truncate text-xs text-stone-500">{t("platformProject.permissions", { permissions: project.permissionIds.length ? project.permissionIds.join(", ") : "--" })}</span>
                                </span>
                                {switching ? <Spin size="small" /> : active ? <Check className="size-4 shrink-0" /> : null}
                            </button>
                        );
                    })
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("platformProject.empty")} />
                )}
            </div>

            <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-700">
                <Button block icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                    {t("platformProject.create")}
                </Button>
            </div>
        </section>
    );

    return (
        <>
            <Popover open={open} onOpenChange={changeOpen} trigger="click" placement="bottomRight" content={content} arrow={false} styles={{ content: { padding: 12, borderRadius: 10 } }}>
                <button type="button" className={cn(className, compact && "max-w-40")} style={style} aria-label={t("platformProject.open")} title={t("platformProject.open")}>
                    <BriefcaseBusiness className="size-4" />
                    <span className="max-w-28 truncate text-xs font-medium">{currentName}</span>
                    <ChevronDown className="size-3.5" />
                </button>
            </Popover>
            <Modal title={t("platformProject.create")} open={createOpen} confirmLoading={creating} okText={t("platformProject.createAction")} cancelText={t("common.cancel")} onOk={() => form.submit()} onCancel={() => setCreateOpen(false)} destroyOnHidden>
                <Form<CreateProjectValues> form={form} layout="vertical" requiredMark={false} onFinish={create}>
                    <Form.Item name="name" label={t("platformProject.name")} rules={[{ required: true, whitespace: true, message: t("platformProject.nameRequired") }]}>
                        <Input autoFocus placeholder={t("platformProject.namePlaceholder")} />
                    </Form.Item>
                    <Form.Item name="tag" label={t("platformProject.tag")} rules={[{ required: true, whitespace: true, message: t("platformProject.tagRequired") }]}>
                        <Input placeholder={t("platformProject.tagPlaceholder")} />
                    </Form.Item>
                    <Form.Item name="skill" label={t("platformProject.skill")} extra={t("platformProject.skillExtra")} rules={[{ required: true, whitespace: true, message: t("platformProject.skillRequired") }]}>
                        <Input placeholder={t("platformProject.skillPlaceholder")} />
                    </Form.Item>
                    <Form.Item name="skillModel" label={t("platformProject.skillModel")} extra={t("platformProject.skillModelExtra")}>
                        <Input placeholder={t("platformProject.skillModelPlaceholder")} />
                    </Form.Item>
                    <Form.Item name="content" label={t("platformProject.description")}>
                        <Input.TextArea rows={3} placeholder={t("platformProject.descriptionPlaceholder")} />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}
