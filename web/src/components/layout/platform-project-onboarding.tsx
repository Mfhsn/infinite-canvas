import { useState } from "react";
import { Alert, App, Button, Card, Empty, Form, Input, Modal, Spin, Tag, Typography } from "antd";
import { ArrowRight, BriefcaseBusiness, Plus, RefreshCw } from "lucide-react";

import { useI18n } from "@/i18n/use-i18n";
import { PLATFORM_HOME_URL } from "@/lib/platform-navigation";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";

type CreateProjectValues = {
    name: string;
    content?: string;
};

export function PlatformProjectOnboarding() {
    const { t } = useI18n();
    const { message } = App.useApp();
    const [form] = Form.useForm<CreateProjectValues>();
    const [createOpen, setCreateOpen] = useState(false);
    const projects = useUserStore((state) => state.onboardingProjects);
    const loadStatus = useUserStore((state) => state.onboardingLoadStatus);
    const creating = useUserStore((state) => state.onboardingCreating);
    const selectingProjectId = useUserStore((state) => state.onboardingSelectingProjectId);
    const error = useUserStore((state) => state.onboardingError);
    const loadProjects = useUserStore((state) => state.loadOnboardingProjects);
    const createProject = useUserStore((state) => state.createOnboardingProject);
    const selectProject = useUserStore((state) => state.selectOnboardingProject);

    const select = async (projectId: string) => {
        try {
            await selectProject(projectId);
        } catch (selectionError) {
            message.error(selectionError instanceof Error ? selectionError.message : t("projectRequired.selectFailed"));
        }
    };

    const create = async (values: CreateProjectValues) => {
        try {
            const result = await createProject({ name: values.name.trim(), content: values.content?.trim() || null });
            setCreateOpen(false);
            form.resetFields();
            if (result.project) {
                await select(result.project.projectId);
            } else {
                message.success(t("projectRequired.createSuccess"));
            }
        } catch (creationError) {
            message.error(creationError instanceof Error ? creationError.message : t("projectRequired.createFailed"));
        }
    };

    const busy = creating || Boolean(selectingProjectId);

    return (
        <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12">
            <div className="mx-auto flex min-h-[calc(100dvh-6rem)] w-full max-w-3xl items-center justify-center">
                <Card className="w-full overflow-hidden" styles={{ body: { padding: 0 } }}>
                    <div className="border-b border-stone-200 bg-gradient-to-br from-indigo-50 via-white to-amber-50 px-6 py-8 dark:border-stone-800 dark:from-indigo-400/10 dark:via-stone-950 dark:to-amber-300/10 sm:px-10 sm:py-10">
                        <div className="flex items-start justify-between gap-5">
                            <div className="min-w-0">
                                <Tag color="blue" icon={<BriefcaseBusiness className="size-3" />}>
                                    {t("projectRequired.eyebrow")}
                                </Tag>
                                <Typography.Title level={2} className="!mb-2 !mt-4">
                                    {t("projectRequired.title")}
                                </Typography.Title>
                                <Typography.Paragraph type="secondary" className="!mb-0 max-w-2xl text-sm leading-6">
                                    {t("projectRequired.subtitle")}
                                </Typography.Paragraph>
                            </div>
                            <a href={PLATFORM_HOME_URL} className="shrink-0 text-sm text-stone-500 transition hover:text-stone-950 dark:hover:text-white">
                                {t("action.returnPlatformHome")}
                            </a>
                        </div>
                    </div>

                    <div className="px-6 py-6 sm:px-10 sm:py-8">
                        {error ? <Alert className="mb-5" type="error" showIcon message={error} /> : null}

                        <div className="mb-3 flex items-center justify-between gap-3">
                            <Typography.Title level={4} className="!mb-0">
                                {t("projectRequired.available")}
                            </Typography.Title>
                            <Button type="text" size="small" icon={<RefreshCw className={cn("size-4", loadStatus === "loading" && "animate-spin")} />} onClick={() => void loadProjects().catch(() => undefined)} disabled={busy}>
                                {t("projectRequired.refresh")}
                            </Button>
                        </div>

                        {loadStatus === "loading" && !projects.length ? (
                            <div className="grid min-h-40 place-items-center">
                                <Spin tip={t("projectRequired.initializing")} />
                            </div>
                        ) : projects.length ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {projects.map((project) => {
                                    const selecting = selectingProjectId === project.projectId;
                                    return (
                                        <Card key={project.projectId} size="small" className="h-full" styles={{ body: { height: "100%", padding: 16 } }}>
                                            <div className="flex h-full flex-col">
                                                <div className="flex items-start gap-3">
                                                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
                                                        <BriefcaseBusiness className="size-5" />
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate font-medium">{project.name}</div>
                                                        <div className="mt-1 truncate text-xs text-stone-500">{project.projectId}</div>
                                                    </div>
                                                </div>
                                                <div className="mt-4 flex flex-1 items-end justify-between gap-3">
                                                    <span className="text-xs text-stone-500">{t("user.points", { points: project.points ?? "--" })}</span>
                                                    <Button type="primary" size="small" icon={selecting ? <Spin size="small" /> : <ArrowRight className="size-3.5" />} disabled={busy} onClick={() => void select(project.projectId)}>
                                                        {selecting ? t("projectRequired.entering") : t("projectRequired.enter")}
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    );
                                })}
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loadStatus === "error" ? t("projectRequired.listFailed") : t("projectRequired.empty")} />
                        )}

                        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-dashed border-stone-300 p-4 dark:border-stone-700 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="font-medium">{t("projectRequired.createTitle")}</div>
                                <div className="mt-1 text-sm text-stone-500">{t("projectRequired.createHint")}</div>
                            </div>
                            <Button icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)} disabled={busy}>
                                {t("projectRequired.create")}
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>

            <Modal title={t("projectRequired.create")} open={createOpen} confirmLoading={creating} okText={t("projectRequired.createAction")} cancelText={t("common.cancel")} onOk={() => form.submit()} onCancel={() => setCreateOpen(false)} destroyOnHidden>
                <Form<CreateProjectValues> form={form} layout="vertical" requiredMark={false} onFinish={create}>
                    <Form.Item name="name" label={t("platformProject.name")} rules={[{ required: true, whitespace: true, message: t("platformProject.nameRequired") }]}>
                        <Input autoFocus placeholder={t("platformProject.namePlaceholder")} />
                    </Form.Item>
                    <Form.Item name="content" label={t("platformProject.description")}>
                        <Input.TextArea rows={3} placeholder={t("platformProject.descriptionPlaceholder")} />
                    </Form.Item>
                    <Typography.Text type="secondary" className="text-xs">
                        {t("projectRequired.createContract")}
                    </Typography.Text>
                </Form>
            </Modal>
        </main>
    );
}
