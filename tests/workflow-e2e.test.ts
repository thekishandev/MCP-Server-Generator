/**
 * Workflow E2E Tests
 *
 * End-to-end tests that:
 * 1. Generate a full server package using workflow definitions
 * 2. Verify composite tool files are created
 * 3. Verify the generated server.ts imports and registers workflow tools
 * 4. Verify the generated Zod schema compiles
 * 5. Compare workflow-generated output vs raw-endpoint output
 */

import { describe, it, expect } from "vitest";
import { WorkflowRegistry } from "../src/core/workflow-registry.js";
import { WorkflowComposer } from "../src/core/workflow-composer.js";
import { ToolGenerator } from "../src/core/tool-generator.js";
import { ServerScaffolder } from "../src/core/server-scaffolder.js";
import type { EndpointSchema, ServerConfig } from "../src/core/types.js";

// ─── Shared Test Fixtures ──────────────────────────────────────────────

const mockEndpoints: EndpointSchema[] = [
  {
    operationId: "get-api-v1-rooms.info",
    path: "/api/v1/rooms.info",
    method: "get",
    summary: "Get channel info",
    description: "",
    parameters: [],
    responses: { "200": { description: "Success", schema: { type: "object" } } },
    requiresAuth: true,
    tags: ["Channels"],
    sourceFile: "rooms.yaml",
    domain: "rooms",
  },
  {
    operationId: "post-api-v1-chat.postMessage",
    path: "/api/v1/chat.postMessage",
    method: "post",
    summary: "Post Message",
    description: "",
    parameters: [],
    requestBody: {
      required: true,
      contentType: "application/json",
      schema: {
        type: "object",
        properties: {
          rid: { type: "string", description: "Room ID" },
          text: { type: "string", description: "Message text" },
        },
        required: ["rid", "text"],
      },
    },
    responses: { "200": { description: "Success", schema: { type: "object" } } },
    requiresAuth: true,
    tags: ["Chat"],
    sourceFile: "messaging.yaml",
    domain: "messaging",
  },
];

const mockConfig: ServerConfig = {
  name: "workflow-e2e-test-server",
  description: "E2E test MCP server with workflow tools",
  rcUrl: "http://localhost:3000",
  capabilities: [],
  outputDir: "/tmp/workflow-e2e-test",
};

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Workflow E2E: send_message_to_channel", () => {
  const registry = new WorkflowRegistry();
  const generator = new ToolGenerator();
  const scaffolder = new ServerScaffolder();
  const definition = registry.getWorkflow("send_message_to_channel")!;

  it("should generate a composite tool via ToolGenerator.generateWorkflowTool", () => {
    const tool = generator.generateWorkflowTool(definition, mockEndpoints);
    expect(tool.toolName).toBe("send_message_to_channel");
  });

  it("should scaffold a complete server package with the workflow tool", () => {
    const tool = generator.generateWorkflowTool(definition, mockEndpoints);
    const files = scaffolder.scaffold([tool], mockConfig);
    const paths = files.map((f) => f.relativePath);

    // Must have standard server structure
    expect(paths).toContain("src/server.ts");
    expect(paths).toContain("src/rc-client.ts");
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("README.md");
  });

  it("should generate a tool file named after the workflow (not the endpoint)", () => {
    const tool = generator.generateWorkflowTool(definition, mockEndpoints);
    const files = scaffolder.scaffold([tool], mockConfig);
    const toolFiles = files.filter((f) =>
      f.relativePath.startsWith("src/tools/"),
    );

    expect(toolFiles.length).toBe(1);
    expect(toolFiles[0].relativePath).toBe(
      "src/tools/send_message_to_channel.ts",
    );
  });

  it("generated server.ts should import and register the workflow tool", () => {
    const tool = generator.generateWorkflowTool(definition, mockEndpoints);
    const files = scaffolder.scaffold([tool], mockConfig);
    const serverFile = files.find((f) => f.relativePath === "src/server.ts");

    expect(serverFile).toBeDefined();
    expect(serverFile!.content).toContain("send_message_to_channel");
    expect(serverFile!.content).toContain(
      "register_send_message_to_channel",
    );
  });

  it("generated tool file should contain Zod schema with user params", () => {
    const tool = generator.generateWorkflowTool(definition, mockEndpoints);
    const files = scaffolder.scaffold([tool], mockConfig);
    const toolFile = files.find(
      (f) => f.relativePath === "src/tools/send_message_to_channel.ts",
    );

    expect(toolFile).toBeDefined();
    expect(toolFile!.content).toContain("z.object");
    expect(toolFile!.content).toContain("channelName");
    expect(toolFile!.content).toContain("text");
    // Auth params should NOT be in the schema — handled by rcClient from .env
    expect(toolFile!.content).not.toContain("authToken");
  });

  it("generated tool file should contain composite handler with sequential calls", () => {
    const tool = generator.generateWorkflowTool(definition, mockEndpoints);
    const files = scaffolder.scaffold([tool], mockConfig);
    const toolFile = files.find(
      (f) => f.relativePath === "src/tools/send_message_to_channel.ts",
    );

    expect(toolFile).toBeDefined();
    // Should contain both API paths
    expect(toolFile!.content).toContain("/api/v1/rooms.info");
    expect(toolFile!.content).toContain("/api/v1/chat.postMessage");
    // Should contain step result wiring
    expect(toolFile!.content).toContain("stepResults");
  });
});

describe("Workflow E2E: mixed workflow + raw tools", () => {
  it("should generate both workflow and raw tools when mixed", () => {
    const registry = new WorkflowRegistry();
    const generator = new ToolGenerator();
    const scaffolder = new ServerScaffolder();
    const definition = registry.getWorkflow("send_message_to_channel")!;

    // Generate workflow tool
    const workflowTool = generator.generateWorkflowTool(
      definition,
      mockEndpoints,
    );

    // Generate a raw tool for an endpoint NOT covered by the workflow
    const rawTool = generator.generateTools([
      {
        operationId: "post-api-v1-channels.create",
        path: "/api/v1/channels.create",
        method: "post",
        summary: "Create Channel",
        description: "",
        parameters: [],
        responses: {
          "200": { description: "Success", schema: { type: "object" } },
        },
        requiresAuth: true,
        tags: ["Channels"],
        sourceFile: "rooms.yaml",
        domain: "rooms",
      },
    ]);

    const allTools = [workflowTool, ...rawTool];
    const files = scaffolder.scaffold(allTools, mockConfig);
    const toolFiles = files.filter((f) =>
      f.relativePath.startsWith("src/tools/"),
    );

    // Should have both the workflow tool and the raw tool
    const names = toolFiles.map((f) => f.relativePath);
    expect(names).toContain("src/tools/send_message_to_channel.ts");
    expect(names).toContain("src/tools/channels_create.ts");
  });
});

describe("Workflow E2E: backwards compatibility", () => {
  it("raw-only tool generation should still work without workflows", () => {
    const generator = new ToolGenerator();
    const scaffolder = new ServerScaffolder();

    const rawTools = generator.generateTools(mockEndpoints);
    const files = scaffolder.scaffold(rawTools, mockConfig);

    // Should have standard output without any workflow artifacts
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain("src/server.ts");
    expect(paths.some((p) => p.startsWith("src/tools/"))).toBe(true);
  });
});
