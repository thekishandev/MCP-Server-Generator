# 🚀 Rocket.Chat Minimal MCP Server Generator: The Ultimate Demo Guide

This guide provides a comprehensive, start-to-finish script for demonstrating the power of `rc-mcp` MVP natively inside `gemini-cli`. 

It is designed to highlight the evolution from hardcoded capability registries to the massive **dynamic 547-endpoint scope**, powered by the **V4 Suggest Engine**. 

You'll demonstrate AI Discovery (Semantic Mapping, Text Search, Progressive Disclosure), zero-LLM Deterministic Generation, rigorous Quality Assurance (Definition of Done), and Mathematical Minimality Proving.

---

## 🏗️ Phase 0: Setup & Initialization

First, ensure your extension is linked so the Gemini agent has access to your native tools.

1. **Navigate to the project and build:**
   ```bash
   cd ~/MCP-Server-Generator
   npm run build
   ```
2. **Link the extension and start Gemini:**
   ```bash
   gemini extensions link .
   gemini
   ```

---

## 🧠 Phase 1: The "Complex Multi-Domain Intent" Test (V4 Engine)

This test proves the V4 Engine's ability to take a complex, overlapping human request and map it simultaneously to multiple distinct API clusters using TF-IDF field-weighting and synonym expansion.

**Enter this prompt in `gemini`:**

> _"I need an MCP server to build a Customer Support Bot. It needs to look at visitor inquiries, transfer active chats to a specific department, and use canned responses. What endpoints do I need?"_

**Expected Behavior & The Magic:**
1. Gemini will see the tools and call **`rc_suggest_endpoints`**.
2. **The Magic:** The V4 Engine will semantically map the vague words "transfer" and "inquiries" using its synonym bridge.
3. It will return multiple highly relevant clusters back to the LLM (e.g., Omnichannel Visitors, Livechat Departments, Canned Responses) out of 547 total endpoints.

---

## 🔍 Phase 2: The "Precision Gap Filling" Test (rc_search)

Sometimes the human intent is very specific, or an obscure corner case is missed by the semantic engine. This shows how the agent can use full-text indexing to find exact endpoints.

**Enter this prompt in `gemini`:**

> _"Actually, I also need to make sure the bot can forward a specific room to another agent by ID. Find the exact operation for forwarding a livechat room."_

**Expected Behavior & The Magic:**
1. Gemini realizes it needs a specific operation and uses the **`rc_search_endpoints`** tool with a targeted query like `{"query": "forward", "domains": ["omnichannel"]}`.
2. **The Magic:** The agent precisely spotlights `livechat.room.forward`, demonstrating it doesn't always have to rely on broad semantic clusters.

---

## 🗂️ Phase 3: The "Progressive Disclosure" Test (rc_discover)

This test shows how `rc-mcp` prevents context bloat natively when exploring the massive OpenAPI surface.

**Enter this prompt in `gemini`:**

> _"I think we might also need to manage users. Can you discover what endpoints exist in the user-management domain? Show me the tags first, don't expand them yet."_

**Expected Behavior & The Magic:**
1. Gemini calls **`rc_discover_endpoints`** with `{"domains": ["user-management"]}` and **NO** `expand` argument.
2. **The Magic:** It returns a clean, grouped summary (e.g., `Users (32 endpoints)`, `Roles (5 endpoints)`). This prevents dumping 10,000 lines of YAML into the chat, saving massive amounts of tokens.

_Now, follow up to expand:_

> _"Great, expand the 'Roles' tag so I can see what's available."_

**Expected Behavior:**
1. It calls `rc_discover_endpoints` again with `{"domains": ["user-management"], "expand": ["Roles"]}`.
2. You will see only the 5 specific Roles endpoints expanded to the LLM context.

---

## 🧩 Phase 4: The "Platform-Level Workflow" Test (rc_list_workflows)

This test proves the generator isn't just creating 1:1 API wrappers, but can compose multiple endpoints into single, platform-level operations (e.g., looking up a channel ID and posting a message in one tool call).

**Enter this prompt in `gemini`:**

> _"I also want to use a higher-level workflow for sending messages instead of raw endpoints. Can you list the available composite workflows?"_

**Expected Behavior & The Magic:**
1. Gemini calls **`rc_list_workflows`**.
2. **The Magic:** It returns a concise list of 13 predefined composite workflows (e.g., `send_message_to_channel`, `onboard_user`). This shows that the MVP can map complex sequential boundaries into single Zod schemas.

---

## 🏭 Phase 5: The "Deterministic Generation" Test

Now, we hand off the intelligence layer to the deterministic pipeline.

**Enter this prompt:**

> _"Okay, let's generate the server. Create it in `~/rc-support-bot`. Include the endpoints for transferring visitors, forwarding a room, and getting roles, and add the `send_message_to_channel` workflow. Do this automatically."_

**Expected Behavior & The Magic:**
1. Gemini identifies the final, minimal set of `operationIds` and `workflows` from the previous phases.
2. It calls **`rc_generate_server`** with the chosen output directory.
3. **The Magic:** The Server Scaffolder surgically extracts just those tiny interfaces from the 2.2MB OpenAPI YAML trees using `$ref` recursion. It will also seamlessly auto-inject `authToken` and `userId` directly into each tool's Zod parameters — entirely eliminating the need for a separate login tool!

---

## 📐 Phase 6: The "Cost Reduction" Test (Minimality Proving)

This is the pitch for why this tool was built: drastically reducing Agent iteration costs.

**Enter this prompt:**

> _"Now analyze the minimality on `~/rc-support-bot` to show me how much context we actually saved."_

**Expected Behavior & The Magic:**
1. Gemini calls **`rc_analyze_minimality`**.
2. **The Magic:** You'll receive a mathematical pruning report proving that the generated server exposes only a handful of tools instead of 547, shrinking the schema payload by 99%+ and saving over ~114,000 tokens per agent interaction loop!

---

## 🛡️ Phase 7: The "Definition of Done" Test (Deep Validation)

This shows that the generation pipeline didn't just dump code—it generated enterprise-grade TypeScript.

**Enter this prompt:**

> _"Run the deep validation checks on `~/rc-support-bot` to confirm the code is production-ready."_

**Expected Behavior & The Magic:**
1. Gemini calls **`rc_validate_server`** with `deep: true`.
2. **The Magic:** It runs a barrage of 20 architectural checks:
   - Dynamic Vitest stubs verifying Zod coverage for every tool
   - Execution of `tsc --noEmit` inside the generated project
   - Success confirms 100% type safety.

---

## 🧹 Phase 8: The "Context Cleansing" Test (Best Practices)

To cap off the demo, show off the proper way to manage an LLM context window.

**Enter this prompt:**

> _"That was perfect. Now, I want to switch gears completely and build a server for monitoring engagement statistics. Please clear the context so we don't confuse the two workflows."_

**Expected Behavior:**
1. Gemini acknowledges the instruction and uses its native clear mechanism (or advises you to start a new session / type `/clear`) to discard the context of the Support Bot server, ensuring zero cross-pollination.

---

### 🎉 Demo Complete!

If you follow this script, you will have successfully demonstrated:

1. **AI mapping complex human intent to multiple API clusters natively (V4 Engine).**
2. **Precision gap-filling using full-text search across 547 endpoints.**
3. **Browsing a massive API entirely natively via progressive disclosure.**
4. **Composing multi-endpoint platform-level operations via the Workflow Registry.**
5. **Zero-LLM, strictly deterministic code scaffolding ($ref recursion).**
6. **Collision-safe per-request auth injection (eliminating login tools).**
7. **Rigorous, provable context reduction (minimality analysis).**
8. **Enterprise-grade QA (deep type checking, Zod validation, test coverage).**
