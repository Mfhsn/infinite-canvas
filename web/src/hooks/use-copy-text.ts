import { App } from "antd";
import copy from "copy-to-clipboard";
import { useI18n } from "@/i18n/use-i18n";

export function useCopyText() {
    const { message } = App.useApp();
    const { t } = useI18n();

    return (value: string, successText = t("common.copied")) => {
        copy(value);
        message.success(successText);
    };
}
