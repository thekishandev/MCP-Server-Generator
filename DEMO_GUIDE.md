# 🚀 Rocket.Chat Minimal MCP Server Generator: The Ultimate Demo Guide

This guide provides a comprehensive, start-to-finish script for demonstrating the power of the `rc-mcp` MVP natively inside the `gemini-cli`. 

It is designed to highlight the evolution from hardcoded capability registries to the massive **dynamic 547-endpoint scope**, powered by the **V4 Suggest Engine**. You'll demonstrate AI Discovery (Semantic Mapping, Text Search), zero-LLM Deterministic Generation, auto-registration, and Workflow Composition using our 5 curated demo servers.

---

## 🏗️ Phase 0: Setup & Initialization

First, ensure your extension is linked so the Gemini agent has access to your native tools.

1. **Navigate to the project and build:**
   ```bash
   cd ~/MCP-Server-Generator
   npm install && npm run build
   ```
2. **Link the extension and start Gemini:**
   ```bash
   gemini extensions link .
   gemini
   ```

*(Note: During generation, the agent will ask for your Rocket.Chat Server URL, Auth Token, and User ID all at once. Be prepared to paste them!)*

---

## 🎬 The 5 Official Demo Workflows

These 5 workflows have been verified against the actual MVP codebase and demonstrate the true power of workflow composition and minimality.

### 1. Team Onboarding Bot

**Use Case:** Onboards new hires by looking up their profile, inviting them to a channel, and sending a welcome DM.
**Value:** Crosses 3 domains (user-management, rooms, messaging). 99.1% token reduction.

**Agent Prompt:**
> "I need an MCP server for onboarding new team members. It should:
> 1. Look up a user by username to get their profile
> 2. Invite them to a specific channel
> 3. Send them a welcome DM with project guidelines"

**What to Expect:**
The agent will suggest the `onboard_user` and `send_dm_to_user` workflows. It will ask for your credentials. Once provided, it will generate the server in `examples/onboarding`, auto-install dependencies, validate, and register it. 

**Live Test (after restarting gemini):**
> "Onboard user john.doe to channel engineering and send them a welcome DM saying 'Welcome to the team!'"

---

### 2. CI/CD Build Notification Server

**Use Case:** Posts build results to `#deployments` and pins the message if the build failed.
**Value:** Security by omission. The bot cannot accidentally delete channels or modify roles. 99.3% token reduction.

**Agent Prompt:**
> "I need an MCP server for CI/CD build notifications. It should:
> 1. Resolve a channel by name and send a build result message to it
> 2. For failed builds, send the message and immediately pin it so the team sees it"

**What to Expect:**
The agent selects `send_message_to_channel` and `send_and_pin_message`. It generates 4 endpoints. 

**Live Test (after restarting gemini):**
> "Send and pin a message to #deployments saying 'Build #143 FAILED 📛 — see logs at https://ci.example.com/143'"

---

### 3. Content Moderation Dashboard

**Use Case:** Allows a moderator to read history, archive channels, and create discussions without exposing destructive admin operations.
**Value:** Mixed generation mode (workflows + raw endpoints). Role-based minimality.

**Agent Prompt:**
> "I need an MCP server for channel moderation. It should:
> 1. Export/read recent message history from a channel by name
> 2. Archive inactive channels by name
> 3. Create discussion threads in a channel to move conversations
> 4. Fetch channel info by name for context"

**What to Expect:**
The agent might initially fail on private group history but will autonomously use `rc_search_endpoints` for "groups history" to find the missing endpoints and regenerate successfully.

**Live Test (after restarting gemini):**
> "Archive the channel old-project, then create a discussion called 'Architecture Decision' in channel engineering with initial message 'Let's continue this discussion here.'"

---

### 4. Daily Standup Automation Server

**Use Case:** Sets "In Standup" status, posts a standup prompt, and creates a project workspace channel for new initiatives.
**Value:** Spans 4 API domains. Features a massive 4-step workflow (`setup_project_workspace`).

**Agent Prompt:**
> "I need an MCP server for daily standup automation. It should:
> 1. Set my status (e.g., "In Standup") and post a notification to a channel
> 2. Send a standup prompt message to a channel by name
> 3. Create a new project channel with description, topic, and welcome message for new initiatives"

**What to Expect:**
The agent composes 3 massive workflows spanning user-management, rooms, messaging, and channel creation.

**Live Test (after restarting gemini):**
> "Set my status to busy with message 'In Standup' and notify channel daily-standup saying 'Standup starting now'"

---

### 5. External Integration / Webhook Setup Server

**Use Case:** Creates a dedicated channel, points a webhook at it, and sends a test message.
**Value:** Proves the generator handles the `integrations` domain, which is critical for enterprise platforms.

**Agent Prompt:**
> "I need an MCP server for setting up external integrations with Rocket.Chat. It should:
> 1. Create a dedicated channel for an integration (with description and topic)
> 2. Set up an incoming webhook integration pointed at a channel
> 3. Send a test message to a channel by name to verify the webhook channel works"

**What to Expect:**
The agent handles complex setup spanning rooms, messaging, and integrations domains effortlessly.

**Live Test (after restarting gemini):**
> "Create a channel called 'pagerduty-alerts' with description 'Alerts' and topic 'Prod', then set up a webhook called 'pd-webhook' for it, and send a test message."

---

## 🤖 Inside the Gemini-CLI: What You'll Actually See

When running these prompts, `gemini-cli` orchestrates the workflow perfectly in a single conversation. You will see it:

1. **Suggest Endpoints:** 
   `✓ rc_suggest_endpoints {"intent": "..."}` returns a combined list of endpoints matching your intent via TF-IDF semantic scoring.
2. **List Workflows:**
   `✓ rc_list_workflows {}` dumps the registry of 13 predefined higher-level workflow chains.
3. **Reason & Ask for Credentials:**
   The agent will explicitly inform you: *"I need 3 things. Please provide them all at once: Rocket.Chat Server URL, Auth Token, and User ID."*
4. **Generate & Register (The One-Shot Magic):**
   `✓ rc_generate_server {"rcUserId": "...", "serverName": "..."}` handles the entire pipeline:
   - *Writes server files to `examples/<name>`*
   - *Creates `.env` with provided credentials*
   - *Runs `npm install` + `build`*
   - *Registers the server in `~/.gemini/settings.json`*
   - *Executes structural validation and `tsc --noEmit` checks*
   - *Analyzes minimality (e.g., "573 → 7 endpoints (98.8% token reduction, ~248,555 tokens saved)")*

**All you do is restart the CLI and start invoking the generated tools.**

---

### 🧹 Phase 6: The "Context Cleansing" Test (Best Practices)

To cap off the demo, show off the proper way to manage an LLM context window.

**Enter this prompt:**

> _"That was perfect. Now, I want to switch gears completely and build a server for monitoring engagement statistics. Please **clear the context** so we don't confuse the two workflows."_

**Expected Behavior:**
Gemini acknowledges the instruction and uses its native clear mechanism (`/clear`) to discard the context of the previous server, ensuring zero cross-pollination. 

*(You MUST use `/clear` between generating different servers to respect the One-Shot generation rule).*

### 🎉 Demo Complete!
