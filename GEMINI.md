# Rocket.Chat Minimal MCP Server Generator

You have tools to generate minimal, production-ready MCP servers for Rocket.Chat.
This solves "context bloat" — full RC API = 558 endpoints, ~184K tokens.
Your generated servers contain only what's needed (2-12 endpoints).

## Available MCP Tools

### rc_suggest_endpoints ⭐ START HERE

Map a natural language user intent to specific API endpoint clusters. Returns **multiple clusters** grouped by functional area (e.g., channel-management, messaging, user-discovery) with cross-domain coverage. Uses synonym expansion and TF-IDF scoring.

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

### rc_generate_server

Generate complete MCP server from selected operationIds. Writes files to disk.
Auto-adds login if endpoints require auth.

**Input:** `{ endpoints: string[], outputDir: string, serverName?: string }`

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

## Context Management Best Practices

(Adapted from Claude Code / Advanced LLM CLI guidelines)

- **Aggressive Context Compaction:** When you finish a major step (like generating the server), summarize what you did and clear irrelevant token history. Ensure you explicitly preserve the generated `operationIds` list and validation results in the compacted context.
- **Use Subagents for Investigation:** Before writing code or proposing a large set of endpoints, use a subagent (or hidden parallel reasoning) to explore the tags. Do not pollute the main context window with raw OpenAPI YAML or large endpoint lists if they aren't the final answer.
- **Isolate Workflows:** If the user asks to generate a second, completely different server, use `/clear` (or the Gemini equivalent) to reset context completely before starting.

## Workflow

1. **Understand intent** — Call `rc_suggest_endpoints` with the FULL user intent. This now returns multi-cluster results covering channels, messaging, users, etc.
2. **Review clusters** — Check if the clusters cover ALL parts of the user's intent.
3. **Fill gaps** — If anything is missing, call `rc_search_endpoints` with specific terms (NOT `rc_discover_endpoints`).
4. **Recommend endpoints** — Combine the clusters into a minimal set, explain why each is needed.
5. **Confirm** — Let user adjust. Do NOT ask about output directory yet.
6. **Choose location** — Ask where to save.
7. **Generate** — Call `rc_generate_server`.
8. **Validate & Analyze** — Call `rc_validate_server` with `deep: true` + `rc_analyze_minimality`. Show the minimality report and validation results. Always use deep validation.

> **Key change:** `rc_suggest_endpoints` now returns cross-domain results in one call. You should rarely need `rc_discover_endpoints` anymore — use it only for open-ended exploration when the user is browsing, not searching.

## Rules

- Always recommend the MINIMAL set of endpoints
- Present results as clean readable lists, never raw JSON
- Do NOT dump generated file contents — files are written to disk
- Do NOT re-expand previously viewed tags
- Always run validate + analyze after generation (this is our Definition of Done)
- Always pass `deep: true` to `rc_validate_server` to verify TypeScript compilation
- Prefer `rc_suggest_endpoints` → `rc_search_endpoints` → `rc_discover_endpoints` (in that order)
