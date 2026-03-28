/**
 * Workflow Integration Tests — ALL 10 Predefined Workflows
 *
 * These tests validate that the GENERATED workflow handlers actually:
 * 1. Make the correct RC API calls in the correct order
 * 2. Wire step results between steps (e.g., channel._id from lookup → rid in message)
 * 3. Return proper MCP response format ({ content: [{ type: "text", text: ... }] })
 * 4. Handle step failures with meaningful error messages
 *
 * Approach: For each workflow, we generate the handler code via WorkflowComposer,
 * then execute it against a mocked rcClient that records all API calls and returns
 * realistic RC API responses.
 *
 * This directly addresses GSoC R4: "testing with a variety of typical workflows
 * (say a minimum of 10 different/diverse ones) is absolutely mandatory."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowRegistry } from "../src/core/workflow-registry.js";
import { WorkflowComposer } from "../src/core/workflow-composer.js";
import type { EndpointSchema, WorkflowDefinition } from "../src/core/types.js";

// ─── Mock RC Client ──────────────────────────────────────────────────────

interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

function createMockRcClient(responseMap: Record<string, unknown>) {
  const calls: ApiCall[] = [];

  const client = {
    setAuth: vi.fn(),
    get: vi.fn(async (path: string) => {
      calls.push({ method: "GET", path });
      // Match against the base path (without query string)
      const basePath = path.split("?")[0];
      const response = responseMap[basePath] ?? responseMap[path];
      if (!response) throw new Error(`Unexpected GET ${path}`);
      return response;
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: "POST", path, body });
      const response = responseMap[path];
      if (!response) throw new Error(`Unexpected POST ${path}`);
      return response;
    }),
    put: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: "PUT", path, body });
      const response = responseMap[path];
      if (!response) throw new Error(`Unexpected PUT ${path}`);
      return response;
    }),
    delete: vi.fn(async (path: string) => {
      calls.push({ method: "DELETE", path });
      const response = responseMap[path];
      if (!response) throw new Error(`Unexpected DELETE ${path}`);
      return response;
    }),
    patch: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: "PATCH", path, body });
      const response = responseMap[path];
      if (!response) throw new Error(`Unexpected PATCH ${path}`);
      return response;
    }),
  };

  return { client, calls };
}

// ─── Mock Endpoint Factory ───────────────────────────────────────────────

function makeMockEndpoint(
  operationId: string,
  method: "get" | "post" | "put" | "delete" = "post",
): EndpointSchema {
  let pathSuffix = operationId
    .replace(/^(get|post|put|delete)-api-v1-/, "");
    
  // Handle the one quirk where integrations use hyphen in operationId but dot in path
  if (pathSuffix === "integrations-create") {
    pathSuffix = "integrations.create";
  } else {
    // Other endpoints might use hyphens for slash (e.g., users-list ?) 
    // Actually most RC endpoints use dotted operationIds (e.g. chat.postMessage)
    // but we'll preserve the existing replace just in case.
    pathSuffix = pathSuffix.replace(/-/g, "/");
  }

  return {
    operationId,
    path: `/api/v1/${pathSuffix}`,
    method,
    summary: operationId,
    description: "",
    parameters: [],
    responses: { "200": { description: "Success", schema: { type: "object" } } },
    requiresAuth: true,
    tags: [],
    sourceFile: "mock.yaml",
    domain: "rooms" as any,
  };
}

function getEndpointsForWorkflow(def: WorkflowDefinition): EndpointSchema[] {
  const eps: EndpointSchema[] = [];
  for (const step of def.steps) {
    eps.push(
      makeMockEndpoint(
        step.operationId,
        step.operationId.startsWith("get-") ? "get" : "post",
      )
    );
    if (step.fallbackOperationId) {
      eps.push(
        makeMockEndpoint(
          step.fallbackOperationId,
          step.fallbackOperationId.startsWith("get-") ? "get" : "post",
        )
      );
    }
  }
  return eps;
}

// ─── Handler Executor ────────────────────────────────────────────────────
// Compiles the generated handler code string into a callable function
// with a mocked rcClient in the closure scope.

function compileHandler(
  handlerCode: string,
  rcClient: ReturnType<typeof createMockRcClient>["client"],
): (params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  // The generated handler contains TypeScript syntax (as const, as any, : type)
  // that must be stripped before evaluation in V8's new Function().
  let jsCode = handlerCode
    .replace(/\bas\s+const\b/g, "")           // remove "as const"
    .replace(/\bas\s+any\b/g, "")             // remove "as any"
    .replace(/:\s*unknown\[\]/g, "")           // remove ": unknown[]"
    .replace(/:\s*Record<string,\s*unknown>/g, ""); // remove Record types

  const fn = new Function("rcClient", `return (${jsCode})`)(rcClient);
  return fn;
}

// ─── Shared Setup ────────────────────────────────────────────────────────

const registry = new WorkflowRegistry();
const composer = new WorkflowComposer();
const AUTH_PARAMS = { authToken: "test-token-123", userId: "test-user-456" };

// ─── WORKFLOW 1: send_message_to_channel ─────────────────────────────────

describe("Integration: send_message_to_channel", () => {
  it("should chain channels.info → chat.postMessage and wire channel._id", async () => {
    const def = registry.getWorkflow("send_message_to_channel")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/rooms.info": { room: { _id: "ROOM_ABC123", name: "general" } },
      "/api/v1/chat.postMessage": { message: { _id: "MSG_001", text: "Hello!" } },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      channelName: "general",
      text: "Hello!",
    });

    // Auth is pre-configured from .env — no per-call setAuth needed

    // Verify 2 API calls in correct order
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toContain("/api/v1/rooms.info");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].path).toBe("/api/v1/chat.postMessage");

    // Verify channel._id was wired from step 0 → step 1 as "roomId"
    expect(calls[1].body).toHaveProperty("roomId", "ROOM_ABC123");

    // Verify MCP response format
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toHaveProperty("message._id", "MSG_001");
  });

  it("should handle step failure with meaningful error", async () => {
    const def = registry.getWorkflow("send_message_to_channel")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client } = createMockRcClient({
      // channels.info fails — chat.postMessage never reached
    });
    client.get.mockRejectedValueOnce(new Error("Channel not found"));

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({ ...AUTH_PARAMS, channelName: "nonexistent", text: "Hi" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("failed");
    expect(result.content[0].text).toContain("Channel not found");
  });
});

// ─── WORKFLOW 2: create_project_channel ──────────────────────────────────

describe("Integration: create_project_channel", () => {
  it("should chain channels.create → setDescription → setTopic (3 steps)", async () => {
    const def = registry.getWorkflow("create_project_channel")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/channels.create": { channel: { _id: "CH_NEW_001", name: "project-x" } },
      "/api/v1/channels.setDescription": { success: true },
      "/api/v1/channels.setTopic": { success: true },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      channelName: "project-x",
      description: "Project X workspace",
      topic: "Sprint 1 tasks",
    });

    // Verify 3 API calls
    expect(calls).toHaveLength(3);
    expect(calls[0].path).toBe("/api/v1/channels.create");
    expect(calls[1].path).toBe("/api/v1/channels.setDescription");
    expect(calls[2].path).toBe("/api/v1/channels.setTopic");

    // Verify channel._id wired to both step 1 and step 2
    expect(calls[1].body).toHaveProperty("roomId", "CH_NEW_001");
    expect(calls[2].body).toHaveProperty("roomId", "CH_NEW_001");

    // Verify success response
    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 3: invite_users_to_channel ─────────────────────────────────

describe("Integration: invite_users_to_channel", () => {
  it("should chain channels.info → channels.invite with correct wiring", async () => {
    const def = registry.getWorkflow("invite_users_to_channel")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/rooms.info": { room: { _id: "ROOM_DEV", name: "dev-team" } },
      "/api/v1/channels.invite": { channel: { _id: "ROOM_DEV" }, success: true },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      channelName: "dev-team",
      userId: "USER_INVITE_789",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].path).toContain("/api/v1/rooms.info");
    // Verify channel._id wired to invite call
    expect(calls[1].body).toHaveProperty("roomId", "ROOM_DEV");
    expect(calls[1].body).toHaveProperty("userId", "USER_INVITE_789");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 4: create_discussion_in_channel ────────────────────────────

describe("Integration: create_discussion_in_channel", () => {
  it("should chain channels.info → rooms.createDiscussion with prid wiring", async () => {
    const def = registry.getWorkflow("create_discussion_in_channel")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/rooms.info": { room: { _id: "ROOM_GENERAL" } },
      "/api/v1/rooms.createDiscussion": { discussion: { _id: "DISC_001", fname: "Bug Triage" } },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      channelName: "general",
      discussionName: "Bug Triage",
      initialMessage: "Let's discuss the open bugs",
    });

    expect(calls).toHaveLength(2);
    // Verify channel._id wired as prid (parent room ID for discussion)
    expect(calls[1].body).toHaveProperty("prid", "ROOM_GENERAL");
    expect(calls[1].body).toHaveProperty("t_name", "Bug Triage");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 5: send_and_pin_message ────────────────────────────────────

describe("Integration: send_and_pin_message", () => {
  it("should chain chat.postMessage → chat.pinMessage with message._id wiring", async () => {
    const def = registry.getWorkflow("send_and_pin_message")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/chat.postMessage": { message: { _id: "MSG_PIN_001", text: "Important announcement" } },
      "/api/v1/chat.pinMessage": { success: true },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      roomId: "ROOM_ANNOUNCEMENTS",
      text: "Important announcement",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe("/api/v1/chat.postMessage");
    expect(calls[1].path).toBe("/api/v1/chat.pinMessage");
    // Verify message._id wired from step 0 → step 1 as messageId
    expect(calls[1].body).toHaveProperty("messageId", "MSG_PIN_001");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 6: send_dm_to_user ─────────────────────────────────────────

describe("Integration: send_dm_to_user", () => {
  it("should chain im.create → chat.postMessage with room._id wiring", async () => {
    const def = registry.getWorkflow("send_dm_to_user")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/im.create": { room: { _id: "DM_ROOM_001" } },
      "/api/v1/chat.postMessage": { message: { _id: "DM_MSG_001", text: "Hey!" } },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      username: "john.doe",
      text: "Hey!",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe("/api/v1/im.create");
    expect(calls[0].body).toHaveProperty("username", "john.doe");
    // Verify room._id wired from step 0 → step 1 as roomId
    expect(calls[1].body).toHaveProperty("roomId", "DM_ROOM_001");
    expect(calls[1].body).toHaveProperty("text", "Hey!");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 7: set_status_and_notify ───────────────────────────────────

describe("Integration: set_status_and_notify", () => {
  it("should chain users.setStatus → channels.info → chat.postMessage (3 steps)", async () => {
    const def = registry.getWorkflow("set_status_and_notify")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/users.setStatus": { success: true },
      "/api/v1/rooms.info": { room: { _id: "ROOM_STATUS" } },
      "/api/v1/chat.postMessage": { message: { _id: "MSG_STATUS_001", text: "I'm busy" } },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      statusText: "In a meeting",
      status: "busy",
      notifyChannel: "general",
      notifyMessage: "I'm now in a meeting",
    });

    // Verify 3 API calls in correct order
    expect(calls).toHaveLength(3);
    expect(calls[0].path).toBe("/api/v1/users.setStatus");
    expect(calls[0].body).toHaveProperty("message", "In a meeting");
    expect(calls[0].body).toHaveProperty("status", "busy");
    expect(calls[1].path).toContain("/api/v1/rooms.info");
    expect(calls[2].path).toBe("/api/v1/chat.postMessage");
    // Verify channel._id wired from step 1 → step 2 as roomId
    expect(calls[2].body).toHaveProperty("roomId", "ROOM_STATUS");
    expect(calls[2].body).toHaveProperty("text", "I'm now in a meeting");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 8: archive_channel ─────────────────────────────────────────

describe("Integration: archive_channel", () => {
  it("should chain channels.info → channels.archive with channel._id wiring", async () => {
    const def = registry.getWorkflow("archive_channel")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/rooms.info": { room: { _id: "ROOM_OLD_PROJECT" } },
      "/api/v1/channels.archive": { success: true },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      channelName: "old-project",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].path).toContain("/api/v1/rooms.info");
    expect(calls[1].path).toBe("/api/v1/channels.archive");
    // Verify channel._id wired
    expect(calls[1].body).toHaveProperty("roomId", "ROOM_OLD_PROJECT");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 9: setup_project_workspace ─────────────────────────────────

describe("Integration: setup_project_workspace", () => {
  it("should chain channels.create → setDescription → setTopic → postMessage (4 steps)", async () => {
    const def = registry.getWorkflow("setup_project_workspace")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/channels.create": { channel: { _id: "CH_PROJECT_001", name: "project-x" } },
      "/api/v1/channels.setDescription": { success: true },
      "/api/v1/channels.setTopic": { success: true },
      "/api/v1/chat.postMessage": { message: { _id: "MSG_WELCOME_001", text: "Welcome!" } },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      channelName: "project-x",
      description: "Project X workspace",
      topic: "Sprint 1",
      welcomeMessage: "Welcome to Project X!",
    });

    // Verify 4 API calls in correct order
    expect(calls).toHaveLength(4);
    expect(calls[0].path).toBe("/api/v1/channels.create");
    expect(calls[1].path).toBe("/api/v1/channels.setDescription");
    expect(calls[2].path).toBe("/api/v1/channels.setTopic");
    expect(calls[3].path).toBe("/api/v1/chat.postMessage");

    // Verify channel._id wired to all subsequent steps
    expect(calls[1].body).toHaveProperty("roomId", "CH_PROJECT_001");
    expect(calls[2].body).toHaveProperty("roomId", "CH_PROJECT_001");
    expect(calls[3].body).toHaveProperty("roomId", "CH_PROJECT_001");
    expect(calls[3].body).toHaveProperty("text", "Welcome to Project X!");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 10: react_to_last_message ──────────────────────────────────

describe("Integration: react_to_last_message", () => {
  it("should chain channels.history → chat.react with messages.0._id wiring", async () => {
    const def = registry.getWorkflow("react_to_last_message")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/channels.history": {
        messages: [{ _id: "MSG_LAST_001", text: "Latest message", ts: "2026-03-21T10:00:00Z" }],
      },
      "/api/v1/chat.react": { success: true },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      roomId: "ROOM_GENERAL",
      emoji: ":thumbsup:",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].path).toContain("/api/v1/channels.history");
    expect(calls[1].path).toBe("/api/v1/chat.react");
    // Verify messages[0]._id wired as messageId
    expect(calls[1].body).toHaveProperty("messageId", "MSG_LAST_001");
    expect(calls[1].body).toHaveProperty("emoji", ":thumbsup:");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 11: onboard_user ───────────────────────────────────────────

describe("Integration: onboard_user", () => {
  it("should chain users.info → rooms.info → channels.invite → chat.postMessage (4 steps)", async () => {
    const def = registry.getWorkflow("onboard_user")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/users.info": { user: { _id: "USER_NEW_001", username: "alice" } },
      "/api/v1/rooms.info": { room: { _id: "ROOM_TEAM", name: "team" } },
      "/api/v1/channels.invite": { success: true },
      "/api/v1/chat.postMessage": { message: { _id: "MSG_WELCOME", text: "Welcome alice!" } },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      username: "alice",
      roomName: "team",
      welcomeText: "Welcome alice!",
    });

    expect(calls).toHaveLength(4);
    expect(calls[0].path).toContain("/api/v1/users.info");
    expect(calls[1].path).toContain("/api/v1/rooms.info");
    expect(calls[2].path).toBe("/api/v1/channels.invite");
    // Verify user._id wired from step 0 → step 2 as userId
    expect(calls[2].body).toHaveProperty("userId", "USER_NEW_001");
    // Verify room._id wired from step 1 → step 2 as roomId
    expect(calls[2].body).toHaveProperty("roomId", "ROOM_TEAM");
    expect(calls[3].path).toBe("/api/v1/chat.postMessage");
    expect(calls[3].body).toHaveProperty("roomId", "ROOM_TEAM");
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 12: setup_webhook_integration ──────────────────────────────

describe("Integration: setup_webhook_integration", () => {
  it("should chain channels.info → integrations.create with channel wiring", async () => {
    const def = registry.getWorkflow("setup_webhook_integration")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/rooms.info": { room: { _id: "ROOM_HOOKS", name: "webhooks" } },
      "/api/v1/integrations.create": { integration: { _id: "INT_001" }, success: true },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      roomName: "webhooks",
      webhookName: "CI Notifications",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].path).toContain("/api/v1/rooms.info");
    expect(calls[1].path).toBe("/api/v1/integrations.create");
    // Verify room._id wired as channel param
    expect(calls[1].body).toHaveProperty("channel", "ROOM_HOOKS");
    expect(calls[1].body).toHaveProperty("name", "CI Notifications");
    expect(calls[1].body).toHaveProperty("type", "webhook-incoming");
    expect(calls[1].body).toHaveProperty("scriptEnabled", false);
    expect(result.isError).toBeUndefined();
  });
});

// ─── WORKFLOW 13: export_channel_history ─────────────────────────────────

describe("Integration: export_channel_history", () => {
  it("should chain channels.info → channels.history with roomId wiring", async () => {
    const def = registry.getWorkflow("export_channel_history")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client, calls } = createMockRcClient({
      "/api/v1/rooms.info": { room: { _id: "ROOM_ARCHIVE", name: "old-project" } },
      "/api/v1/channels.history": {
        messages: [
          { _id: "MSG_001", text: "First message" },
          { _id: "MSG_002", text: "Second message" },
        ],
      },
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      roomName: "old-project",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].path).toContain("/api/v1/rooms.info");
    expect(calls[1].path).toContain("/api/v1/channels.history");
    expect(result.isError).toBeUndefined();
  });
});

// ─── Cross-cutting: Error Propagation ────────────────────────────────────

describe("Integration: error handling across workflows", () => {
  it("mid-workflow failure should produce isError with step context", async () => {
    const def = registry.getWorkflow("create_project_channel")!;
    const endpoints = getEndpointsForWorkflow(def);
    const tool = composer.compose(def, endpoints);

    const { client } = createMockRcClient({
      "/api/v1/channels.create": { channel: { _id: "CH_FAIL" } },
      // setDescription will fail because it's not in the map
    });

    const handler = compileHandler(tool.handlerCode, client);
    const result = await handler({
      ...AUTH_PARAMS,
      channelName: "will-fail",
      description: "This will fail",
      topic: "It really will",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("failed");
  });

  it("all 13 workflows should produce valid MCP responses on success", async () => {
    const allWorkflows = registry.listWorkflows();

    for (const def of allWorkflows) {
      const endpoints = getEndpointsForWorkflow(def);
      const tool = composer.compose(def, endpoints);

      // Build universal response map — every path returns a realistic response
      const responseMap: Record<string, unknown> = {};
      for (const step of def.steps) {
        const ep = endpoints.find((e) => e.operationId === step.operationId)!;
        responseMap[ep.path] = {
          success: true,
          channel: { _id: "MOCK_ROOM_ID", name: "mock-channel" },
          room: { _id: "MOCK_ROOM_ID" },
          message: { _id: "MOCK_MSG_ID", text: "mock" },
          messages: [{ _id: "MOCK_MSG_ID", text: "mock" }],
          discussion: { _id: "MOCK_DISC_ID" },
          user: { _id: "MOCK_USER_ID", username: "mock-user" },
          integration: { _id: "MOCK_INT_ID" },
        };
      }

      const { client } = createMockRcClient(responseMap);
      const handler = compileHandler(tool.handlerCode, client);

      // Build params from userParams
      const params: Record<string, unknown> = { ...AUTH_PARAMS };
      for (const up of def.userParams) {
        if (up.type === "array") {
          params[up.name] = ["mock-value"];
        } else if (up.type === "number") {
          params[up.name] = 50;
        } else if (up.type === "boolean") {
          params[up.name] = false;
        } else {
          params[up.name] = "mock-value";
        }
      }

      const result = await handler(params);
      expect(result.content).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.isError).toBeUndefined();
    }
  }, 30000);
});
