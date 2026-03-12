/**
 * SuggestEngine
 *
 * Maps natural-language user intent to entries in the deterministic Capability
 * Registry using the Gemini API. If no GEMINI_API_KEY is set, gracefully falls
 * back to keyword-based scoring (fully offline).
 *
 * Design principle: LLM is used ONCE at discovery time to map intent → registry
 * key. Generation remains 100% deterministic — no LLM involved there.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { SchemaExtractor } from "./schema-extractor.js";
import { VALID_DOMAINS, type EndpointSchema } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Public types ──────────────────────────────────────────────────────

export interface SuggestionResult {
  /** A descriptive name for the match, e.g. "custom-intent" */
  capability: string;
  /** LLM or keyword-scorer's brief explanation */
  reason: string;
  /** Confidence level produced by the scorer */
  confidence: "high" | "medium" | "low";
  /** Array of operationIds (formerly paths) that match the intent */
  endpoints: string[];
  /** Convenience alias for endpoints.length */
  endpointCount: number;
  /** true = result came from LLM, false = offline keyword fallback */
  fromLLM: boolean;
}

interface LLMSuggestion {
  capability: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  endpoints: string[];
}

// ─── SuggestEngine ────────────────────────────────────────────────────

export class SuggestEngine {
  private endpoints: EndpointSchema[] = [];

  constructor() {}

  /**
   * Load all endpoints from the OpenAPI specs using SchemaExtractor
   */
  async loadEndpoints() {
    if (this.endpoints.length > 0) return;
    const extractor = new SchemaExtractor();
    await extractor.loadDomains([...VALID_DOMAINS]);
    const allEndpoints = Array.from(
      (extractor as any).endpointIndex.values() as EndpointSchema[],
    );
    // Filter out login, as it's automatically added later
    this.endpoints = allEndpoints.filter(
      (ep) =>
        ep.path !== "/api/v1/login" && ep.operationId !== "post-api-v1-login",
    );
  }

  /**
   * Suggest capabilities that match the user's natural-language intent.
   *
   * @param intent  - The user's description of what they want to do
   * @param topN    - Maximum number of suggestions to return (default: 3)
   * @returns Ordered list of SuggestionResult, best match first
   */
  async suggest(intent: string, topN = 3): Promise<SuggestionResult[]> {
    const apiKey = process.env.GEMINI_API_KEY;

    await this.loadEndpoints();

    let raw: LLMSuggestion[];
    let fromLLM: boolean;

    if (apiKey) {
      raw = await this._suggestWithLLM(intent, apiKey);
      fromLLM = true;
    } else {
      raw = this._suggestWithKeywords(intent);
      fromLLM = false;
    }

    // Deduplicate preserving order
    const seen = new Set<string>();
    const dedupedCtx = raw.filter((s) => {
      const key = s.endpoints.slice().sort().join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return dedupedCtx.slice(0, topN).map((s) => ({
      capability: s.capability,
      reason: s.reason,
      confidence: s.confidence,
      endpoints: s.endpoints,
      endpointCount: s.endpoints.length,
      fromLLM,
    }));
  }

  // ─── LLM path ─────────────────────────────────────────────────────

  private async _suggestWithLLM(
    intent: string,
    apiKey: string,
  ): Promise<LLMSuggestion[]> {
    // Dynamic import so the module is only loaded when needed
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const client = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    const model = client.getGenerativeModel(
      { model: modelName },
      { apiVersion: "v1" },
    );

    const registrySummary = this.endpoints
      .map(
        (ep) =>
          `- "${ep.operationId}": ${ep.summary} (${ep.method.toUpperCase()} ${ep.path})`,
      )
      .join("\n");

    const prompt = `You are a capability selector for a Rocket.Chat MCP server generator tool.

Your task is to map a user's description of what they want to do to specific API endpoints.

## Available Endpoints
${registrySummary}

## User Intent
"${intent}"

## Instructions
- Return a JSON array of suggestions, ordered best match first
- Select the exact endpoints needed to fulfill this intent
- Max 3 suggestions. A suggestion is a logical group of endpoints that together solve the user's intent.
- Each suggestion must have: 
  - capability (string: a short hyphenated name for this intent)
  - reason (string: 1-sentence explanation of why these endpoints were chosen)
  - confidence ("high"|"medium"|"low")
  - endpoints (array of string: exact operationIds from the list above)
- No other text, just the JSON array.

## Response format
[
  { 
    "capability": "manage-rooms",
    "reason": "Uses room creation and deletion endpoints to manage the lifecycle",
    "confidence": "high",
    "endpoints": ["post-api-v1-rooms-create", "post-api-v1-rooms-delete"]
  },
  ...
]`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip markdown code fences if the model wraps with them
    const jsonText = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(jsonText) as LLMSuggestion[];
    // Validate operationIds
    const validIds = new Set(this.endpoints.map((e) => e.operationId));
    return parsed
      .map((s) => ({
        ...s,
        endpoints: (s.endpoints || []).filter((id) => validIds.has(id)),
      }))
      .filter((s) => s.endpoints.length > 0);
  }

  // ─── Offline keyword fallback ─────────────────────────────────────

  /**
   * Score each capability by counting keyword overlaps against the user intent.
   * Fully deterministic, no network calls.
   */
  _suggestWithKeywords(intent: string): LLMSuggestion[] {
    const intentTokens = this._tokenize(intent);

    const scored = this.endpoints.map((ep) => {
      const descTokens = [
        ...this._tokenize(ep.summary || ""),
        ...this._tokenize(ep.path),
        ...this._tokenize(ep.operationId),
      ];

      const hits = intentTokens.filter((t) => descTokens.includes(t)).length;
      const score = hits / intentTokens.length;

      return {
        ep,
        score,
        hits,
      };
    });

    const sorted = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (sorted.length === 0) {
      return [];
    }

    // Just take the top matching endpoints as a single cluster
    const topN = sorted.slice(0, 5);
    const avgScore = topN.reduce((acc, s) => acc + s.score, 0) / topN.length;
    const confidence: "high" | "medium" | "low" =
      avgScore >= 0.5 ? "high" : avgScore >= 0.2 ? "medium" : "low";

    // Derive a clean capability name from the top operationId
    // e.g., "post-api-v1-chat-sendMessage" → "chat-sendMessage"
    const topOpId = topN[0].ep.operationId;
    const capabilityName = this._deriveCapabilityName(topOpId, topN.map(s => s.ep.operationId));

    return [
      {
        capability: capabilityName,
        reason: `Matched ${topN[0].hits} of ${intentTokens.length} intent keyword(s) against the best matching endpoints.`,
        confidence,
        endpoints: topN.map((s) => s.ep.operationId), // Always return operationId
      },
    ];
  }

  /**
   * Tokenize a string into lowercase words, filtering common stop-words.
   */
  _tokenize(text: string): string[] {
    const STOP_WORDS = new Set([
      "a",
      "an",
      "the",
      "to",
      "and",
      "or",
      "for",
      "in",
      "of",
      "with",
      "on",
      "at",
      "by",
      "is",
      "it",
      "be",
      "as",
      "i",
      "api",
      "v1",
      "want",
      "my",
      "me",
      "we",
      "our",
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .map((w) => this._stem(w))
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  }

  /**
   * Derive a clean, descriptive capability name from the top operationIds.
   * Strips boilerplate prefixes and finds the common meaningful path.
   * e.g., "post-api-v1-chat-sendMessage" → "chat-sendMessage"
   * e.g., ["get-api-v1-engagement-dashboard-users-active-users",
   *         "get-api-v1-engagement-dashboard-messages-messages-sent"]
   *       → "engagement-dashboard"
   */
  private _deriveCapabilityName(topOpId: string, allOpIds: string[]): string {
    const stripPrefix = (id: string) =>
      id.replace(/^(get|post|put|delete|patch)-api-v1-/, "");

    const stripped = allOpIds.map(stripPrefix);

    // Find the longest common prefix among all stripped IDs
    if (stripped.length > 1) {
      const parts0 = stripped[0].split(/[-_.]/);
      let commonParts: string[] = [];
      for (const part of parts0) {
        const prefix = [...commonParts, part].join("-");
        if (stripped.every((s) => s.startsWith(prefix))) {
          commonParts.push(part);
        } else {
          break;
        }
      }
      if (commonParts.length > 0) {
        return commonParts.join("-").substring(0, 40);
      }
    }

    // Fallback: use first meaningful segments from the top operationId
    const topStripped = stripPrefix(topOpId);
    const segments = topStripped.split(/[-_.]/);
    const meaningful = segments.filter(
      (s) => s.length > 1 && !["api", "v1"].includes(s),
    );
    return (
      meaningful.slice(0, 3).join("-").substring(0, 40) ||
      topStripped.substring(0, 40)
    );
  }

  /**
   * Minimal Porter-style stemmer for the most common English suffixes.
   * Reduces 'channels' → 'channel', 'managing' → 'manag', 'groups' → 'group'.
   */
  private _stem(word: string): string {
    if (word.length <= 3) return word;
    // -ing (length guard: "sing" should stay)
    if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
    // -ers → -er → base
    if (word.endsWith("ers") && word.length > 5) return word.slice(0, -2);
    // -ies → -y
    if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
    // -es (e.g. "searches" → "search", "configures" → "configur")
    if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
    // -ed (e.g. "archived" → "archiv")
    if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
    // -s (simple plural: "channels" → "channel", "groups" → "group")
    if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
    return word;
  }

  /**
   * Expose the loaded endpoints (for testing)
   */
  getEndpoints(): EndpointSchema[] {
    return this.endpoints;
  }
}
