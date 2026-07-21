export const CANVAS_LIBRARY_TYPES = ["all", "canvas", "folder"] as const;
export type CanvasLibraryType = (typeof CANVAS_LIBRARY_TYPES)[number];

export const LIBRARY_VIEW_QUERY_ALLOWLIST = ["folder", "q", "type"] as const;
export const PROJECT_HANDOFF_QUERY_ALLOWLIST = ["mode", "agentUrl", "agentToken"] as const;
export const CANVAS_AGENT_MODES = ["new", "recent", "choose"] as const;

export type CanvasLibraryRouteState = {
    folder: string | null;
    q: string;
    type: CanvasLibraryType;
};

export function isCanvasAgentMode(value: string | null): value is (typeof CANVAS_AGENT_MODES)[number] {
    return CANVAS_AGENT_MODES.includes(value as (typeof CANVAS_AGENT_MODES)[number]);
}

export function parseCanvasLibraryRoute(search: URLSearchParams | string): CanvasLibraryRouteState {
    const params = typeof search === "string" ? new URLSearchParams(search) : search;
    const rawType = params.get("type");
    return {
        folder: cleanParam(params.get("folder")),
        q: params.get("q")?.trim() || "",
        type: CANVAS_LIBRARY_TYPES.includes(rawType as CanvasLibraryType) ? (rawType as CanvasLibraryType) : "all",
    };
}

export function buildCanvasLibrarySearch(state: Partial<CanvasLibraryRouteState>) {
    const params = new URLSearchParams();
    const folder = cleanParam(state.folder);
    const q = state.q?.trim();
    if (folder) params.set("folder", folder);
    if (q) params.set("q", q);
    if (state.type && state.type !== "all") params.set("type", state.type);
    return params;
}

export function buildProjectHandoffSearch(search: URLSearchParams | string) {
    const source = typeof search === "string" ? new URLSearchParams(search) : search;
    const mode = source.get("mode");
    const result = new URLSearchParams();
    if (!isCanvasAgentMode(mode)) return result;
    result.set("mode", mode);
    for (const key of ["agentUrl", "agentToken"] as const) {
        const value = cleanParam(source.get(key));
        if (value) result.set(key, value);
    }
    return result;
}

export function buildCanvasProjectUrl(projectId: string, search: URLSearchParams | string) {
    const handoff = buildProjectHandoffSearch(search).toString();
    return `/canvas/${encodeURIComponent(projectId)}${handoff ? `?${handoff}` : ""}`;
}

function cleanParam(value: string | null | undefined) {
    const cleaned = value?.trim();
    return cleaned || null;
}
