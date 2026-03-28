/**
 * Workflow Registry
 *
 * Predefined workflow definitions that map high-level platform operations
 * to sequences of Rocket.Chat API calls. Each workflow composes 2-5 raw
 * endpoints into a single MCP tool, addressing the GSoC requirement that
 * "MCP servers typically address much higher (platform) level operations."
 *
 * Design: Every step carries explicit `parameterMappings` — the composer
 * never hardcodes field names. This makes the registry extensible to
 * arbitrary OpenAPI specs in the future (Phase 4 genericity).
 *
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, extname } from "path";
import type { WorkflowDefinition } from "./types.js";

// ─── The 13 Predefined Workflows ──────────────────────────────────────

const WORKFLOWS: WorkflowDefinition[] = [
  // ── 1. Send Message to Channel ────────────────────────────────────
  {
    name: "send_message_to_channel",
    description:
      "Resolve a channel by name and send a message to it. Combines channel lookup + message posting into one operation.",
    steps: [
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Look up channel by name to get its _id",
      },
      {
        operationId: "post-api-v1-chat.postMessage",
        parameterMappings: [
          { fromStep: 0, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Send message to the resolved channel",
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
  },

  // ── 2. Create Project Channel ─────────────────────────────────────
  {
    name: "create_project_channel",
    description:
      "Create a new channel and configure it with a description and topic in one operation.",
    steps: [
      {
        operationId: "post-api-v1-channels.create",
        parameterMappings: [],
        description: "Create the channel",
      },
      {
        operationId: "post-api-v1-channels.setDescription",
        parameterMappings: [
          { fromStep: 0, fromField: "channel._id", toParam: "roomId" },
        ],
        description: "Set channel description",
      },
      {
        operationId: "post-api-v1-channels.setTopic",
        parameterMappings: [
          { fromStep: 0, fromField: "channel._id", toParam: "roomId" },
        ],
        description: "Set channel topic",
      },
    ],
    userParams: [
      {
        name: "channelName",
        type: "string",
        required: true,
        description: "Name for the new channel",
        forStep: 0,
        asParam: "name",
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Channel description",
        forStep: 1,
        asParam: "description",
      },
      {
        name: "topic",
        type: "string",
        required: false,
        description: "Channel topic",
        forStep: 2,
        asParam: "topic",
      },
    ],
  },

  // ── 3. Invite Users to Channel ────────────────────────────────────
  {
    name: "invite_users_to_channel",
    description:
      "Resolve a channel by name and invite a user to it. Combines channel lookup + user invite into one operation.",
    steps: [
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Look up channel by name",
      },
      {
        operationId: "post-api-v1-channels.invite",
        fallbackOperationId: "post-api-v1-groups.invite",
        parameterMappings: [
          { fromStep: 0, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Invite user to the resolved channel",
      },
    ],
    userParams: [
      {
        name: "channelName",
        type: "string",
        required: true,
        description: "Channel name to invite users to",
        forStep: 0,
        asParam: "roomName",
      },
      {
        name: "userId",
        type: "string",
        required: true,
        description: "User ID to invite",
        forStep: 1,
        asParam: "userId",
      },
    ],
  },

  // ── 4. Create Discussion in Channel ───────────────────────────────
  {
    name: "create_discussion_in_channel",
    description:
      "Resolve a channel by name and create a threaded discussion in it.",
    steps: [
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Look up channel by name",
      },
      {
        operationId: "post-api-v1-rooms.createDiscussion",
        parameterMappings: [
          { fromStep: 0, fromField: "room._id", toParam: "prid" },
        ],
        description: "Create a discussion in the resolved channel",
      },
    ],
    userParams: [
      {
        name: "channelName",
        type: "string",
        required: true,
        description: "Parent channel name",
        forStep: 0,
        asParam: "roomName",
      },
      {
        name: "discussionName",
        type: "string",
        required: true,
        description: "Title of the discussion",
        forStep: 1,
        asParam: "t_name",
      },
      {
        name: "initialMessage",
        type: "string",
        required: false,
        description: "Initial message for the discussion",
        forStep: 1,
        asParam: "reply",
      },
    ],
  },

  // ── 5. Send and Pin Message ───────────────────────────────────────
  {
    name: "send_and_pin_message",
    description:
      "Send a message to a room and immediately pin it. Combines posting + pinning into one operation.",
    steps: [
      {
        operationId: "post-api-v1-chat.postMessage",
        parameterMappings: [],
        description: "Send the message",
      },
      {
        operationId: "post-api-v1-chat.pinMessage",
        parameterMappings: [
          { fromStep: 0, fromField: "message._id", toParam: "messageId" },
        ],
        description: "Pin the sent message",
      },
    ],
    userParams: [
      {
        name: "roomId",
        type: "string",
        required: true,
        description: "Room/channel ID to send message to",
        forStep: 0,
        asParam: "roomId",
      },
      {
        name: "text",
        type: "string",
        required: true,
        description: "Message text to send and pin",
        forStep: 0,
        asParam: "text",
      },
    ],
  },

  // ── 6. Send DM to User ────────────────────────────────────────────
  {
    name: "send_dm_to_user",
    description:
      "Open a direct message conversation with a user and send them a message.",
    steps: [
      {
        operationId: "post-api-v1-im.create",
        parameterMappings: [],
        description: "Create/open a DM with the target user",
      },
      {
        operationId: "post-api-v1-chat.postMessage",
        parameterMappings: [
          { fromStep: 0, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Send message in the DM",
      },
    ],
    userParams: [
      {
        name: "username",
        type: "string",
        required: true,
        description: "Username to send DM to",
        forStep: 0,
        asParam: "username",
      },
      {
        name: "text",
        type: "string",
        required: true,
        description: "Message text",
        forStep: 1,
        asParam: "text",
      },
    ],
  },

  // ── 7. Set Status and Notify ───────────────────────────────────────
  {
    name: "set_status_and_notify",
    description:
      "Set your status, resolve a channel by name, and post a status update message to it. Chains user-management + rooms + messaging.",
    steps: [
      {
        operationId: "post-api-v1-users.setStatus",
        parameterMappings: [],
        description: "Set user status",
      },
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Resolve notification channel by name",
      },
      {
        operationId: "post-api-v1-chat.postMessage",
        parameterMappings: [
          { fromStep: 1, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Post status update message to the channel",
      },
    ],
    userParams: [
      {
        name: "statusText",
        type: "string",
        required: false,
        description: "Custom status message text",
        forStep: 0,
        asParam: "message",
      },
      {
        name: "status",
        type: "string",
        required: false,
        description: "Online status: online, away, busy, offline",
        forStep: 0,
        asParam: "status",
      },
      {
        name: "notifyChannel",
        type: "string",
        required: true,
        description: "Channel name to post status update to",
        forStep: 1,
        asParam: "roomName",
      },
      {
        name: "notifyMessage",
        type: "string",
        required: true,
        description: "Status update message to post in the channel",
        forStep: 2,
        asParam: "text",
      },
    ],
  },

  // ── 8. Archive Channel ────────────────────────────────────────────
  {
    name: "archive_channel",
    description:
      "Resolve a channel by name and archive it. Combines lookup + archive into one operation.",
    steps: [
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Look up channel by name",
      },
      {
        operationId: "post-api-v1-channels.archive",
        fallbackOperationId: "post-api-v1-groups.archive",
        parameterMappings: [
          { fromStep: 0, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Archive the channel",
      },
    ],
    userParams: [
      {
        name: "channelName",
        type: "string",
        required: true,
        description: "Channel name to archive",
        forStep: 0,
        asParam: "roomName",
      },
    ],
  },

  // ── 9. Setup Project Workspace ─────────────────────────────────────
  {
    name: "setup_project_workspace",
    description:
      "Create a project channel, set its description and topic, then post a welcome message. Chains 4 API calls into one platform operation.",
    steps: [
      {
        operationId: "post-api-v1-channels.create",
        parameterMappings: [],
        description: "Create the project channel",
      },
      {
        operationId: "post-api-v1-channels.setDescription",
        parameterMappings: [
          { fromStep: 0, fromField: "channel._id", toParam: "roomId" },
        ],
        description: "Set the channel description",
      },
      {
        operationId: "post-api-v1-channels.setTopic",
        parameterMappings: [
          { fromStep: 0, fromField: "channel._id", toParam: "roomId" },
        ],
        description: "Set the channel topic",
      },
      {
        operationId: "post-api-v1-chat.postMessage",
        parameterMappings: [
          { fromStep: 0, fromField: "channel._id", toParam: "roomId" },
        ],
        description: "Post welcome message in the new channel",
      },
    ],
    userParams: [
      {
        name: "channelName",
        type: "string",
        required: true,
        description: "Name for the new project channel",
        forStep: 0,
        asParam: "name",
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Project channel description",
        forStep: 1,
        asParam: "description",
      },
      {
        name: "topic",
        type: "string",
        required: false,
        description: "Project channel topic",
        forStep: 2,
        asParam: "topic",
      },
      {
        name: "welcomeMessage",
        type: "string",
        required: false,
        description: "Welcome message to post in the new channel",
        forStep: 3,
        asParam: "text",
      },
    ],
  },

  // ── 10. React to Last Message ─────────────────────────────────────
  {
    name: "react_to_last_message",
    description:
      "Fetch the last message from a channel and add an emoji reaction to it.",
    steps: [
      {
        operationId: "get-api-v1-channels.history",
        fallbackOperationId: "get-api-v1-groups.history",
        parameterMappings: [],
        description: "Get the most recent message from the channel",
      },
      {
        operationId: "post-api-v1-chat.react",
        parameterMappings: [
          {
            fromStep: 0,
            fromField: "messages.0._id",
            toParam: "messageId",
          },
        ],
        description: "React to the last message",
      },
    ],
    userParams: [
      {
        name: "roomId",
        type: "string",
        required: true,
        description: "Channel/room ID to get the last message from",
        forStep: 0,
        asParam: "roomId",
      },
      {
        name: "emoji",
        type: "string",
        required: true,
        description: "Emoji to react with (e.g., :thumbsup:)",
        forStep: 1,
        asParam: "emoji",
      },
    ],
  },

  // ── 11. Onboard User ──────────────────────────────────────────────
  {
    name: "onboard_user",
    description:
      "Look up a user by username, resolve a room by name, invite them to the room, and send a welcome message. Spans user-management + rooms + messaging.",
    steps: [
      {
        operationId: "get-api-v1-users.info",
        parameterMappings: [],
        description: "Look up user by username",
      },
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Resolve the target room by name",
      },
      {
        operationId: "post-api-v1-channels.invite",
        fallbackOperationId: "post-api-v1-groups.invite",
        parameterMappings: [
          { fromStep: 0, fromField: "user._id", toParam: "userId" },
          { fromStep: 1, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Invite user to the resolved room",
      },
      {
        operationId: "post-api-v1-chat.postMessage",
        parameterMappings: [
          { fromStep: 1, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Send welcome message to the room",
      },
    ],
    userParams: [
      {
        name: "username",
        type: "string",
        required: true,
        description: "Username of the user to onboard",
        forStep: 0,
        asParam: "username",
      },
      {
        name: "roomName",
        type: "string",
        required: true,
        description: "Name of the room to invite the user to",
        forStep: 1,
        asParam: "roomName",
      },
      {
        name: "welcomeText",
        type: "string",
        required: true,
        description: "Welcome message to post in the room",
        forStep: 3,
        asParam: "text",
      },
    ],
  },

  // ── 12. Setup Webhook Integration ─────────────────────────────────
  {
    name: "setup_webhook_integration",
    description:
      "Resolve a room by name and create an incoming webhook integration for it. Spans integrations + rooms.",
    steps: [
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Look up target room by name",
      },
      {
        operationId: "post-api-v1-integrations-create",
        parameterMappings: [
          { fromStep: 0, fromField: "room._id", toParam: "channel" },
        ],
        fixedParams: {
          type: "webhook-incoming",
          username: "bot",
          scriptEnabled: false,
          enabled: true,
        },
        description: "Create incoming webhook integration",
      },
    ],
    userParams: [
      {
        name: "channelName",
        type: "string",
        required: true,
        description: "Room/Channel name to set up the webhook for",
        forStep: 0,
        asParam: "roomName",
      },
      {
        name: "webhookName",
        type: "string",
        required: true,
        description: "Name for the webhook integration",
        forStep: 1,
        asParam: "name",
      },
    ],
  },

  // ── 13. Export Channel History ─────────────────────────────────────
  {
    name: "export_channel_history",
    description:
      "Resolve a room by name and fetch its message history. Spans rooms + messaging.",
    steps: [
      {
        operationId: "get-api-v1-rooms.info",
        parameterMappings: [],
        description: "Look up room by name",
      },
      {
        operationId: "get-api-v1-channels.history",
        fallbackOperationId: "get-api-v1-groups.history",
        parameterMappings: [
          { fromStep: 0, fromField: "room._id", toParam: "roomId" },
        ],
        description: "Fetch message history",
      },
    ],
    userParams: [
      {
        name: "channelName",
        type: "string",
        required: true,
        description: "Room/Channel name to export history from",
        forStep: 0,
        asParam: "roomName",
      },
      {
        name: "count",
        type: "number",
        required: false,
        description: "Number of messages to fetch (default: 50)",
        forStep: 1,
        asParam: "count",
      },
    ],
  },
];

// ─── Registry API ────────────────────────────────────────────────────

export class WorkflowRegistry {
  /** Combined workflows: builtins (overridden by custom if same name) */
  private workflows: WorkflowDefinition[] = [...WORKFLOWS];

  /**
   * Get all workflow definitions (builtins + custom).
   */
  listWorkflows(): WorkflowDefinition[] {
    return this.workflows;
  }

  /**
   * Get a workflow definition by name.
   * Returns undefined if no workflow with that name exists.
   */
  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.workflows.find((w) => w.name === name);
  }

  /**
   * Get multiple workflow definitions by name.
   * Throws if any name is not found.
   */
  getWorkflows(names: string[]): WorkflowDefinition[] {
    return names.map((name) => {
      const workflow = this.getWorkflow(name);
      if (!workflow) {
        const available = this.workflows.map((w) => w.name).join(", ");
        throw new Error(
          `Workflow "${name}" not found. Available: ${available}`,
        );
      }
      return workflow;
    });
  }

  /**
   * Get all unique operationIds referenced across all workflows.
   */
  getAllOperationIds(): string[] {
    const ids = new Set<string>();
    for (const w of this.workflows) {
      for (const step of w.steps) {
        ids.add(step.operationId);
      }
    }
    return Array.from(ids);
  }

  /**
   * Get a concise summary of all workflows for the LLM.
   */
  getSummary(): string {
    return this.workflows.map(
      (w) =>
        `• ${w.name} (${w.steps.length} steps): ${w.description}`,
    ).join("\n");
  }

}
