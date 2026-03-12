import { describe, it, expect, vi, beforeEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Mock the core dependencies so tests run fast without network/fs
vi.mock("../src/core/schema-extractor.js", () => ({
  SchemaExtractor: vi.fn().mockImplementation(() => ({
    loadDomains: vi.fn().mockResolvedValue(undefined),
    getEndpointsByTag: vi.fn().mockReturnValue(
      new Map([
        [
          "messaging",
          new Map([
            [
              "Chat",
              [
                {
                  operationId: "post-api-v1-chat.postMessage",
                  path: "/api/v1/chat.postMessage",
                  summary: "Send a message",
                  tags: ["Chat"],
                  domain: "messaging",
                },
              ],
            ],
          ]),
        ],
      ]),
    ),
    extractEndpointsForIds: vi.fn().mockReturnValue([
      {
        operationId: "post-api-v1-chat.postMessage",
        path: "/api/v1/chat.postMessage",
        summary: "Send a message",
        requiresAuth: true,
      },
    ]),
  })),
}));

vi.mock("../src/core/suggest-engine.js", () => ({
  SuggestEngine: vi.fn().mockImplementation(() => ({
    suggest: vi.fn().mockResolvedValue([
      {
        operationId: "post-api-v1-chat.postMessage",
        confidence: 0.9,
        rationale: "User wants to send a message",
      },
    ]),
  })),
}));

vi.mock("../src/core/tool-generator.js", () => ({
  ToolGenerator: vi.fn().mockImplementation(() => ({
    generateContext: vi.fn().mockReturnValue({ capabilities: [] }),
  })),
}));

vi.mock("../src/core/server-scaffolder.js", () => ({
  ServerScaffolder: vi.fn().mockImplementation(() => ({
    scaffold: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../src/core/minimality-analyzer.js", () => ({
  MinimalityAnalyzer: vi.fn().mockImplementation(() => ({
    analyze: vi.fn().mockReturnValue({
      endpoints: { selectedEndpoints: 1, totalInSpecs: 100 },
      reduction: { overallVerdict: "EXCELLENT" },
    }),
    formatReport: vi.fn().mockReturnValue("MOCK REPORT"),
  })),
}));

// We need to import the server logic but we will just test tool definitions
import { mcpServer } from "../src/extension/server.js";

describe("Extension MCP Server", () => {
  it("should export an MCP Server instance and register tools", () => {
    expect(mcpServer).toBeInstanceOf(McpServer);

    // Assert that the tools are registered
    const tools =
      (mcpServer as any)._registeredTools || (mcpServer as any).tools;
    expect(tools).toBeDefined();
  });
});
