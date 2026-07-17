import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const nodeMajor = Number(process.versions.node.split(".")[0]);
const useEnvProxy = nodeMajor >= 24 && Boolean(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY);
const child = spawn(process.execPath, [...(useEnvProxy ? ["--use-env-proxy"] : []), viteCli, ...process.argv.slice(2)], {
    env: process.env,
    stdio: "inherit",
});

const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
process.exitCode = exitCode;
