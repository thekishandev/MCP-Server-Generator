/**
 * Gemini CLI Integration
 *
 * Generates gemini-cli compatible configuration for generated MCP servers:
 * 1. settings.json snippet with mcpServers config
 * 2. gemini-extension.json manifest for packaging as a gemini-cli extension
 * 3. GEMINI.md context file with tool documentation for the model
 *
 * Supports two integration modes:
 * - "config" mode: outputs a settings.json mcpServers block to paste into existing config
 * - "extension" mode: creates a full gemini-cli extension directory
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { resolve, relative, basename } from "path";
import type { GeneratedTool, ServerConfig } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface GeminiIntegrationOptions {
    /** Absolute path to the generated MCP server directory */
    serverDir: string;
    /** Server config from generation */
    serverConfig: ServerConfig;
    /** Generated tools for documentation */
    tools: GeneratedTool[];
    /** Integration mode */
    mode: "config" | "extension";
    /** Target directory for the extension (extension mode only) */
    extensionDir?: string;
    /** Whether to use tsx dev mode or built JS */
    useDev?: boolean;
}

export interface GeminiSettingsSnippet {
    mcpServers: Record<string, McpServerConfig>;
}

interface McpServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

// ─── Main Integration Class ──────────────────────────────────────────

export class GeminiCLIIntegration {
    /**
     * Generate gemini-cli settings.json snippet for the MCP server.
     */
    generateSettingsSnippet(options: GeminiIntegrationOptions): GeminiSettingsSnippet {
        const serverDir = options.serverDir;
        const config = options.serverConfig;

        const mcpConfig: McpServerConfig = options.useDev
            ? {
                command: "npx",
                args: ["tsx", resolve(serverDir, "src/server.ts")],
                env: {
                    RC_URL: config.rcUrl ?? "http://localhost:3000",
                    RC_USER: "${RC_USER}",
                    RC_PASSWORD: "${RC_PASSWORD}",
                },
            }
            : {
                command: "node",
                args: [resolve(serverDir, "dist/server.js")],
                env: {
                    RC_URL: config.rcUrl ?? "http://localhost:3000",
                    RC_USER: "${RC_USER}",
                    RC_PASSWORD: "${RC_PASSWORD}",
                },
            };

        return {
            mcpServers: {
                [config.name]: mcpConfig,
            },
        };
    }

    /**
     * Generate the gemini-extension.json manifest.
     */
    generateExtensionManifest(options: GeminiIntegrationOptions): Record<string, unknown> {
        const config = options.serverConfig;

        return {
            name: config.name,
            version: "1.0.0",
            description: config.description,
            mcpServers: {
                [config.name]: {
                    command: "node",
                    args: ["./dist/server.js"],
                    env: {
                        RC_URL: "${RC_URL}",
                        RC_USER: "${RC_USER}",
                        RC_PASSWORD: "${RC_PASSWORD}",
                    },
                },
            },
        };
    }

    /**
     * Generate a GEMINI.md context file documenting the available MCP tools.
     * This gives gemini-cli model awareness of the Rocket.Chat capabilities.
     */
    generateGeminiMd(options: GeminiIntegrationOptions): string {
        const config = options.serverConfig;
        const tools = options.tools;

        const lines: string[] = [];

        lines.push(`# ${config.name} — Rocket.Chat MCP Tools`);
        lines.push("");
        lines.push(`> ${config.description}`);
        lines.push("");
        lines.push(
            "This project has a connected Rocket.Chat MCP server providing the following tools."
        );
        lines.push(
            "Use these tools to interact with the Rocket.Chat workspace."
        );
        lines.push("");

        lines.push("## Available Tools");
        lines.push("");

        for (const tool of tools) {
            lines.push(`### \`${tool.toolName}\``);
            lines.push("");
            lines.push(`**${tool.description}**`);
            lines.push("");
            lines.push(`- **Method:** \`${tool.endpoint.method.toUpperCase()}\``);
            lines.push(`- **Endpoint:** \`${tool.endpoint.path}\``);

            if (tool.endpoint.requiresAuth) {
                lines.push("- **Auth:** Required (handled automatically)");
            }

            // Document parameters
            const params = tool.endpoint.parameters.filter(
                (p) =>
                    p.in !== "header" ||
                    (!p.name.toLowerCase().includes("auth") &&
                        !p.name.toLowerCase().includes("token") &&
                        p.name !== "X-User-Id")
            );

            const bodyProps = tool.endpoint.requestBody?.schema.properties;

            if (params.length > 0 || bodyProps) {
                lines.push("- **Parameters:**");

                for (const p of params) {
                    const req = p.required ? "required" : "optional";
                    lines.push(
                        `  - \`${p.name}\` (${p.schema.type}, ${req}): ${p.description || "No description"}`
                    );
                }

                if (bodyProps) {
                    const requiredFields =
                        tool.endpoint.requestBody?.schema.required ?? [];
                    for (const [name, prop] of Object.entries(bodyProps)) {
                        const req = requiredFields.includes(name)
                            ? "required"
                            : "optional";
                        lines.push(
                            `  - \`${name}\` (${prop.type}, ${req}): ${prop.description || "No description"}`
                        );
                    }
                }
            }

            lines.push("");
        }

        // Usage guidance for the model
        lines.push("## Usage Guidelines");
        lines.push("");
        lines.push(
            "- Authentication is handled automatically. Do not pass auth headers."
        );
        lines.push(
            "- When sending messages, use the `chat_postMessage` tool with the channel name or ID."
        );
        lines.push(
            "- Channel names should be passed without the `#` prefix."
        );
        lines.push(
            "- The `login` tool is called automatically during server startup — you do not need to call it."
        );
        lines.push("");

        return lines.join("\n");
    }

    /**
     * Create a full gemini-cli extension directory.
     */
    createExtension(options: GeminiIntegrationOptions): string[] {
        const extDir =
            options.extensionDir ??
            resolve(options.serverDir, ".gemini-extension");

        mkdirSync(extDir, { recursive: true });

        const createdFiles: string[] = [];

        // 1. gemini-extension.json
        const manifest = this.generateExtensionManifest(options);
        const manifestPath = resolve(extDir, "gemini-extension.json");
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
        createdFiles.push("gemini-extension.json");

        // 2. GEMINI.md
        const geminiMd = this.generateGeminiMd(options);
        const geminiMdPath = resolve(extDir, "GEMINI.md");
        writeFileSync(geminiMdPath, geminiMd, "utf-8");
        createdFiles.push("GEMINI.md");

        return createdFiles;
    }

    /**
     * Write settings.json snippet to a file.
     */
    writeSettingsSnippet(
        snippet: GeminiSettingsSnippet,
        outputPath: string
    ): void {
        // If settings.json already exists, merge mcpServers
        let existing: Record<string, unknown> = {};
        if (existsSync(outputPath)) {
            try {
                existing = JSON.parse(readFileSync(outputPath, "utf-8"));
            } catch {
                // If file can't be parsed, start fresh
            }
        }

        const merged = {
            ...existing,
            mcpServers: {
                ...((existing.mcpServers as Record<string, unknown>) ?? {}),
                ...snippet.mcpServers,
            },
        };

        writeFileSync(outputPath, JSON.stringify(merged, null, 2), "utf-8");
    }
}
