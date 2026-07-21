import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";

import { resolveImageUrl } from "@/services/image-storage";
import { useI18n } from "@/i18n/use-i18n";

export function CanvasProjectCover({ storageKey, title }: { storageKey?: string; title: string }) {
    const { t } = useI18n();
    const [url, setUrl] = useState("");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        setFailed(false);
        setUrl("");
        if (storageKey)
            void resolveImageUrl(storageKey)
                .then((value) => active && setUrl(value))
                .catch(() => active && setFailed(true));
        return () => {
            active = false;
        };
    }, [storageKey]);

    return (
        <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-stone-100 via-stone-50 to-amber-50 dark:from-stone-900 dark:via-stone-850 dark:to-stone-800">
            {url && !failed ? (
                <img src={url} alt={t("canvas.coverAlt", { title })} className="size-full object-cover" loading="lazy" onError={() => setFailed(true)} />
            ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 text-stone-400" role="img" aria-label={t("canvas.coverPlaceholder", { title })}>
                    <ImageIcon className="size-7" aria-hidden />
                    <span className="text-xs">{t("canvas.noCover")}</span>
                </div>
            )}
        </div>
    );
}
