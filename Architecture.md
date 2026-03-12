# 📁 Project Architecture & File Breakdown

This project is built around a **two-layer design**: an optional AI Discovery layer that maps natural language → capability keys, and a strictly deterministic generation pipeline that turns those keys into production-ready MCP servers.

---

## 🏗️ Folder Structure Breakdown

### 1. `src/cli/` (The Entry Point)

- **`index.ts`**: Defines all 5 commands (`suggest`, `generate`, `analyze`, `validate`, `integrate`) and wires them to the `src/core/` classes.

### 2. `src/core/` (The Engine)

#### AI Discovery Layer

- **`suggest-engine.ts`**: Powers `rc-mcp suggest "<intent>"`. Maps natural language to live API `operationIds` via one of two paths:
  - **Gemini mode** (when `GEMINI_API_KEY` is set): Single prompt to Gemini API (`v1` endpoint, model configurable via `GEMINI_MODEL` env var, default `gemini-2.0-flash`). Returns a JSON array of ranked `operationId` suggestions.
  - **Keyword fallback** (no key needed): Tokenizes user intent and scores all endpoints by keyword overlap against descriptions and REST paths. Fully offline.
  - **Hallucination guard** (always active): Filters any `operationIds` that don't exist in the live fetched OpenAPI schemas before they reach the UI.

#### Deterministic Generation Pipeline

- **`types.ts`**: TypeScript interfaces shared across the project (`EndpointSchema`, `GeneratedTool`, `SuggestionResult`).
- **`schema-extractor.ts`**: Employs a **3-Tier Caching System** (Memory → Disk `.cache/` 24h TTL → GitHub Remote Fetch). It dynamically downloads the 12 official Rocket.Chat OpenAPI YAML files, finds requested endpoints, and recursively prunes all `$ref` dependencies — returning only the data models actually needed.
- **`tool-generator.ts`**: Converts pruned OpenAPI schemas into TypeScript Zod definitions + executable MCP tool handlers. Compresses descriptions to ≤120 chars to prevent description-level context bloat.
- **`server-scaffolder.ts`**: Assembles the complete MCP server project using Handlebars templates. Writes `server.ts`, per-tool files, `package.json`, `.env.example`, and smarter dynamic Zod schema `vitest` stubs.
- **`minimality-analyzer.ts`**: The `rc-mcp analyze` metrics engine. Compares minimal vs. full-API dimensions across endpoints, schema size, components, estimated tokens, and reports `$ref` recursive resolution depth.
- **`gemini-integration.ts`**: Generates the `.gemini-extension` folder for native `gemini-cli` installation when `--gemini` flag is passed.

### 3. `.cache/` (The Auto-Generated Cache)

- **`openapi-specs/`**: Automatically generated folder on runtime. Populated by `SchemaExtractor` mapping directly from Rocket.Chat's remote GitHub repository. Caches schemas locally for 24 hours to accelerate repeated analysis or generations.

### 4. `tests/` (The Verification)

- **49 unit tests** across 6 suites — all passing, TypeScript: 0 errors.

| Suite                         | Tests | What's Covered                                                 |
| ----------------------------- | :---: | -------------------------------------------------------------- |
| `suggest-engine.test.ts`      |  15   | Tokenizer, keyword scorer, hallucination guard, schema mapping |
| `schema-extractor.test.ts`    |   5   | $ref resolution, YAML pruning                                  |
| `tool-generator.test.ts`      |  ~8   | Zod generation, description compression                        |
| `server-scaffolder.test.ts`   |  ~12  | File assembly, template rendering, dynamic test stubs          |
| `minimality-analyzer.test.ts` |   2   | Token estimate, pruning metrics, ref tracking                  |

### 5. `scripts/`

- **`demo.sh`**: End-to-end demo script: `suggest → analyze → generate → validate --deep → build`.

---

## ⚙️ Flow 1 — `rc-mcp suggest "read chat history and search messages"`

**Verified live output (keyword fallback, no API key):**

```
✔ Intent analyzed

Endpoint Suggestions for: "read chat history and search messages"
Mode: ⌘ Keyword fallback

  1. get-api-v1-channels-history         HIGH
     Matched 5 of 5 intent keyword(s) against "Retrieves the messages from a channel"

  2. get-api-v1-chat-search              HIGH
     Matched 4 of 5 intent keyword(s) against "Search for messages"

→ Suggested command:
  rc-mcp generate --endpoints get-api-v1-channels-history,get-api-v1-chat-search
```

**Step-by-step:**

1. CLI passes intent string to `SuggestEngine.suggest()`.
2. No `GEMINI_API_KEY` → keyword scorer runs (`_suggestWithKeywords`).
3. `_tokenize("read chat history and search messages")` → `["read", "chat", "history", "search", "messages"]` (stop words removed).
4. Each endpoint's corpus (operationId + summary + description + path) is tokenized and scored by overlap against the `.cache` schemas.
5. High matches are returned.
6. Hallucination guard verifies that every suggested `operationId` physically exists in the cache.
7. Results grouped and printed to terminal.

---

## ⚙️ Flow 2 — `rc-mcp generate --endpoints post-api-v1-chat-sendMessage -o ./my-agent`

1. **`SchemaExtractor`** reads the required `operationId` array, checks `.cache/` (fetches from GitHub if empty or expired), finds `post-api-v1-chat-sendMessage`, walks the `$ref` tree → returns only the needed schema (3.1 KB from 2.2 MB).
2. **`ToolGenerator`** converts schemas to TypeScript Zod definitions + MCP tool handlers.
3. **`ServerScaffolder`** writes full Node.js project to `./my-agent` (server.ts, tools/, tests/, package.json, .env.example).
4. **`GeminiIntegration`** injects `gemini-extension.json` and a contextual `GEMINI.md`.
5. Result: functional MCP server with **99.6% token footprint reduction**.

---

## 🌍 Environment Variables

| Variable         | Required | Description                                                                 |
| ---------------- | :------: | --------------------------------------------------------------------------- |
| `RC_URL`         |    ✅    | Rocket.Chat server URL for the generated server                             |
| `RC_USER`        |    ✅    | Rocket.Chat username for auth                                               |
| `RC_PASSWORD`    |    ✅    | Rocket.Chat password for auth                                               |
| `GEMINI_API_KEY` | Optional | Enables `suggest` Gemini mode (falls back to keyword scoring without it)    |
| `GEMINI_MODEL`   | Optional | Override Gemini model (default: `gemini-2.0-flash`, uses `v1` API endpoint) |

Go through entire project @beautifulMention @beautifulMention @beautifulMention @beautifulMention @beautifulMention @beautifulMention @beautifulMention & update @beautifulMention with all the details & highly technical & include all details
