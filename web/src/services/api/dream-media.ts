import { appPath } from "@/lib/app-base-path";
import { DREAM_API_PROXY_ROOT, DREAM_MEDIA_PROXY_ROOT, isDreamMediaProxyTarget } from "@/services/api/dream-media-shared";

export const DREAM_MEDIA_PROXY_PATH = appPath(DREAM_MEDIA_PROXY_ROOT);
export const DREAM_API_PROXY_PATH = appPath(DREAM_API_PROXY_ROOT);

export function dreamApiProxyUrl(value: string, baseUrl: string, enabled: boolean) {
    if (!enabled) return value;
    try {
        const url = new URL(value);
        if (url.origin !== new URL(baseUrl).origin) return value;
        return `${DREAM_API_PROXY_PATH}${url.pathname}${url.search}`;
    } catch {
        return value;
    }
}

export { isDreamMediaProxyTarget };

export function dreamMediaProxyUrl(value: string, enabled: boolean) {
    return enabled && isDreamMediaProxyTarget(value) ? `${DREAM_MEDIA_PROXY_PATH}?url=${encodeURIComponent(value)}` : value;
}
