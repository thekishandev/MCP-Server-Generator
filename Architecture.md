# 📁 Project Architecture & File Breakdown

This project is built around a **two-layer design**: an optional AI Discovery layer that maps natural language → capability keys, and a strictly deterministic generation pipeline that turns those keys into production-ready MCP servers.

---

## 🏗️ Folder Structure Breakdown

### 1. `src/cli/` (The Entry Point)
* **`index.ts`**: Defines all 7 commands (`suggest`, `generate`, `list`, `analyze`, `fetch-specs`, `validate`, `integrate`) and wires them to the `src/core/` classes.

### 2. `src/core/` (The Engine)

#### AI Discovery Layer
* **`suggest-engine.ts`**: Powers `rc-mcp suggest "<intent>"`. Maps natural language to capability registry keys via one of two paths:
  - **Gemini mode** (when `GEMINI_API_KEY` is set): Single prompt to Gemini API (`v1` endpoint, model configurable via `GEMINI_MODEL` env var, default `gemini-2.0-flash`). Returns a JSON array of ranked suggestions.
  - **Keyword fallback** (no key needed): Tokenizes user intent and scores all capabilities by keyword overlap against descriptions and endpoint paths. Fully offline.
  - **Hallucination guard** (always active): Filters any capability names that don't exist in `capabilities.json` before they reach the UI.

#### Deterministic Generation Pipeline
* **`types.ts`**: TypeScript interfaces shared across the project (`CapabilityDefinition`, `EndpointSchema`, `GeneratedTool`, `SuggestionResult`).
* **`capability-resolver.ts`**: Maps capability names (e.g., `send-message`) to exact Rocket.Chat API paths (e.g., `/api/v1/chat.postMessage`).
* **`schema-extractor.ts`**: Loads the Rocket.Chat OpenAPI YAML files, finds requested endpoints, and recursively prunes all `$ref` dependencies — returning only the data models actually needed.
* **`tool-generator.ts`**: Converts pruned OpenAPI schemas into TypeScript Zod definitions + executable MCP tool handlers. Compresses descriptions to ≤120 chars to prevent description-level context bloat.
* **`server-scaffolder.ts`**: Assembles the complete MCP server project using Handlebars templates. Writes `server.ts`, per-tool files, `package.json`, `.env.example`, and smarter dynamic Zod schema `vitest` stubs.
* **`minimality-analyzer.ts`**: The `rc-mcp analyze` metrics engine. Compares minimal vs. full-API dimensions across endpoints, schema size, components, estimated tokens, and reports `$ref` recursive resolution depth.
* **`gemini-integration.ts`**: Generates the `.gemini-extension` folder for native `gemini-cli` installation when `--gemini` flag is passed.

### 3. `src/providers/rocketchat/` (The Configuration)
* **`capabilities.json`**: The deterministic registry — maps 5 human-readable capability names to their exact endpoint lists.
* **`openapi/`**: Auto-generated folder. Populated by `rc-mcp fetch-specs` with the 12 official Rocket.Chat OpenAPI YAML files (558 endpoints, 2.2 MB).

### 4. `tests/` (The Verification)
* **49 unit tests** across 6 suites — all passing, TypeScript: 0 errors.

| Suite | Tests | What's Covered |
|---|:-:|---|
| `capability-resolver.test.ts` | 6 | Registry lookup, endpoint resolution |
| `suggest-engine.test.ts` | 15 | Tokenizer, keyword scorer, hallucination guard, deduplication |
| `schema-extractor.test.ts` | 5 | $ref resolution, YAML pruning |
| `tool-generator.test.ts` | ~8 | Zod generation, description compression |
| `server-scaffolder.test.ts` | ~12 | File assembly, template rendering, dynamic test stubs |
| `minimality-analyzer.test.ts` | 2 | Token estimate, pruning metrics, ref tracking |

### 5. `scripts/`
* **`demo.sh`**: End-to-end demo script: `suggest → list → analyze → generate → validate --deep → build`.

---

## ⚙️ Flow 1 — `rc-mcp suggest "read chat history and search messages"`

**Verified live output (keyword fallback, no API key):**

```
✔ Intent analyzed

Capability Suggestions for: "read chat history and search messages"
Mode: ⌘ Keyword fallback

  1. read-messages         HIGH
     Matched 5 of 5 intent keyword(s) against "Read message history and search messages in channels"
     4 endpoint(s): /api/v1/channels.history, /api/v1/chat.search, /api/v1/chat.getMessage

  2. send-message          MED
     Matched 2 of 5 intent keyword(s) against "Send messages to Rocket.Chat channels..."
     2 endpoint(s): /api/v1/chat.postMessage

→ Suggested command:
  rc-mcp generate read-messages
```

**Step-by-step:**
1. CLI passes intent string to `SuggestEngine.suggest()`.
2. No `GEMINI_API_KEY` → keyword scorer runs (`_suggestWithKeywords`).
3. `_tokenize("read chat history and search messages")` → `["read", "chat", "history", "search", "messages"]` (stop words removed).
4. Each capability's corpus (name + description + endpoint paths) is tokenized and scored by overlap.
5. `read-messages` scores 5/5 hits → `HIGH`. `send-message` scores 2/5 → `MED`.
6. Hallucination guard is a no-op here (keyword scorer only returns valid names).
7. Results enriched with endpoint data from registry and printed.

---

## ⚙️ Flow 2 — `rc-mcp generate send-message -o ./my-agent`

1. **`CapabilityResolver`** reads `capabilities.json` → `["/api/v1/login", "/api/v1/chat.postMessage"]`
2. **`SchemaExtractor`** opens 12 YAML files, finds those 2 endpoints, walks `$ref` tree → returns only their schema (3.1 KB from 2.2 MB)
3. **`ToolGenerator`** converts schemas to TypeScript Zod definitions + MCP tool handlers
4. **`ServerScaffolder`** writes full Node.js project to `./my-agent` (server.ts, tools/, tests/, package.json, .env.example)
5. Result: functional MCP server with **99.6% token footprint reduction**

---

## 🌍 Environment Variables

| Variable | Required | Description |
|---|:-:|---|
| `RC_URL` | ✅ | Rocket.Chat server URL for the generated server |
| `RC_USER` | ✅ | Rocket.Chat username for auth |
| `RC_PASSWORD` | ✅ | Rocket.Chat password for auth |
| `GEMINI_API_KEY` | Optional | Enables `suggest` Gemini mode (falls back to keyword scoring without it) |
| `GEMINI_MODEL` | Optional | Override Gemini model (default: `gemini-2.0-flash`, uses `v1` API endpoint) |

Go through entire project @beautifulMention @beautifulMention @beautifulMention @beautifulMention @beautifulMention @beautifulMention @beautifulMention & update @beautifulMention with all the details & highly technical & include all details