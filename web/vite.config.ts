import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, resolve } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";
import { DREAM_API_PROXY_PATH, DREAM_MEDIA_PROXY_PATH, isDreamMediaProxyTarget } from "./src/services/api/dream-media";

const webDir = dirname(fileURLToPath(import.meta.url));
const envDir = resolve(webDir, "..");
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const MAX_DREAM_MEDIA_BYTES = 100 * 1024 * 1024;
const DEFAULT_DREAM_PROXY_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_DREAM_PROXY_CONNECT_TIMEOUT_MS = 30 * 1000;

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, envDir, "");
    const storageDriver = env.DATA_STORAGE_DRIVER === "mysql" ? "mysql" : "browser";
    const storageApiTarget = env.STORAGE_API_URL || `http://127.0.0.1:${env.STORAGE_API_PORT || "3001"}`;
    const storageProxy = storageDriver === "mysql" ? { "/api/storage": { target: storageApiTarget, changeOrigin: false } } : undefined;
    return {
        envDir,
        plugins: [
            react(),
            browserStorageConfigPlugin(storageDriver, env.STORAGE_NAMESPACE || "default"),
            dreamApiProxyPlugin(
                env.VITE_AI_BASE_URL,
                env.VITE_AI_TLS_SERVER_NAME,
                envFlag(env.VITE_AI_TLS_DISABLE_SNI),
                envMilliseconds(env.VITE_AI_PROXY_TIMEOUT_MS, DEFAULT_DREAM_PROXY_TIMEOUT_MS),
                envMilliseconds(env.VITE_AI_PROXY_CONNECT_TIMEOUT_MS, DEFAULT_DREAM_PROXY_CONNECT_TIMEOUT_MS),
            ),
            dreamMediaProxyPlugin(),
        ],
        resolve: {
            alias: {
                "@": resolve(webDir, "src"),
            },
        },
        define: {
            __APP_VERSION__: JSON.stringify(localVersion),
            __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
        },
        server: storageProxy ? { proxy: storageProxy } : undefined,
        preview: storageProxy ? { proxy: storageProxy } : undefined,
    };
});

function browserStorageConfigPlugin(driver: "browser" | "mysql", namespace: string): Plugin {
    const middleware: Connect.NextHandleFunction = (request, response, next) => {
        if (driver !== "browser") {
            next();
            return;
        }
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        if (pathname !== "/api/storage/config" && pathname !== "/api/storage/health") {
            next();
            return;
        }
        const body = JSON.stringify(pathname.endsWith("/health") ? { ok: true, driver, namespace } : { driver, namespace });
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Content-Length", String(Buffer.byteLength(body)));
        response.end(body);
    };
    return {
        name: "browser-storage-config",
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}

function dreamApiProxyPlugin(baseUrl: string | undefined, tlsServerName: string | undefined, disableSni: boolean, timeoutMs: number, connectTimeoutMs: number): Plugin {
    let upstream: URL | null = null;
    try {
        upstream = baseUrl?.trim() ? new URL(baseUrl) : null;
    } catch {
        upstream = null;
    }
    const serverName = tlsServerName?.trim() || (upstream && !/^\d+(?:\.\d+){3}$/.test(upstream.hostname) ? upstream.hostname : "");
    const tlsOptions = serverName ? dreamTlsRequestOptions(serverName, disableSni) : undefined;
    const createConnection = upstream && tlsOptions ? dreamApiProxyConnection(upstream.hostname, Number(upstream.port) || 443, tlsOptions, connectTimeoutMs) : undefined;
    const middleware: Connect.NextHandleFunction = (request, response, next) => {
        const requestUrl = new URL(request.url || "/", "http://localhost");
        if (!requestUrl.pathname.startsWith(`${DREAM_API_PROXY_PATH}/`)) {
            next();
            return;
        }
        if (!upstream || !serverName) {
            sendDreamApiProxyError(response, 503, "Dream API proxy is not configured");
            return;
        }
        const path = `${requestUrl.pathname.slice(DREAM_API_PROXY_PATH.length)}${requestUrl.search}`;
        const headers = { ...request.headers, host: serverName, connection: "close", "accept-encoding": "identity" };
        const proxyRequest = https.request(
            {
                hostname: upstream.hostname,
                port: upstream.port || 443,
                ...tlsOptions,
                method: request.method,
                path,
                headers,
                rejectUnauthorized: true,
                timeout: timeoutMs,
                ...(createConnection ? { createConnection } : {}),
            },
            (proxyResponse) => {
                response.statusCode = proxyResponse.statusCode || 502;
                for (const header of ["content-type", "content-length", "cache-control", "content-disposition"] as const) {
                    const value = proxyResponse.headers[header];
                    if (value !== undefined) response.setHeader(header, value);
                }
                proxyResponse.pipe(response);
            },
        );
        proxyRequest.on("timeout", () => proxyRequest.destroy(new Error("Dream API proxy timed out")));
        proxyRequest.on("error", (error) => sendDreamApiProxyError(response, 502, dreamProxyConnectionError(error)));
        request.pipe(proxyRequest);
    };
    return {
        name: "dream-api-proxy",
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}

type DreamTlsOptions = ReturnType<typeof dreamTlsRequestOptions>;

function dreamApiProxyConnection(hostname: string, port: number, tlsOptions: DreamTlsOptions, connectTimeoutMs: number) {
    const proxyValue = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
    if (!proxyValue) return undefined;
    let proxy: URL;
    try {
        proxy = new URL(proxyValue);
    } catch {
        return undefined;
    }
    return ((_options: unknown, callback: (error: Error | null, socket?: tls.TLSSocket) => void) => {
        const headers: Record<string, string> = { Host: `${hostname}:${port}` };
        if (proxy.username || proxy.password) headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
        const connectRequest = http.request(dreamProxyConnectOptions(proxy, hostname, port, headers));
        let settled = false;
        const finish = (error: Error | null, socket?: tls.TLSSocket) => {
            if (settled) return;
            settled = true;
            callback(error, socket);
        };
        connectRequest.once("connect", (connectResponse, socket, head) => {
            if (connectResponse.statusCode !== 200) {
                socket.destroy();
                finish(new Error(`Dream API proxy CONNECT failed (${connectResponse.statusCode || 502})`));
                return;
            }
            if (head.length) socket.unshift(head);
            const secureSocket = tls.connect({ socket, rejectUnauthorized: true, ...tlsOptions });
            secureSocket.once("secureConnect", () => finish(null, secureSocket));
            secureSocket.once("error", (error) => finish(error));
        });
        connectRequest.once("error", (error) => finish(error));
        connectRequest.setTimeout(connectTimeoutMs, () => connectRequest.destroy(new Error("Dream API proxy CONNECT timed out")));
        connectRequest.end();
        return undefined;
    }) as NonNullable<https.RequestOptions["createConnection"]>;
}

export function dreamProxyConnectOptions(proxy: URL, hostname: string, port: number, headers: Record<string, string>): http.RequestOptions {
    return {
        hostname: proxy.hostname,
        port: Number(proxy.port) || 80,
        method: "CONNECT",
        path: `${hostname}:${port}`,
        headers,
        // Node's --use-env-proxy replaces the global agent. The CONNECT request
        // already targets that proxy and must not be proxied a second time.
        agent: false,
    };
}

export function dreamTlsRequestOptions(serverName: string, disableSni: boolean) {
    return {
        servername: disableSni ? "" : serverName,
        checkServerIdentity: (_hostname: string, certificate: tls.PeerCertificate) => tls.checkServerIdentity(serverName, certificate),
    };
}

export function envFlag(value: string | undefined) {
    return value === "1" || value?.trim().toLowerCase() === "true";
}

export function envMilliseconds(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function dreamProxyConnectionError(error: Error & { code?: string }) {
    const reason = error.code || error.message;
    return reason ? `Dream API connection failed (${reason})` : "Dream API connection failed";
}

function sendDreamApiProxyError(response: Parameters<Connect.NextHandleFunction>[1], status: number, detail: string) {
    if (response.headersSent || response.writableEnded) return;
    const body = JSON.stringify({ detail });
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Length", String(Buffer.byteLength(body)));
    response.end(body);
}

function dreamMediaProxyPlugin(): Plugin {
    const middleware: Connect.NextHandleFunction = (request, response, next) => {
        const requestUrl = new URL(request.url || "/", "http://localhost");
        if (requestUrl.pathname !== DREAM_MEDIA_PROXY_PATH) {
            next();
            return;
        }
        if (request.method !== "GET") {
            response.statusCode = 405;
            response.setHeader("Allow", "GET");
            response.end("Method not allowed");
            return;
        }
        void proxyDreamMedia(requestUrl.searchParams.get("url") || "", response);
    };
    return {
        name: "dream-media-proxy",
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}

async function proxyDreamMedia(target: string, response: Parameters<Connect.NextHandleFunction>[1]) {
    if (!isDreamMediaProxyTarget(target)) {
        response.statusCode = 403;
        response.end("Dream media host is not allowed");
        return;
    }
    try {
        const upstream = await fetch(target, { headers: { Accept: "image/*,video/*,audio/*,*/*;q=0.8" }, redirect: "manual" });
        if (!upstream.ok) {
            response.statusCode = upstream.status;
            response.end("Dream media upstream request failed");
            return;
        }
        const declaredLength = Number(upstream.headers.get("content-length") || 0);
        if (declaredLength > MAX_DREAM_MEDIA_BYTES) {
            response.statusCode = 413;
            response.end("Dream media file is too large");
            return;
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        if (body.byteLength > MAX_DREAM_MEDIA_BYTES) {
            response.statusCode = 413;
            response.end("Dream media file is too large");
            return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
        response.setHeader("Content-Length", String(body.byteLength));
        response.setHeader("Cache-Control", "private, max-age=300");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(body);
    } catch {
        response.statusCode = 502;
        response.end("Dream media proxy request failed");
    }
}
