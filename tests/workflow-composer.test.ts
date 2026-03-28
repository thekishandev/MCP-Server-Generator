/**
 * Workflow Composer Tests
 *
 * Tests:
 * 1. Composite tool generation from workflow definitions
 * 2. Zod schema only exposes user-facing params (not auto-wired)
 * 3. Handler code contains sequential API calls with correct wiring
 * 4. Error handling in generated handlers
 * 5. All 10 predefined workflows produce valid GeneratedTool objects
 */

import { describe, it, expect } from "vitest";
import { WorkflowComposer } from "../src/core/workflow-composer.js";
import { WorkflowRegistry } from "../src/core/workflow-registry.js";
import type { EndpointSchema, WorkflowDefinition } from "../src/core/types.js";

// ─── Mock Endpoints ───────────────────────────────────────────────────

const mockEndpoints: EndpointSchema[] = [
  {
    operationId: "get-api-v1-channels.info",
    path: "/api/v1/channels.info",
    method: "get",
    summary: "Get channel info",
    description: "Returns channel info by name or ID",
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
    description: "Send a message",
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
  {
    operationId: "post-api-v1-channels.create",
    path: "/api/v1/channels.create",
    method: "post",
    summary: "Create Channel",
    description: "Create a new channel",
    parameters: [],
    responses: { "200": { description: "Success", schema: { type: "object" } } },
    requiresAuth: true,
    tags: ["Channels"],
    sourceFile: "rooms.yaml",
    domain: "rooms",
  },
  {
    operationId: "post-api-v1-channels.setDescription",
    path: "/api/v1/channels.setDescription",
    method: "post",
    summary: "Set Channel Description",
    description: "Set description",
    parameters: [],
    responses: { "200": { description: "Success", schema: { type: "object" } } },
    requiresAuth: true,
    tags: ["Channels"],
    sourceFile: "rooms.yaml",
    domain: "rooms",
  },
  {
    operationId: "post-api-v1-channels.setTopic",
    path: "/api/v1/channels.setTopic",
    method: "post",
    summary: "Set Channel Topic",
    description: "Set topic",
    parameters: [],
    responses: { "200": { description: "Success", schema: { type: "object" } } },
    requiresAuth: true,
    tags: ["Channels"],
    sourceFile: "rooms.yaml",
    domain: "rooms",
  },
  {
    operationId: "post-api-v1-chat.pinMessage",
    path: "/api/v1/chat.pinMessage",
    method: "post",
    summary: "Pin Message",
    description: "Pin a message",
    parameters: [],
    responses: { "200": { description: "Success", schema: { type: "object" } } },
    requiresAuth: true,
    tags: ["Chat"],
    sourceFile: "messaging.yaml",
    domain: "messaging",
  },
];

// ─── Tests ────────────────────────────────────────────────────────────

describe("WorkflowComposer", () => {
  const composer = new WorkflowComposer();

  describe("compose — send_message_to_channel", () => {
    const definition: WorkflowDefinition = {
      name: "send_message_to_channel",
      description: "Resolve a channel by name and send a message to it.",
      steps: [
        {
          operationId: "get-api-v1-channels.info",
          parameterMappings: [],
          description: "Look up channel by name",
        },
        {
          operationId: "post-api-v1-chat.postMessage",
          parameterMappings: [
            { fromStep: 0, fromField: "channel._id", toParam: "rid" },
          ],
          description: "Send message to resolved channel",
        },
      ],
      userParams: [
        {
          name: "channelName",
          type: "string",
          required: true,
          description: "Channel name (without #)",
          forStep: 0,
          asParam: "roomName",
        },
        {
          name: "text",
          type: "string",
          required: true,
          description: "Message text to send",
          forStep: 1,
          asParam: "text",
        },
      ],
    };

    it("should produce a valid GeneratedTool", () => {
      const tool = composer.compose(definition, mockEndpoints);
      expect(tool.toolName).toBe("send_message_to_channel");
      expect(tool.description).toBeTruthy();
      expect(tool.zodSchemaCode).toBeTruthy();
      expect(tool.handlerCode).toBeTruthy();
      expect(tool.endpoint).toBeDefined();
    });

    it("Zod schema should expose only user-facing params (no auth)", () => {
      const tool = composer.compose(definition, mockEndpoints);
      // Auth params should NOT be in the schema — handled by rcClient from .env
      expect(tool.zodSchemaCode).not.toContain("authToken: z.string()");
      expect(tool.zodSchemaCode).not.toContain("userId: z.string()");
      // Should have user params
      expect(tool.zodSchemaCode).toContain("channelName:");
      expect(tool.zodSchemaCode).toContain("text:");
      // Should NOT expose auto-wired params
      expect(tool.zodSchemaCode).not.toContain('rid:');
    });

    it("handler code should chain channels.info → chat.postMessage", () => {
      const tool = composer.compose(definition, mockEndpoints);
      expect(tool.handlerCode).toContain("/api/v1/channels.info");
      expect(tool.handlerCode).toContain("/api/v1/chat.postMessage");
    });

    it("handler should wire channel._id from step 0 to step 1", () => {
      const tool = composer.compose(definition, mockEndpoints);
      // Should access stepResults[0].channel._id
      expect(tool.handlerCode).toContain("stepResults[0]");
      expect(tool.handlerCode).toContain("channel");
      expect(tool.handlerCode).toContain("_id");
    });

    it("handler should contain error handling", () => {
      const tool = composer.compose(definition, mockEndpoints);
      expect(tool.handlerCode).toContain("catch (error)");
      expect(tool.handlerCode).toContain("isError: true");
    });
  });

  describe("compose — create_project_channel (3 steps)", () => {
    it("should handle 3-step workflows", () => {
      const registry = new WorkflowRegistry();
      const def = registry.getWorkflow("create_project_channel")!;
      const endpoints = mockEndpoints.filter((ep) =>
        def.steps.some((s) => s.operationId === ep.operationId),
      );

      const tool = composer.compose(def, endpoints);
      expect(tool.toolName).toBe("create_project_channel");
      // Should contain all 3 API paths
      expect(tool.handlerCode).toContain("/api/v1/channels.create");
      expect(tool.handlerCode).toContain("/api/v1/channels.setDescription");
      expect(tool.handlerCode).toContain("/api/v1/channels.setTopic");
      // Should wire channel._id from step 0 to steps 1 and 2
      expect(tool.handlerCode).toContain("stepResults[0]");
    });
  });

  describe("compose — error cases", () => {
    it("should throw when a referenced operationId is missing", () => {
      const def: WorkflowDefinition = {
        name: "test_missing",
        description: "Test",
        steps: [
          {
            operationId: "nonexistent-endpoint",
            parameterMappings: [],
          },
        ],
        userParams: [],
      };

      expect(() => composer.compose(def, mockEndpoints)).toThrow(
        'references operationId "nonexistent-endpoint"',
      );
    });
  });

  describe("compose — all 10 registry workflows produce valid tools", () => {
    // For each workflow, mock endpoints with matching operationIds
    it("all 10 workflows should produce valid GeneratedTool objects", () => {
      const registry = new WorkflowRegistry();

      for (const def of registry.listWorkflows()) {
        // Create minimal mock endpoints for each workflow's steps
        const mockEps: EndpointSchema[] = def.steps.flatMap((step) => {
          const eps: EndpointSchema[] = [{
            operationId: step.operationId,
            path: `/api/v1/${step.operationId.replace(/^(get|post|put|delete)-api-v1-/, "")}`,
            method: step.operationId.startsWith("get-") ? "get" : "post",
            summary: step.description ?? step.operationId,
            description: "",
            parameters: [],
            responses: {
              "200": { description: "Success", schema: { type: "object" } },
            },
            requiresAuth: true,
            tags: [],
            sourceFile: "mock.yaml",
            domain: "mock" as any,
          }];
          if (step.fallbackOperationId) {
            eps.push({
              operationId: step.fallbackOperationId,
              path: `/api/v1/${step.fallbackOperationId.replace(/^(get|post|put|delete)-api-v1-/, "")}`,
              method: step.fallbackOperationId.startsWith("get-") ? "get" : "post",
              summary: step.fallbackOperationId,
              description: "",
              parameters: [],
              responses: {
                "200": { description: "Success", schema: { type: "object" } },
              },
              requiresAuth: true,
              tags: [],
              sourceFile: "mock.yaml",
              domain: "mock" as any,
            });
          }
          return eps;
        });

        const tool = composer.compose(def, mockEps);
        expect(tool.toolName).toBe(def.name);
        expect(tool.zodSchemaCode).toContain("z.object");
        expect(tool.handlerCode).toContain("async");
        expect(typeof tool.description).toBe("string");
      }
    });
  });
});
