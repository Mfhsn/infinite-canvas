import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const webDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const projectDir = resolve(webDir, "..");
const modeArgumentIndex = process.argv.indexOf("--mode");
const mode = modeArgumentIndex >= 0 ? process.argv[modeArgumentIndex + 1] || "development" : "development";
const fileEnv = loadEnv(mode, projectDir, "");
const runtimeEnv = { ...fileEnv, ...process.env };
const nodeMajor = Number(process.versions.node.split(".")[0]);
const useEnvProxy = nodeMajor >= 24 && Boolean(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY);
const storageTarget = runtimeEnv.STORAGE_API_URL || `http://127.0.0.1:${runtimeEnv.STORAGE_API_PORT || "3001"}`;
const storageProcess = shouldStartLocalStorage(runtimeEnv.DATA_STORAGE_DRIVER, storageTarget)
    ? spawn(npmCommand(), ["run", "start"], {
          cwd: resolve(projectDir, "storage-server"),
          env: runtimeEnv,
          stdio: "inherit",
      })
    : null;

if (storageProcess) console.log(`[dev] Starting local Storage API at ${storageTarget}`);

const child = spawn(process.execPath, [...(useEnvProxy ? ["--use-env-proxy"] : []), viteCli, ...process.argv.slice(2)], {
    env: runtimeEnv,
    stdio: "inherit",
});

const stopChildren = () => {
    if (!child.killed) child.kill("SIGTERM");
    if (storageProcess && !storageProcess.killed) storageProcess.kill("SIGTERM");
};
process.once("SIGINT", stopChildren);
process.once("SIGTERM", stopChildren);

const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
if (storageProcess && !storageProcess.killed) storageProcess.kill("SIGTERM");
process.exitCode = exitCode;

function shouldStartLocalStorage(driver, target) {
    if (driver !== "mysql") return false;
    try {
        const hostname = new URL(target).hostname;
        return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
    } catch {
        return false;
    }
}

function npmCommand() {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}
