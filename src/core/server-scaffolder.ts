/**
 * Server Scaffolder
 *
 * Assembles all generated tools into a complete, runnable MCP server project.
 * Uses Handlebars templates to generate the server entry point, tool files,
 * authentication helper, HTTP client, package.json, and test stubs.
 */

import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import type { GeneratedTool, ServerConfig, GeneratedFile } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATES_DIR = resolve(__dirname, "../templates");

export class ServerScaffolder {
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor() {
    this.loadTemplates();
    this.registerHelpers();
  }

  /**
   * Generate a complete MCP server project from the given tools and config.
   *
   * @param tools - Generated MCP tool definitions
   * @param config - Server configuration (name, output dir, etc.)
   * @returns Array of generated files
   */
  scaffold(tools: GeneratedTool[], config: ServerConfig): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    // 1. Generate individual tool files
    for (const tool of tools) {
      files.push(this.generateToolFile(tool));
    }

    // 2. Generate the main server entry point
    files.push(this.generateServerFile(tools, config));

    // 3. Generate the RC HTTP client
    files.push(this.generateRcClientFile());

    // 4. Generate auth helper
    files.push(this.generateAuthFile());

    // 5. Generate package.json
    files.push(this.generatePackageJson(config));

    // 6. Generate tsconfig.json
    files.push(this.generateTsConfig());

    // 7. Generate .env.example
    files.push(this.generateEnvExample(config));

    // 8. Generate README
    files.push(this.generateReadme(tools, config));

    // 9. Generate test stubs
    for (const tool of tools) {
      files.push(this.generateTestFile(tool));
    }

    return files;
  }

  /**
   * Write all generated files to the output directory.
   */
  writeFiles(files: GeneratedFile[], outputDir: string): void {
    for (const file of files) {
      const fullPath = resolve(outputDir, file.relativePath);
      const dir = dirname(fullPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(fullPath, file.content, "utf-8");
    }
  }

  // ─── Template Loading ───────────────────────────────────────────────

  private loadTemplates(): void {
    const templateFiles = [
      "server.ts.hbs",
      "tool.ts.hbs",
      "auth.ts.hbs",
      "rc-client.ts.hbs",
      "package.json.hbs",
      "tsconfig.json.hbs",
      "env.example.hbs",
      "readme.md.hbs",
      "test.ts.hbs",
    ];

    for (const file of templateFiles) {
      const filePath = join(TEMPLATES_DIR, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        this.templates.set(file, Handlebars.compile(content));
      } catch {
        // Template not found — use inline fallback
        this.templates.set(
          file,
          Handlebars.compile(this.getInlineTemplate(file)),
        );
      }
    }
  }

  private registerHelpers(): void {
    Handlebars.registerHelper("json", (context: unknown) => {
      return new Handlebars.SafeString(JSON.stringify(context, null, 2));
    });

    Handlebars.registerHelper("uppercase", (str: string) => {
      return str?.toUpperCase() ?? "";
    });

    Handlebars.registerHelper("camelCase", (str: string) => {
      return str?.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) ?? "";
    });
  }

  // ─── File Generators ────────────────────────────────────────────────

  private generateToolFile(tool: GeneratedTool): GeneratedFile {
    const template = this.templates.get("tool.ts.hbs")!;
    return {
      relativePath: `src/tools/${tool.toolName}.ts`,
      content: template({
        toolName: tool.toolName,
        description: tool.description,
        zodSchemaCode: tool.zodSchemaCode,
        handlerCode: tool.handlerCode,
        endpoint: tool.endpoint,
      }),
    };
  }

  private generateServerFile(
    tools: GeneratedTool[],
    config: ServerConfig,
  ): GeneratedFile {
    const template = this.templates.get("server.ts.hbs")!;
    return {
      relativePath: "src/server.ts",
      content: template({
        serverName: config.name,
        serverDescription: config.description,
        tools: tools.map((t) => ({
          toolName: t.toolName,
          importName: `register_${t.toolName}`,
          fileName: t.toolName,
        })),
        requiresAuth: tools.some((t) => t.endpoint.requiresAuth),
      }),
    };
  }

  private generateRcClientFile(): GeneratedFile {
    const template = this.templates.get("rc-client.ts.hbs")!;
    return {
      relativePath: "src/rc-client.ts",
      content: template({}),
    };
  }

  private generateAuthFile(): GeneratedFile {
    const template = this.templates.get("auth.ts.hbs")!;
    return {
      relativePath: "src/auth.ts",
      content: template({}),
    };
  }

  private generatePackageJson(config: ServerConfig): GeneratedFile {
    const template = this.templates.get("package.json.hbs")!;
    return {
      relativePath: "package.json",
      content: template({
        name: config.name,
        description: config.description,
      }),
    };
  }

  private generateTsConfig(): GeneratedFile {
    const template = this.templates.get("tsconfig.json.hbs")!;
    return {
      relativePath: "tsconfig.json",
      content: template({}),
    };
  }

  private generateEnvExample(config: ServerConfig): GeneratedFile {
    const template = this.templates.get("env.example.hbs")!;
    return {
      relativePath: ".env.example",
      content: template({ rcUrl: config.rcUrl ?? "http://localhost:3000" }),
    };
  }

  private generateReadme(
    tools: GeneratedTool[],
    config: ServerConfig,
  ): GeneratedFile {
    const template = this.templates.get("readme.md.hbs")!;
    return {
      relativePath: "README.md",
      content: template({
        serverName: config.name,
        serverDescription: config.description,
        capabilities: config.capabilities,
        toolCount: tools.length,
        tools: tools.map((t) => ({
          name: t.toolName,
          description: t.description,
          method: t.endpoint.method.toUpperCase(),
          path: t.endpoint.path,
        })),
      }),
    };
  }

  private generateTestFile(tool: GeneratedTool): GeneratedFile {
    const template = this.templates.get("test.ts.hbs")!;
    return {
      relativePath: `tests/${tool.toolName}.test.ts`,
      content: template({
        toolName: tool.toolName,
        description: tool.description,
        endpoint: tool.endpoint,
      }),
    };
  }

  // ─── Inline Template Fallbacks ──────────────────────────────────────
  // Used when Handlebars template files haven't been created yet

  private getInlineTemplate(name: string): string {
    const templates: Record<string, string> = {
      "tool.ts.hbs": INLINE_TOOL_TEMPLATE,
      "server.ts.hbs": INLINE_SERVER_TEMPLATE,
      "rc-client.ts.hbs": INLINE_RC_CLIENT_TEMPLATE,
      "auth.ts.hbs": INLINE_AUTH_TEMPLATE,
      "package.json.hbs": INLINE_PACKAGE_JSON_TEMPLATE,
      "tsconfig.json.hbs": INLINE_TSCONFIG_TEMPLATE,
      "env.example.hbs": INLINE_ENV_TEMPLATE,
      "readme.md.hbs": INLINE_README_TEMPLATE,
      "test.ts.hbs": INLINE_TEST_TEMPLATE,
    };
    return templates[name] ?? "// Template not found: {{name}}";
  }
}

// ─── Inline Templates ────────────────────────────────────────────────

const INLINE_TOOL_TEMPLATE = `/**
 * MCP Tool: {{toolName}}
 * {{description}}
 *
 * Auto-generated by rc-mcp — do not edit manually.
 * Endpoint: {{endpoint.method}} {{endpoint.path}}
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RCClient } from "../rc-client.js";

export const {{toolName}}Schema = {{{zodSchemaCode}}};

export function register_{{toolName}}(server: McpServer, rcClient: RCClient): void {
  server.tool(
    "{{toolName}}",
    "{{description}}",
    {{toolName}}Schema.shape,
    {{{handlerCode}}}
  );
}
`;

const INLINE_SERVER_TEMPLATE = `#!/usr/bin/env node
/**
 * {{serverName}} — Minimal MCP Server
 * {{serverDescription}}
 *
 * Auto-generated by rc-mcp — do not edit manually.
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RCClient } from "./rc-client.js";
import { authenticate } from "./auth.js";
{{#each tools}}
import { register_{{{toolName}}} } from "./tools/{{{fileName}}}.js";
{{/each}}

async function main() {
  // Initialize the MCP server
  const server = new McpServer({
    name: "{{serverName}}",
    version: "1.0.0",
  });

  // Set up Rocket.Chat client
  const rcUrl = process.env.RC_URL ?? "http://localhost:3000";
  const rcClient = new RCClient(rcUrl);

  {{#if requiresAuth}}
  // Authenticate with Rocket.Chat
  const username = process.env.RC_USER;
  const password = process.env.RC_PASSWORD;

  if (!username || !password) {
    console.error("Error: RC_USER and RC_PASSWORD environment variables are required.");
    process.exit(1);
  }

  await authenticate(rcClient, username, password);
  {{/if}}

  // Register tools
  {{#each tools}}
  register_{{{toolName}}}(server, rcClient);
  {{/each}}

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(\`{{serverName}} MCP server running ({{tools.length}} tools)\`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
`;

const INLINE_RC_CLIENT_TEMPLATE = `/**
 * Rocket.Chat HTTP Client
 *
 * Lightweight wrapper around fetch for making authenticated API calls
 * to a Rocket.Chat server instance.
 *
 * Auto-generated by rc-mcp — do not edit manually.
 */

export class RCClient {
  private baseUrl: string;
  private authToken: string | null = null;
  private userId: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\\/$/, "");
  }

  /** Set authentication credentials (called after login) */
  setAuth(authToken: string, userId: string): void {
    this.authToken = authToken;
    this.userId = userId;
  }

  /** Check if the client is authenticated */
  isAuthenticated(): boolean {
    return this.authToken !== null && this.userId !== null;
  }

  /** Make a GET request */
  async get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  /** Make a POST request */
  async post(path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  /** Make a PUT request */
  async put(path: string, body?: unknown): Promise<unknown> {
    return this.request("PUT", path, body);
  }

  /** Make a DELETE request */
  async delete(path: string, body?: unknown): Promise<unknown> {
    return this.request("DELETE", path, body);
  }

  /** Make a PATCH request */
  async patch(path: string, body?: unknown): Promise<unknown> {
    return this.request("PATCH", path, body);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = \`\${this.baseUrl}\${path}\`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.authToken && this.userId) {
      headers["X-Auth-Token"] = this.authToken;
      headers["X-User-Id"] = this.userId;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        \`RC API Error [\${response.status}] \${method} \${path}: \${errorBody}\`
      );
    }

    return response.json();
  }
}
`;

const INLINE_AUTH_TEMPLATE = `/**
 * Rocket.Chat Authentication Helper
 *
 * Handles login and token management for the MCP server.
 *
 * Auto-generated by rc-mcp — do not edit manually.
 */

import type { RCClient } from "./rc-client.js";

interface LoginResponse {
  status: string;
  data: {
    authToken: string;
    userId: string;
  };
}

/**
 * Authenticate with a Rocket.Chat server using username and password.
 * Sets the auth credentials on the RCClient instance.
 */
export async function authenticate(
  client: RCClient,
  username: string,
  password: string
): Promise<void> {
  const result = await client.post("/api/v1/login", {
    user: username,
    password: password,
  }) as LoginResponse;

  if (result.status !== "success" || !result.data?.authToken) {
    throw new Error("Rocket.Chat authentication failed. Check your credentials.");
  }

  client.setAuth(result.data.authToken, result.data.userId);
  console.error(\`Authenticated as \${username} (userId: \${result.data.userId})\`);
}
`;

const INLINE_PACKAGE_JSON_TEMPLATE = `{
  "name": "{{name}}",
  "version": "1.0.0",
  "description": "{{description}}",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx src/server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "dotenv": "^16.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
`;

const INLINE_TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
`;

const INLINE_ENV_TEMPLATE = `# Rocket.Chat Server Configuration
RC_URL={{rcUrl}}
RC_USER=your-username
RC_PASSWORD=your-password

# Optional: Gemini API key — enables AI-powered capability suggestions via rc-mcp suggest
# GEMINI_API_KEY=your-gemini-api-key
`;

const INLINE_README_TEMPLATE = `# {{serverName}}

> {{serverDescription}}

**Generated by [rc-mcp](https://github.com/thekishandev/MCP-Server-Generator)** — Minimal MCP Server Generator for Rocket.Chat.

## Tools ({{toolCount}})

| Tool | Method | Endpoint | Description |
|------|--------|----------|-------------|
{{#each tools}}
| \`{{name}}\` | {{method}} | \`{{path}}\` | {{description}} |
{{/each}}

## Quick Start

### 1. Install dependencies

\\\`\\\`\\\`bash
npm install
\\\`\\\`\\\`

### 2. Configure environment

\\\`\\\`\\\`bash
cp .env.example .env
# Edit .env with your Rocket.Chat credentials
\\\`\\\`\\\`

### 3. Build and run

\\\`\\\`\\\`bash
npm run build
npm start
\\\`\\\`\\\`

### 4. Use with gemini-cli

Add to your \\\`settings.json\\\`:

\\\`\\\`\\\`json
{
  "mcpServers": {
    "{{serverName}}": {
      "command": "node",
      "args": ["./dist/server.js"],
      "env": {
        "RC_URL": "http://localhost:3000",
        "RC_USER": "your-user",
        "RC_PASSWORD": "your-password"
      }
    }
  }
}
\\\`\\\`\\\`

## Development

\\\`\\\`\\\`bash
# Run in development mode (no build step)
npm run dev

# Run tests
npm test
\\\`\\\`\\\`

## Capabilities

This server was generated for the following capabilities:
{{#each capabilities}}
- \`{{this}}\`
{{/each}}

---

*Auto-generated by rc-mcp. Do not edit manually — regenerate instead.*
`;

const INLINE_TEST_TEMPLATE = `/**
 * Tests for MCP Tool: {{toolName}}
 *
 * Auto-generated by rc-mcp.
 * Provides thorough validation of the generated Zod schema.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { {{toolName}}Schema } from "../src/tools/{{toolName}}.js";

describe("{{toolName}} Zod Schema", () => {
  it("should have a valid Zod object schema", () => {
    expect({{toolName}}Schema).toBeDefined();
    expect({{toolName}}Schema instanceof z.ZodObject).toBe(true);
  });

  it("should enforce required fields (if any)", () => {
    // We dynamically check required fields from the parsed schema shape
    const shape = {{toolName}}Schema.shape;
    const requiredKeys = Object.keys(shape).filter((key) => {
      const field = shape[key as keyof typeof shape];
      // A field is required if it's NOT explicitly optional
      return !(field instanceof z.ZodOptional);
    });

    if (requiredKeys.length === 0) {
      // If no required fields, an empty object should pass
      const result = {{toolName}}Schema.safeParse({});
      expect(result.success).toBe(true);
    } else {
      // If there are required fields, an empty object should fail
      const result = {{toolName}}Schema.safeParse({});
      expect(result.success).toBe(false);

      if (!result.success) {
        // Verify that the error mentions the missing required fields
        const errorPaths = result.error.errors.map((e) => e.path[0]);
        for (const reqKey of requiredKeys) {
          expect(errorPaths).toContain(reqKey);
        }
      }
    }
  });

  it("should reject invalid data types", () => {
    // Passing a complete mismatch should fail
    const resultString = {{toolName}}Schema.safeParse("not-an-object");
    expect(resultString.success).toBe(false);

    const resultNumber = {{toolName}}Schema.safeParse(42);
    expect(resultNumber.success).toBe(false);

    const resultArray = {{toolName}}Schema.safeParse([]);
    expect(resultArray.success).toBe(false);
  });
});
`;
