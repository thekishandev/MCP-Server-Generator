import { describe, it, expect } from "vitest";
import { ToolGenerator } from "../src/core/tool-generator.js";
import type { EndpointSchema } from "../src/core/types.js";

const mockEndpoint: EndpointSchema = {
  operationId: "chat_postMessage",
  path: "/api/v1/chat.postMessage",
  method: "post",
  summary: "Post Message",
  description:
    "Send messages to channels or users on your workspace. This is a test description that is long enough to test truncation behavior.",
  parameters: [
    {
      name: "X-Auth-Token",
      in: "header",
      required: true,
      schema: { type: "string" },
      description: "Auth token",
    },
    {
      name: "X-User-Id",
      in: "header",
      required: true,
      schema: { type: "string" },
      description: "User ID",
    },
  ],
  requestBody: {
    required: true,
    contentType: "application/json",
    schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "The channel name or ID",
        },
        text: {
          type: "string",
          description: "The message text",
        },
      },
      required: ["channel", "text"],
    },
  },
  responses: {
    "200": {
      description: "Success",
      schema: { type: "object" },
    },
  },
  requiresAuth: true,
  tags: ["Chat"],
  sourceFile: "messaging.yaml",
  domain: "messaging",
};

describe("ToolGenerator", () => {
  const generator = new ToolGenerator();

  describe("generateTools", () => {
    it("should generate a tool from an endpoint schema", () => {
      const tools = generator.generateTools([mockEndpoint]);
      expect(tools).toHaveLength(1);
      expect(tools[0].toolName).toBe("chat_postMessage");
    });

    it("should filter out raw auth headers and NOT inject authToken/userId params", () => {
      const tools = generator.generateTools([mockEndpoint]);
      // Raw header params should not appear as named fields
      expect(tools[0].zodSchemaCode).not.toContain('"X-Auth-Token"');
      expect(tools[0].zodSchemaCode).not.toContain('"X-User-Id"');
      // Auth params should NOT be injected — auth is handled by rcClient from .env
      expect(tools[0].zodSchemaCode).not.toContain('authToken: z.string()');
      expect(tools[0].zodSchemaCode).not.toContain('userId: z.string()');
    });

    it("should include request body params in Zod schema", () => {
      const tools = generator.generateTools([mockEndpoint]);
      expect(tools[0].zodSchemaCode).toContain("channel");
      expect(tools[0].zodSchemaCode).toContain("text");
    });

    it("should generate handler code with correct HTTP method", () => {
      const tools = generator.generateTools([mockEndpoint]);
      expect(tools[0].handlerCode).toContain("rcClient.post");
    });

    it("should compress descriptions under 120 characters", () => {
      const tools = generator.generateTools([mockEndpoint]);
      expect(tools[0].description.length).toBeLessThanOrEqual(120);
    });

    it("should preserve the original endpoint reference", () => {
      const tools = generator.generateTools([mockEndpoint]);
      expect(tools[0].endpoint).toBe(mockEndpoint);
    });
  });

  describe("tool name generation", () => {
    it("should convert API path to tool name", () => {
      const ep: EndpointSchema = {
        ...mockEndpoint,
        path: "/api/v1/channels.history",
        operationId: "channels_history",
      };
      const tools = generator.generateTools([ep]);
      expect(tools[0].toolName).toBe("channels_history");
    });
  });

  describe("Zod schema edge cases", () => {
    it("should handle endpoint with no parameters and no body", () => {
      const ep: EndpointSchema = {
        ...mockEndpoint,
        parameters: [],
        requestBody: undefined,
        requiresAuth: false,
      };
      const tools = generator.generateTools([ep]);
      expect(tools[0].zodSchemaCode).toBe("z.object({})");
    });

    it("should handle optional parameters", () => {
      const ep: EndpointSchema = {
        ...mockEndpoint,
        parameters: [
          {
            name: "count",
            in: "query",
            required: false,
            schema: { type: "number" },
            description: "Number of results",
          },
        ],
        requestBody: undefined,
      };
      const tools = generator.generateTools([ep]);
      expect(tools[0].zodSchemaCode).toContain(".optional()");
    });
  });
});
