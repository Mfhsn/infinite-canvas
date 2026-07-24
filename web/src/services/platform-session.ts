export const CANVAS_SESSION_BINDING_HEADER = "X-Canvas-Session-Binding";

const SESSION_BINDING_QUERY = "session_binding";
const SESSION_CHANGE_CHANNEL = "infinite-canvas:platform-session";
const SESSION_CHANGE_STORAGE_KEY = "infinite-canvas:platform-session-change";
const SESSION_CHANGE_SOURCE = `${Date.now()}:${Math.random()}`;

export type PlatformSessionChange = "login" | "exchange" | "logout";

let sessionBinding = "";

export function capturePlatformSessionBinding(response: Pick<Response, "headers">) {
    const value = response.headers.get(CANVAS_SESSION_BINDING_HEADER)?.trim();
    sessionBinding = value || "";
}

export function getPlatformSessionBinding() {
    return sessionBinding;
}

export function hasPlatformSessionBinding() {
    return Boolean(sessionBinding);
}

export function clearPlatformSessionBinding() {
    sessionBinding = "";
}

export function platformSessionBindingHeaders() {
    return sessionBinding ? { [CANVAS_SESSION_BINDING_HEADER]: sessionBinding } : {};
}

export function withPlatformSessionBinding(headers?: HeadersInit) {
    const result = new Headers(headers);
    if (sessionBinding) result.set(CANVAS_SESSION_BINDING_HEADER, sessionBinding);
    return result;
}

export function appendPlatformSessionBinding(value: string) {
    if (!sessionBinding) return value;
    const hashIndex = value.indexOf("#");
    const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
    const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}${SESSION_BINDING_QUERY}=${encodeURIComponent(sessionBinding)}${hash}`;
}

export function notifyPlatformSessionChange(change: PlatformSessionChange) {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify({ change, source: SESSION_CHANGE_SOURCE, nonce: `${Date.now()}:${Math.random()}` });
    if (typeof BroadcastChannel !== "undefined") {
        try {
            const channel = new BroadcastChannel(SESSION_CHANGE_CHANNEL);
            channel.postMessage(payload);
            channel.close();
            return;
        } catch {
            // Fall back to a transient storage event where BroadcastChannel is unavailable.
        }
    }
    try {
        window.localStorage.setItem(SESSION_CHANGE_STORAGE_KEY, payload);
        window.localStorage.removeItem(SESSION_CHANGE_STORAGE_KEY);
    } catch {
        // Session changes still remain protected by the server binding in restricted browsers.
    }
}

export function subscribeToPlatformSessionChanges(listener: (change: PlatformSessionChange) => void) {
    if (typeof window === "undefined") return () => undefined;
    if (typeof BroadcastChannel !== "undefined") {
        try {
            const channel = new BroadcastChannel(SESSION_CHANGE_CHANNEL);
            channel.addEventListener("message", (event) => dispatchSessionChange(event.data, listener));
            return () => channel.close();
        } catch {
            // Fall back to storage events below.
        }
    }
    const onStorage = (event: StorageEvent) => {
        if (event.key === SESSION_CHANGE_STORAGE_KEY && event.newValue) dispatchSessionChange(event.newValue, listener);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
}

function dispatchSessionChange(value: unknown, listener: (change: PlatformSessionChange) => void) {
    try {
        const parsed = typeof value === "string" ? (JSON.parse(value) as { change?: unknown; source?: unknown }) : (value as { change?: unknown; source?: unknown });
        if (parsed?.source === SESSION_CHANGE_SOURCE) return;
        if (parsed?.change === "login" || parsed?.change === "exchange" || parsed?.change === "logout") listener(parsed.change);
    } catch {
        // Ignore malformed cross-tab notifications.
    }
}
