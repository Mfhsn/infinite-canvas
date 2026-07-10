import { create } from "zustand";
import { persist } from "zustand/middleware";

import { languageOptions, type AppLanguage } from "@/i18n/messages";

type LanguageStore = {
    language: AppLanguage;
    setLanguage: (language: AppLanguage) => void;
    toggleLanguage: () => void;
};

function normalizeLanguage(value: unknown): AppLanguage {
    return languageOptions.some((item) => item.value === value) ? (value as AppLanguage) : "zh-CN";
}

export const useLanguageStore = create<LanguageStore>()(
    persist(
        (set, get) => ({
            language: "zh-CN",
            setLanguage: (language) => set({ language: normalizeLanguage(language) }),
            toggleLanguage: () => set({ language: get().language === "zh-CN" ? "en-US" : "zh-CN" }),
        }),
        {
            name: "infinite-canvas:language_store",
            merge: (persisted, current) => ({ ...current, language: normalizeLanguage((persisted as Partial<LanguageStore> | undefined)?.language) }),
        },
    ),
);
