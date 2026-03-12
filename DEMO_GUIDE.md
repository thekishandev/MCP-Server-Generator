# 🚀 Rocket.Chat Minimal MCP Server Generator: The Ultimate Demo Guide

This guide provides a comprehensive, start-to-finish script for demonstrating the power of your `rc-mcp` MVP using the `gemini-cli`. It's designed to highlight every core capability: AI Discovery, Progressive Disclosure, Deterministic Generation, your rigorous Definition of Done, and the new Context Management best practices.

---

## 🏗️ Phase 1: Setup & Initialization

First, ensure your extension is linked. You've likely already done this, but it's good to verify.

1.  **Open your terminal and navigate to the project directory:**
    ```bash
    cd ~/MCP-Server-Generator
    ```
2.  **Build the project (just to be safe):**
    ```bash
    npm run build
    ```
3.  **Link the extension (if not already linked) and start Gemini:**
    ```bash
    gemini extensions link .
    gemini
    ```

---

## 🎯 Phase 2: The "Vague Intent" Test (AI Discovery)

This test proves that the LLM can take a vague human request and map it to specific Rocket.Chat operation IDs without hallucinating.

**Enter this prompt in `gemini`:**

> _"I need an MCP server that lets an AI agent see who is currently in a specific channel, and then kick a user out if they are being disruptive. What endpoints do I need?"_

**Expected Behavior:**

1.  Gemini will read `GEMINI.md` and realize it needs to map intent to domains.
2.  It will likely use the `rc_suggest_endpoints` tool with your vague intent.
3.  **The Magic:** You should see it return a clean capability name (thanks to our recent fix!) like `channels-kick` and the exact operationIds required (e.g., `get-api-v1-channels-members`, `post-api-v1-channels-kick`).

---

## 🔍 Phase 3: The "Progressive Disclosure" Test (Context Management)

This test shows how `rc-mcp` avoids context bloat by not dumping the entire OpenAPI spec into the chat window.

**Enter this prompt in `gemini`:**

> _"Actually, before we generate that, I also want to add the ability to manage custom emoji. Can you discover the endpoints for that domain? Show me the tags first, don't expand them yet."_

**Expected Behavior:**

1.  Gemini will consult `GEMINI.md` and map "emoji" to the `content-management` domain.
2.  It will call `rc_discover_endpoints` with `{"domains": ["content-management"]}` and **NO** `expand` argument.
3.  **The Magic:** You will see a clean, grouped summary (e.g., `Custom Emoji (6 endpoints)`), saving massive amounts of token context.

_Now, follow up to expand:_

> _"Great, expand the 'Custom Emoji' tag so I can see the exact operationIds we need."_

**Expected Behavior:**

1.  It calls `rc_discover_endpoints` again, this time with `{"domains": ["content-management"], "expand": ["Custom Emoji"]}`.
2.  You will see only the 6 specific endpoints expanded.

---

## 🏭 Phase 4: The "Deterministic Generation" Test

Now, let's combine the results and actually generate the minimal server.

**Enter this prompt:**

> _"Okay, let's generate a server called 'rc-moderator-tools' in the directory `~/rc-moderator-test`. Include the endpoints for getting channel members, kicking a user, and listing custom emoji. Go ahead and do this automatically."_

**Expected Behavior:**

1.  Gemini identifies the correct `operationIds` from the previous steps.
2.  It calls `rc_generate_server` with the specified output directory and endpoints.
3.  **The Magic:** It should automatically detect that these endpoints require authentication and **silently inject the login endpoint**, resulting in 4 total endpoints being generated.

---

## 📐 Phase 5: The "Definition of Done" Test (Validation & Minimality)

This is the climax of the demo, proving the value proposition of the entire project.

**Enter this prompt:**

> _"Now run the full definition of done checks on `~/rc-moderator-test`. Make sure to use deep validation."_

**Expected Behavior:**

1.  Gemini calls `rc_validate_server` with `{"serverDir": "~/rc-moderator-test", "deep": true}`.
    - **The Magic:** You will see the newly added **Zod Schema & Tool Coverage** checks pass, and the **Deep TypeScript Compilation** run successfully.
2.  Gemini calls `rc_analyze_minimality`.
    - **The Magic:** You will see the beautiful minimality report. Look for the "Token Reduction" stat—it should prove a massive reduction (e.g., 99%+) compared to the full 558 API surface.

---

## 🧹 Phase 6: The "Context Cleansing" Test

This tests the new Claude Code best practices we just implemented.

**Enter this prompt:**

> _"That was perfect. Now, I want to switch gears completely and build a server for managing Omnichannel agents. Please clear the context so we don't confuse the two workflows."_

**Expected Behavior:**

1.  Gemini should acknowledge the instruction and use its native clear mechanism (often `/clear` or starting a new session block) to discard the context of the moderator server.

---

### 🎉 Demo Complete!

If you follow this script, you will have successfully demonstrated:

1.  **AI mapping vague human intent to deterministic API endpoints.**
2.  **Browsing a massive API natively without hitting token limits.**
3.  **Zero-LLM, strictly deterministic code scaffolding.**
4.  **Auto-injection of required dependencies (login).**
5.  **Rigorous, provable context reduction (minimality analysis).**
6.  **Enterprise-grade QA (deep type checking, zod validation, test coverage).**
