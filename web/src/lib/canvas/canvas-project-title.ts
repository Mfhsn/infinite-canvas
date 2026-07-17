import type { I18nTranslator } from "@/i18n/messages";

export function canvasProjectTitle(title: string | undefined, t: I18nTranslator) {
    if (!title || title === "未命名画布") return t("common.untitled");
    if (title === "导入画布") return t("canvas.importedTitle");
    return title;
}
