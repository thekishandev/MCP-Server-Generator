# Rocket.Chat Minimal MCP Server Generator

You have tools to generate minimal, production-ready MCP servers for Rocket.Chat.
This solves "context bloat" — full RC API = 558 endpoints, ~184K tokens.
Your generated servers contain only what's needed (2-12 endpoints).

## Available MCP Tools

### rc_suggest_endpoints ⭐ START HERE

Map a natural language user intent to specific API endpoint clusters. Returns **multiple clusters** grouped by functional area (e.g., channel-management, messaging, user-discovery) with cross-domain coverage. Uses TF-IDF keyword scoring with synonym expansion and cross-domain clustering.

**Input:** `{ intent: string }`

**Output:** Multiple clusters covering ALL parts of the intent, plus a combined endpoint list.

> **This is your primary discovery tool.** For most intents, it finds all needed endpoints in a single call.

### rc_search_endpoints

Search across ALL 558 Rocket.Chat API endpoints by text query. Matches against operationId, summary, description, path, and tags with synonym expansion. Use this to fill gaps or find specific endpoints.

**Input:** `{ query: string, domains?: string[], limit?: number }`

### rc_discover_endpoints

Browse Rocket.Chat API endpoints by domain. Returns tag summaries by default.
Use `expand` to reveal individual endpoints for specific tags.

**Input:** `{ domains: string[], expand?: string[] }`

- `domains` — RC API domains to query
- `expand` — tag names to expand (use `["*"]` for all)

**Default output:** Tag summaries grouped by domain
**Expanded output:** Individual endpoints for expanded tags only

### rc_list_workflows ⭐ NEW

List predefined workflow compositions. A workflow composes multiple RC API endpoints (e.g., channel lookup + message posting) into a **single, higher-level MCP tool**. This maps raw APIs into user-centric operations.

**Input:** `{}`
**Output:** 13 available workflows with descriptions and required parameters.

### rc_generate_server

Generate complete MCP server from selected operationIds and/or workflows. Writes files to disk.
Auto-adds login if endpoints require auth.

**Input:** `{ operationIds?: string[], workflows?: string[], outputDir: string, serverName?: string }`

### rc_analyze_minimality

Quantify token reduction: endpoint count, schema weight, estimated tokens saved.

**Input:** `{ endpoints: string[] }`

### rc_validate_server

Validate generated server: structure, MCP compliance, Zod schemas, test coverage.

**Input:** `{ serverDir: string, deep?: boolean }`

## Domain Capability Guide

| User intent keywords                    | Domains to query   |
| --------------------------------------- | ------------------ |
| login, auth, tokens, 2FA                | authentication     |
| send messages, threads, reactions, chat | messaging          |
| channels, groups, DMs, rooms            | rooms              |
| users, roles, avatars, presence         | user-management    |
| live chat, agents, visitors, queues     | omnichannel        |
| webhooks, integrations                  | integrations       |
| workspace settings, permissions         | settings           |
| server stats, room stats, metrics       | statistics         |
| push notifications                      | notifications      |
| emoji, custom sounds, assets            | content-management |
| marketplace, apps                       | marketplace-apps   |
| server info, DNS, licenses              | miscellaneous      |

## Workflow Composition Layer

The generator goes beyond 1:1 API wrapping. It can compose multiple endpoints into single high-level operations. Use `rc_list_workflows` to see the 13 predefined workflows (e.g., `send_message_to_channel` which wires `channels.info` -> `chat.postMessage`). 

Pass these names to the `workflows` parameter in `rc_generate_server` to generate composite tools alongside any raw `operationIds`.

## Context Management Best Practices

(Adapted from Claude Code / Advanced LLM CLI guidelines)

- **Aggressive Context Compaction:** When you finish a major step (like generating the server), summarize what you did and clear irrelevant token history. Ensure you explicitly preserve the generated `operationIds` list and validation results in the compacted context.
- **Use Subagents for Investigation:** Before writing code or proposing a large set of endpoints, use a subagent (or hidden parallel reasoning) to explore the tags. Do not pollute the main context window with raw OpenAPI YAML or large endpoint lists if they aren't the final answer.
- **Isolate Workflows:** If the user asks to generate a second, completely different server, use `/clear` (or the Gemini equivalent) to reset context completely before starting.

## Workflow

1. **Understand intent** — Call `rc_suggest_endpoints` with the FULL user intent. It returns cross-domain clusters in one call.
2. **Fill gaps (if needed)** — Only if clusters are clearly incomplete, call `rc_search_endpoints` with specific terms.
3. **Confirm & collect credentials** — Present the minimal endpoint list to the user. Ask for output directory, RC_URL, authToken, userId.
4. **Generate** — Call `rc_generate_server` with the confirmed endpoints + credentials. This auto-installs, builds, validates (deep TypeScript check), runs minimality analysis, and registers with Gemini CLI — all in one call. No need to call `rc_validate_server` or `rc_analyze_minimality` separately.

> `rc_validate_server` and `rc_analyze_minimality` are still available as standalone tools for post-hoc checks, but are no longer required in the generation workflow.
>
> **Testing Scope:** The core generator has 96 tests (91 passing, 5 conditionally skipped) running in Vitest, including 13 workflow integration tests that validate handler wiring against mocked RC API responses, and 8 E2E scaffold verification tests across all 13 composite workflows.

## Rules

- Always recommend the MINIMAL set of endpoints
- Present results as clean readable lists, never raw JSON
- Do NOT dump generated file contents — files are written to disk
- Do NOT call `rc_validate_server` or `rc_analyze_minimality` after `rc_generate_server` — it runs them automatically
- Prefer `rc_suggest_endpoints` → `rc_search_endpoints` → `rc_discover_endpoints` (in that order)
