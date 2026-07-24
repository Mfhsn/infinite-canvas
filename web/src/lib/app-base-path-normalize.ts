export function normalizeAppBasePath(value: string | undefined | null): string {
    const raw = value?.trim() || "/";
    if (!raw.startsWith("/") || raw.includes("?") || raw.includes("#") || raw.includes("\\")) {
        throw new Error("VITE_APP_BASE_PATH must be an absolute URL path");
    }
    const segments = raw.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) {
        throw new Error("VITE_APP_BASE_PATH cannot contain relative path segments");
    }
    return segments.length ? `/${segments.join("/")}/` : "/";
}

export function appRouterBasename(basePath: string): string {
    const normalized = normalizeAppBasePath(basePath);
    return normalized === "/" ? "/" : normalized.slice(0, -1);
}

export function joinAppBasePath(pathname: string, basePath: string): string {
    const normalizedBase = normalizeAppBasePath(basePath);
    const relative = pathname.replace(/^\/+/, "");
    return relative ? `${normalizedBase}${relative}` : normalizedBase;
}
