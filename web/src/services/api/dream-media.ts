export const DREAM_MEDIA_PROXY_PATH = "/__dream_media_proxy";
export const DREAM_API_PROXY_PATH = "/__dream_api_proxy";

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

export function isDreamMediaProxyTarget(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname.toLowerCase().endsWith(".volces.com");
    } catch {
        return false;
    }
}

export function dreamMediaProxyUrl(value: string, enabled: boolean) {
    return enabled && isDreamMediaProxyTarget(value) ? `${DREAM_MEDIA_PROXY_PATH}?url=${encodeURIComponent(value)}` : value;
}
