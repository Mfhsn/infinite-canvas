import { appRouterBasename, joinAppBasePath, normalizeAppBasePath } from "@/lib/app-base-path-normalize";

export const APP_BASE_PATH = normalizeAppBasePath(import.meta.env.BASE_URL);
export const APP_ROUTER_BASENAME = appRouterBasename(APP_BASE_PATH);

export function appPath(pathname: string) {
    return joinAppBasePath(pathname, APP_BASE_PATH);
}

export const publicAssetPath = appPath;
