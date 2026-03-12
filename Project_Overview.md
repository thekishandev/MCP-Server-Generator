# 🚀 Minimal MCP Server Generator for Rocket.Chat: Project Deep Dive

This document explains the core concepts, architecture, current implementation status, and future roadmap of the **Minimal MCP Server Generator** project.

---

## 1. The Core Problem

The Model Context Protocol (MCP) allows LLMs to interact with external services (like Rocket.Chat) by calling tools. However, the standard MCP approach is fundamentally flawed for large platforms:

- **Context Bloat:** Most MCP servers expose the *entire* API surface. For Rocket.Chat: **558 endpoints, 2.2 MB** of schema, ~184,000 tokens injected into *every* LLM prompt.
- **Token Burning:** Agents in a loop pay that 184K-token cost on every iteration — draining budgets and blocking free-tier usage.
- **Tool Confusion:** Models seeing hundreds of similar tools (e.g., `channels.list`, `channels.list.joined`) frequently call the wrong one.

**The Solution:** Generate minimal servers **ahead of time**. If the project only needs to send messages, generate a server with exactly 2 endpoints. Minimality is **deterministic and measurable**.

---

## 2. How the Deterministic Pipeline Works

Generation uses zero LLM calls. The same input always produces the same output.

**Pipeline for `rc-mcp generate send-message`:**

| Step | Class | What it does |
|---|---|---|
| 1 | `CapabilityResolver` | `"send-message"` → `["/api/v1/login", "/api/v1/chat.postMessage"]` |
| 2 | `SchemaExtractor` | Opens 12 YAML files, walks `$ref` tree → 3.1 KB (from 2.2 MB) |
| 3 | `ToolGenerator` | 3.1 KB schemas → TypeScript Zod definitions + MCP tool handlers |
| 4 | `ServerScaffolder` | Handlebars templates → complete Node.js project (server.ts, tools/, tests/, .env.example) |
| 5 | `GeminiIntegration` | (optional, `--gemini` flag) → `.gemini-extension` folder for gemini-cli |

**Result:** 99.6% token footprint reduction. 558 endpoints → 2. ~184,000 tokens → ~661.

---

## 3. CLI Commands & Flags

The generator provides a full suite of tools for managing the MCP lifecycle:

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `rc-mcp suggest "<intent>"` | Map natural language to capabilities via AI or keyword matching | `--top <n>`, `--json`, `--generate`, `--gemini`, `-o <dir>`, `--rc-url` |
| `rc-mcp list` | List all available curated capabilities | |
| `rc-mcp fetch-specs` | Download the latest Rocket.Chat OpenAPI specs | |
| `rc-mcp generate <caps...>` | Generate the minimal MCP server project | `--gemini` (Add UI integration), `-o <dir>`, `--rc-url` |
| `rc-mcp analyze <caps...>` | Deep minimality reporting ($ref depth, token counts) | `--json` |
| `rc-mcp validate <dir>` | Check server for structural and MCP protocol compliance | `--deep` (Run TypeScript compilation check) |
| `rc-mcp integrate <dir>` | Add gemini-cli integration to an existing server | |

---

## 4. Integrating Gemini

The project undeniably surpasses standard MVCs across three core differentiators:

### A. LLM suggestions (`rc-mcp suggest`)
`rc-mcp suggest "<intent>"` lets developers describe what they want in plain English instead of knowing exact capability names. **Crucially, the LLM is only used once at discovery — generation remains 100% deterministic.**

**Key features:**
- **Two-layer intent mapping:** Uses Gemini LLM (1.5 Flash via `v1` endpoint) if `GEMINI_API_KEY` is present. Otherwise, it falls back to a purely offline, robust keyword scorer.
- **Porter-style stemmer:** Matches "channels" to "channel" during offline intent matching.
- **Weighted offline scoring:** Keyword overlaps with the API capability name count 2x, ensuring perfectly exact hits rank highest.
- **Hallucination guard:** Even if the LLM suggests an invented parameter, the pipeline ignores it if it doesn't match the capability registry.

### B. Offline 
While it's easy to prune simple endpoints, real-world schemas use deep `$ref` references. This generator surgically follows `$ref` trees (up to depth 10) to extract *only* the dependencies required the requested endpoints.

To prove this isn't just a claim, `rc-mcp analyze` provides a quantifiable **$ref Resolution Depth report**:

```
║  $ref RESOLUTION DEPTH                                     ║
╠────────────────────────────────────────────────────────────╣
║  Max Recursion Depth           │ —           │      2      ║
║  Total $refs Resolved          │ —           │      3      ║
```
*(From `rc-mcp analyze send-message`)*

### C. Validate
A generated server isn't done unless it's strictly validated. The project now holds generated output to professional engineering standards.

- **Deep `rc-mcp validate --deep`:** Upgraded from 9 simple structural checks to 20 precise validations. It verifies `zod` schema imports strictly for each tool, asserts MCP Protocol connections inside `server.ts` are exact, checks test file coverage per tool, and runs `tsc --noEmit` inside the generated directory to guarantee 0 TypeScript errors.
- **Smarter Scaffolded Tests:** The Generator creates intelligent `vitest` stubs. Instead of simple stub `expect(true)` checks, the tests dynamically inspect the actual Zod schema using `shape` and `instanceof z.ZodObject`, verify that omitting all non-optional required fields fails automatically, and confirm type safety mismatching.

---

## 5. Project Status & Roadmap

### Current State (March 2026)

| Feature | Status |
|---|:-:|
| Deterministic generation pipeline | ✅ Complete |
| 5 curated Rocket.Chat capabilities | ✅ Complete |
| `rc-mcp suggest` with Gemini + offline fallback | ✅ Complete |
| 49 unit tests, 0 TypeScript errors | ✅ Complete |
| gemini-cli integration (`--gemini` flag) | ✅ Complete |
| Minimality analyzer (4-dimension report) | ✅ Complete |
| Validator (9 structural checks) | ✅ Complete |

### Roadmap (remaining 175-hour GSoC scope)

**A. Generic Platform Support**
- Refactor schema extractor to accept any OpenAPI 3.0+ spec URL, not just Rocket.Chat's hardcoded YAML folder.

**B. Advanced Authentication**
- Inject PAT, OAuth 2.0, and 2FA middleware into the Handlebars scaffolding templates.

**C. Interactive TUI Wizard**
- Visual endpoint selection with real-time token footprint preview before generating.

**D. Bi-Directional Sync (`rc-mcp audit`)**
- Detect upstream API drift and offer targeted schema regeneration without overwriting custom tool logic.

---

## 6. Project Constraints

- **No new AI CLI**: integrates *alongside* `gemini-cli`, not as a replacement.
- **Cost reduction is the north star**: every feature must make agentic workflows cheaper or faster.
- **Platform-agnostic core**: Rocket.Chat is the target, but the extraction engine must stay generic.

---

## 7. Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 18+ |
| CLI framework | Commander.js |
| Template engine | Handlebars |
| Schema validation | Zod |
| MCP SDK | `@modelcontextprotocol/sdk` |
| AI provider | `@google/generative-ai` (Gemini, v1 API) |
| Testing | Vitest |
| Build | tsc |

---

## 8. The 175-Hour GSoC Breakdown

1. **MVP Hardening & Generic Refactor (~40h):** Decouple Rocket.Chat-specific parsing so any OpenAPI spec can be ingested.
2. **Dynamic Suggestion Engine (~50h):** ✅ *Implemented* — `rc-mcp suggest`, Gemini LLM path, offline keyword fallback, hallucination guard, 15 unit tests.
3. **Advanced Setup & DevX (~45h):** Interactive TUI wizard with live token footprint preview.
4. **Security & Auth (~25h):** OAuth 2.0, PATs, 2FA in Handlebars templates.
5. **Documentation & Final Testing (~15h):** Demo recordings, 100% coverage, final README polish.
