import { describe, it, expect } from "vitest";
import { ServerScaffolder } from "../src/core/server-scaffolder.js";
import type { GeneratedTool, ServerConfig } from "../src/core/types.js";

const mockTool: GeneratedTool = {
  toolName: "chat_postMessage",
  description: "Post Message",
  zodSchemaCode: "z.object({ channel: z.string(), text: z.string() })",
  handlerCode: `async (params) => {
      try {
        const result = await rcClient.post("/api/v1/chat.postMessage", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: "Error" }], isError: true };
      }
    }`,
  endpoint: {
    operationId: "chat_postMessage",
    path: "/api/v1/chat.postMessage",
    method: "post",
    summary: "Post Message",
    description: "",
    parameters: [],
    responses: {},
    requiresAuth: true,
    tags: [],
    sourceFile: "messaging.yaml",
    domain: "messaging",
  },
};

const mockConfig: ServerConfig = {
  name: "test-server",
  description: "Test MCP server",
  rcUrl: "http://localhost:3000",
  capabilities: ["send-message"],
  outputDir: "/tmp/test-output",
};

describe("ServerScaffolder", () => {
  const scaffolder = new ServerScaffolder();

  describe("scaffold", () => {
    it("should generate all required files", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const paths = files.map((f) => f.relativePath);

      expect(paths).toContain("src/server.ts");
      expect(paths).toContain("src/rc-client.ts");
      expect(paths).toContain("package.json");
      expect(paths).toContain("tsconfig.json");
      expect(paths).toContain(".env.example");
      expect(paths).toContain("README.md");
    });

    it("should NOT generate auth.ts (auth is per-request via tool params)", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const paths = files.map((f) => f.relativePath);
      expect(paths).not.toContain("src/auth.ts");
    });

    it("should generate a tool file for each tool", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const toolFiles = files.filter((f) =>
        f.relativePath.startsWith("src/tools/"),
      );
      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0].relativePath).toBe("src/tools/chat_postMessage.ts");
    });

    it("should generate test files for each tool", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const testFiles = files.filter((f) =>
        f.relativePath.startsWith("tests/"),
      );
      expect(testFiles).toHaveLength(1);
    });

    it("should include server name in generated server.ts", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const server = files.find((f) => f.relativePath === "src/server.ts");
      expect(server?.content).toContain("test-server");
    });

    it("should include MCP SDK in generated package.json", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const pkg = files.find((f) => f.relativePath === "package.json");
      expect(pkg?.content).toContain("@modelcontextprotocol/sdk");
    });

    it("should NOT include RC_USERNAME or RC_PASSWORD in .env.example (only token-based auth)", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const env = files.find((f) => f.relativePath === ".env.example");
      expect(env?.content).toContain("RC_URL");
      // Must not include username/password credentials — only token-based auth (RC_AUTH_TOKEN + RC_USER_ID)
      expect(env?.content).not.toContain("RC_USERNAME");
      expect(env?.content).not.toContain("RC_PASSWORD");
    });

    it("should NOT import auth.ts in generated server.ts", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const server = files.find((f) => f.relativePath === "src/server.ts");
      expect(server?.content).not.toContain("import { authenticate }");
    });

    it("should generate GEMINI.md for agent context", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const geminiMd = files.find((f) => f.relativePath === "GEMINI.md");
      expect(geminiMd).toBeDefined();
      expect(geminiMd?.content).toContain("test-server");
      expect(geminiMd?.content).toContain("chat_postMessage");
    });

    it("should generate gemini-extension.json for self-registration", () => {
      const files = scaffolder.scaffold([mockTool], mockConfig);
      const extJson = files.find(
        (f) => f.relativePath === "gemini-extension.json",
      );
      expect(extJson).toBeDefined();
      const parsed = JSON.parse(extJson!.content);
      expect(parsed.name).toBe("test-server");
      expect(parsed.contextFileName).toBe("GEMINI.md");
      expect(parsed.mcpServers).toBeDefined();
    });
  });
});
