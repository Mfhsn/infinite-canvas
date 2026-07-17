import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = join(root, "src");
const messagesFile = join(sourceRoot, "i18n/messages.ts");
const han = /[\u3400-\u9fff]/u;
const visibleAttributeNames = new Set(["alt", "aria-label", "label", "okText", "cancelText", "placeholder", "title"]);
const visiblePropertyNames = new Set(["alt", "ariaLabel", "cancelText", "description", "emptyText", "label", "message", "okText", "placeholder", "text", "title"]);
const visibleCallNames = new Set(["Error", "message.error", "message.info", "message.success", "message.warning", "modal.confirm", "modal.error", "modal.info", "modal.success", "modal.warning"]);

// These are protocol/source-data literals, not product chrome. Keep every exemption
// narrow and documented so new UI cannot hide behind a whole-file exclusion.
const reviewedAllowlist = [
    {
        file: "components/canvas/canvas-assistant-panel.tsx",
        start: "const ONLINE_AGENT_PROMPT",
        end: "type OnlineAgentTab",
        reason: "Online Agent system prompt and tool schemas are behavior-sensitive protocol text.",
    },
    {
        file: "components/canvas/canvas-assistant-panel.tsx",
        start: "const executeOnlineTool",
        end: "const approveOnlineTool",
        reason: "Tool result messages remain protocol-stable; localized displayMessage values drive the UI.",
    },
    {
        file: "components/canvas/canvas-assistant-panel.tsx",
        start: "async function buildToolAgentMessages",
        end: "function compactSnapshot",
        reason: "This behavior-sensitive context is sent to the model and is never rendered as product UI.",
    },
    {
        file: "components/canvas/canvas-assistant-panel.tsx",
        start: "function parseToolArguments",
        end: "async function buildToolAgentMessages",
        reason: "Tool validation and no-op reasons are protocol results; localized displayMessage values drive the UI.",
    },
    {
        file: "lib/agent/agent-site-tools.ts",
        start: "export async function runSiteTool",
        end: "function paginate",
        reason: "Site-tool errors and notes are returned to the model as protocol data, not rendered as product chrome.",
    },
];

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(fullPath);
        return [".ts", ".tsx"].includes(extname(entry.name)) ? [fullPath] : [];
    });
}

function catalogKeys(name) {
    const source = ts.createSourceFile(messagesFile, readFileSync(messagesFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let keys;
    source.forEachChild((node) => {
        if (!ts.isVariableStatement(node)) return;
        for (const declaration of node.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
            let initializer = declaration.initializer;
            while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer)) initializer = initializer.expression;
            if (!ts.isObjectLiteralExpression(initializer)) continue;
            keys = initializer.properties.flatMap((property) => {
                if (!ts.isPropertyAssignment(property)) return [];
                const key = property.name;
                return ts.isStringLiteral(key) || ts.isIdentifier(key) ? [key.text] : [];
            });
        }
    });
    if (!keys) throw new Error(`Unable to read ${name} catalog from ${relative(root, messagesFile)}`);
    return keys;
}

function propertyName(node) {
    if (!node) return "";
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
    return "";
}

function callName(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return `${callName(expression.expression)}.${expression.name.text}`;
    return "";
}

function literalText(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("");
    return "";
}

function isReviewed(file, source, node) {
    const repoFile = relative(sourceRoot, file).replaceAll("\\", "/");
    return reviewedAllowlist.some((entry) => {
        if (entry.file !== repoFile) return false;
        const start = source.text.indexOf(entry.start);
        const end = source.text.indexOf(entry.end, start + entry.start.length);
        return start >= 0 && end > start && node.getStart(source) >= start && node.getEnd() <= end;
    });
}

function visibleLiteralKind(node) {
    const parent = node.parent;
    if (ts.isJsxText(node)) return "JSX text";
    if (!parent) return "";
    if (ts.isJsxAttribute(parent) && visibleAttributeNames.has(parent.name.text)) return `JSX ${parent.name.text}`;
    if (ts.isPropertyAssignment(parent) && visiblePropertyNames.has(propertyName(parent.name))) return `property ${propertyName(parent.name)}`;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node)) {
        const name = callName(parent.expression);
        if (visibleCallNames.has(name)) return `call ${name}`;
    }
    return "";
}

function scanVisibleHan(file) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const issues = [];
    function visit(node) {
        const text = ts.isJsxText(node) ? node.text.trim() : literalText(node);
        const kind = visibleLiteralKind(node);
        if (kind && text && han.test(text) && !isReviewed(file, source, node)) {
            const position = source.getLineAndCharacterOfPosition(node.getStart(source));
            issues.push({ file: relative(sourceRoot, file).replaceAll("\\", "/"), line: position.line + 1, kind, text: text.replaceAll(/\s+/g, " ").slice(0, 100) });
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return issues;
}

const zh = catalogKeys("zh");
const en = catalogKeys("en");
const missingEnglish = zh.filter((key) => !en.includes(key));
const extraEnglish = en.filter((key) => !zh.includes(key));
const duplicateChinese = zh.filter((key, index) => zh.indexOf(key) !== index);
const duplicateEnglish = en.filter((key, index) => en.indexOf(key) !== index);
const visibleHan = sourceFiles(sourceRoot)
    .filter((file) => file !== messagesFile)
    .flatMap(scanVisibleHan);

if (missingEnglish.length || extraEnglish.length || duplicateChinese.length || duplicateEnglish.length || visibleHan.length) {
    if (missingEnglish.length) console.error(`Missing English keys:\n${missingEnglish.join("\n")}`);
    if (extraEnglish.length) console.error(`Extra English keys:\n${extraEnglish.join("\n")}`);
    if (duplicateChinese.length) console.error(`Duplicate Chinese keys:\n${duplicateChinese.join("\n")}`);
    if (duplicateEnglish.length) console.error(`Duplicate English keys:\n${duplicateEnglish.join("\n")}`);
    if (visibleHan.length) {
        console.error(`Raw Chinese found in user-facing contexts (${visibleHan.length}):`);
        for (const issue of visibleHan) console.error(`${issue.file}:${issue.line} [${issue.kind}] ${issue.text}`);
    }
    process.exitCode = 1;
} else {
    console.log(`i18n check passed: ${zh.length} keys per locale; no unreviewed Chinese in user-facing contexts.`);
}
