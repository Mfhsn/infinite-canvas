import axios from "axios";

import { ENV_AI_LLM_PLATFORM_CODE, ENV_AI_LLM_URL } from "@/constant/env";
import { AppError, requestError } from "@/lib/app-error";
import { DREAM_API_PROXY_PATH } from "@/services/api/dream-media";
import { hasPlatformSessionBinding, platformSessionBindingHeaders } from "@/services/platform-session";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import type { ResponseFunctionTool, ResponseInputMessage, ResponseToolCall, ToolChoice, ToolResponseResult } from "@/services/api/image";

type RequestOptions = { signal?: AbortSignal; tools?: ResponseFunctionTool[]; toolChoice?: ToolChoice };
type DreamLlmMessage = { role: "system" | "user" | "assistant"; content: unknown };
type DreamLlmEnvelope = {
    code?: number;
    message?: string;
    msg?: string;
    data?: { content?: string } | null;
};

export async function requestDreamLlmChat(config: AiConfig, messages: ResponseInputMessage[], options?: RequestOptions) {
    const apiKey = config.apiKey.trim();
    if (!hasPlatformSessionBinding() && !apiKey) throw new AppError("error.dream.authRequired");
    const response = await axios.post<DreamLlmEnvelope>(
        dreamLlmApiUrl(),
        {
            project_id: 0,
            platform_code: ENV_AI_LLM_PLATFORM_CODE,
            model_code: modelOptionName(config.model || config.textModel),
            messages: toDreamLlmMessages(messages),
            ...dreamLlmToolOptions(options?.tools || [], options?.toolChoice || "auto"),
        },
        {
            headers: {
                ...(hasPlatformSessionBinding() ? platformSessionBindingHeaders() : { Authorization: `Bearer ${apiKey}` }),
                "Content-Type": "application/json",
            },
            signal: options?.signal,
        },
    );
    if (typeof response.data.code === "number" && response.data.code !== 0) {
        const rawMessage = response.data.message || response.data.msg;
        throw rawMessage ? new AppError("error.requestFailed", undefined, { rawMessage }) : requestError(undefined, "error.requestFailed");
    }
    return parseDreamLlmContent(response.data.data?.content || "");
}

export function dreamLlmApiUrl(endpoint = ENV_AI_LLM_URL, proxyEnabled = typeof window !== "undefined") {
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new AppError("error.config.baseUrlRequired");
    }
    if (url.protocol !== "https:") throw new AppError("error.config.baseUrlRequired");
    return proxyEnabled ? `${DREAM_API_PROXY_PATH}${url.pathname}${url.search}` : url.toString();
}

function toDreamLlmMessages(messages: ResponseInputMessage[]): DreamLlmMessage[] {
    return messages.map((message): DreamLlmMessage => {
        if ("type" in message) {
            return {
                role: "assistant",
                content: `<|FunctionCallBegin|>${JSON.stringify([{ name: message.name, parameters: jsonValue(message.arguments) }])}<|FunctionCallEnd|>`,
            };
        }
        if (message.role === "tool") {
            return {
                role: "user",
                content: JSON.stringify({ tool_result: { tool_call_id: message.tool_call_id, content: message.content } }),
            };
        }
        return { role: message.role, content: message.content };
    });
}

function dreamLlmToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    return {
        extra_params: {
            tools,
            tool_choice: typeof toolChoice === "object" ? { type: "function", function: { name: toolChoice.name } } : toolChoice,
            parallel_tool_calls: false,
        },
    };
}

export function parseDreamLlmContent(value: string): ToolResponseResult {
    const marker = /<\|FunctionCallBegin\|>([\s\S]*?)<\|FunctionCallEnd\|>/gi;
    const toolCalls: ResponseToolCall[] = [];
    const contentParts: string[] = [];
    let cursor = 0;
    for (const match of value.matchAll(marker)) {
        const index = match.index || 0;
        contentParts.push(value.slice(cursor, index));
        const parsed = dreamToolCalls(match[1] || "");
        if (parsed.length) toolCalls.push(...parsed);
        else contentParts.push(match[0]);
        cursor = index + match[0].length;
    }
    contentParts.push(value.slice(cursor));
    return { content: contentParts.join("").trim(), toolCalls };
}

function dreamToolCalls(value: string): ResponseToolCall[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value.trim());
    } catch {
        return [];
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.flatMap((item): ResponseToolCall[] => {
        if (!isRecord(item)) return [];
        const fn = isRecord(item.function) ? item.function : item;
        const name = stringValue(fn.name);
        if (!name) return [];
        const rawArguments = fn.arguments ?? fn.parameters ?? item.arguments ?? item.parameters ?? {};
        return [
            {
                id: stringValue(item.id) || stringValue(item.call_id) || nanoid(),
                type: "function",
                function: {
                    name,
                    arguments: typeof rawArguments === "string" ? normalizeJsonArguments(rawArguments) : JSON.stringify(rawArguments ?? {}),
                },
            },
        ];
    });
}

function normalizeJsonArguments(value: string) {
    const parsed = jsonValue(value);
    return typeof parsed === "string" ? JSON.stringify({ value: parsed }) : JSON.stringify(parsed ?? {});
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}
