import { describe, expect, test } from "bun:test";

import { extractPromptImages } from "@/services/api/prompts";

describe("prompt image extraction", () => {
    test("extracts Markdown and HTML images while resolving relative repository paths", () => {
        const baseUrl = "https://raw.githubusercontent.com/example/prompts/main";
        const markdown = `
![Markdown](https://images.example.com/markdown.jpg)
<img width="500" alt="attachment" src="https://github.com/user-attachments/assets/example" />
<img src='assets/example.png' alt='relative' />
`;

        expect(extractPromptImages(baseUrl, markdown)).toEqual(["https://images.example.com/markdown.jpg", "https://github.com/user-attachments/assets/example", "https://raw.githubusercontent.com/example/prompts/main/assets/example.png"]);
    });

    test("deduplicates images shared by Markdown and HTML markup", () => {
        const image = "https://images.example.com/shared.png";
        expect(extractPromptImages("https://example.com", `![same](${image})\n<img src="${image}" />`)).toEqual([image]);
    });
});
