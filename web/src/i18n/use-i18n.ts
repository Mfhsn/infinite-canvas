import { useCallback } from "react";

import { translate, type I18nKey, type I18nParams } from "@/i18n/messages";
import { useLanguageStore } from "@/stores/use-language-store";

export function useI18n() {
    const language = useLanguageStore((state) => state.language);
    const setLanguage = useLanguageStore((state) => state.setLanguage);
    const toggleLanguage = useLanguageStore((state) => state.toggleLanguage);
    const t = useCallback((key: I18nKey, params?: I18nParams) => translate(language, key, params), [language]);
    return {
        language,
        setLanguage,
        toggleLanguage,
        t,
    };
}
