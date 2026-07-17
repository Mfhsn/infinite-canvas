import { describe, expect, test } from "bun:test";

import { dreamProxyConnectOptions, dreamTlsRequestOptions, envFlag, envMilliseconds } from "../vite.config";

describe("Dream development proxy TLS options", () => {
    test("can disable SNI while retaining the configured certificate identity", () => {
        const options = dreamTlsRequestOptions("prod-cn.just4fun.sg", true);
        expect(options.servername).toBe("");
        expect(options.checkServerIdentity).toBeFunction();
    });

    test("uses the configured name as SNI when no-SNI mode is disabled", () => {
        expect(dreamTlsRequestOptions("prod-cn.just4fun.sg", false).servername).toBe("prod-cn.just4fun.sg");
    });

    test("parses the environment flag explicitly", () => {
        expect(envFlag("true")).toBe(true);
        expect(envFlag("1")).toBe(true);
        expect(envFlag("false")).toBe(false);
        expect(envFlag("")).toBe(false);
    });

    test("uses positive environment timeouts and rejects invalid values", () => {
        expect(envMilliseconds("180000", 30_000)).toBe(180_000);
        expect(envMilliseconds("0", 30_000)).toBe(30_000);
        expect(envMilliseconds("not-a-number", 30_000)).toBe(30_000);
    });

    test("bypasses Node's global environment proxy for the proxy CONNECT request", () => {
        const options = dreamProxyConnectOptions(new URL("http://127.0.0.1:7890"), "106.75.147.147", 443, { Host: "106.75.147.147:443" });
        expect(options.agent).toBe(false);
        expect(options.path).toBe("106.75.147.147:443");
    });
});
