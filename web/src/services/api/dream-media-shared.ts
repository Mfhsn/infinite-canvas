export const DREAM_MEDIA_PROXY_ROOT = "/__dream_media_proxy";
export const DREAM_API_PROXY_ROOT = "/__dream_api_proxy";

export function isDreamMediaProxyTarget(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname.toLowerCase().endsWith(".volces.com");
    } catch {
        return false;
    }
}
