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

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { CapabilityRegistry } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CAPABILITIES_PATH = resolve(
    __dirname,
    "../providers/rocketchat/capabilities.json"
);

// ─── Public types ──────────────────────────────────────────────────────

export interface SuggestionResult {
    /** Exact registry key, e.g. "send-message" */
    capability: string;
    /** LLM or keyword-scorer's brief explanation */
    reason: string;
    /** Confidence level produced by the scorer */
    confidence: "high" | "medium" | "low";
    /** Endpoints from the registry (deterministic) */
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
}

// ─── SuggestEngine ────────────────────────────────────────────────────

export class SuggestEngine {
    private registry: CapabilityRegistry;
    private validCapabilities: Set<string>;

    constructor(registryPath?: string) {
        const path = registryPath ?? DEFAULT_CAPABILITIES_PATH;
        const raw = readFileSync(path, "utf-8");
        this.registry = JSON.parse(raw) as CapabilityRegistry;
        this.validCapabilities = new Set(Object.keys(this.registry));
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

        let raw: LLMSuggestion[];
        let fromLLM: boolean;

        if (apiKey) {
            raw = await this._suggestWithLLM(intent, apiKey);
            fromLLM = true;
        } else {
            raw = this._suggestWithKeywords(intent);
            fromLLM = false;
        }

        // Filter: only keep names that actually exist in the registry
        const filtered = raw.filter((s) => this.validCapabilities.has(s.capability));

        // Deduplicate preserving order
        const seen = new Set<string>();
        const deduped = filtered.filter((s) => {
            if (seen.has(s.capability)) return false;
            seen.add(s.capability);
            return true;
        });

        // Enrich with deterministic endpoint data
        return deduped.slice(0, topN).map((s) => {
            const def = this.registry[s.capability]!;
            return {
                capability: s.capability,
                reason: s.reason,
                confidence: s.confidence,
                endpoints: def.endpoints,
                endpointCount: def.endpoints.length,
                fromLLM,
            };
        });
    }

    // ─── LLM path ─────────────────────────────────────────────────────

    private async _suggestWithLLM(
        intent: string,
        apiKey: string
    ): Promise<LLMSuggestion[]> {
        // Dynamic import so the module is only loaded when needed
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const client = new GoogleGenerativeAI(apiKey);
        const modelName = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
        const model = client.getGenerativeModel(
            { model: modelName },
            { apiVersion: "v1" }
        );

        const registrySummary = Object.entries(this.registry)
            .map(
                ([name, def]) =>
                    `- "${name}": ${def.description} (endpoints: ${def.endpoints.filter((e) => e !== "/api/v1/login").join(", ")})`
            )
            .join("\n");

        const prompt = `You are a capability selector for a Rocket.Chat MCP server generator tool.

Your task is to map a user's description of what they want to do to one or more capabilities in the registry below.

## Capability Registry
${registrySummary}

## User Intent
"${intent}"

## Instructions
- Return a JSON array of suggestions, ordered best match first
- Only use capability names that EXACTLY match the registry (e.g. "send-message", not "sendMessage")
- Max 3 suggestions
- Each suggestion must have: capability (string), reason (1-sentence explanation), confidence ("high"|"medium"|"low")
- No other text, just the JSON array

## Response format
[
  { "capability": "<name>", "reason": "<why>", "confidence": "high"|"medium"|"low" },
  ...
]`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        // Strip markdown code fences if the model wraps with them
        const jsonText = text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();

        return JSON.parse(jsonText) as LLMSuggestion[];
    }

    // ─── Offline keyword fallback ─────────────────────────────────────

    /**
     * Score each capability by counting keyword overlaps against the user intent.
     * Fully deterministic, no network calls.
     */
    _suggestWithKeywords(intent: string): LLMSuggestion[] {
        const intentTokens = this._tokenize(intent);

        const scored = Object.entries(this.registry).map(([name, def]) => {
            // Split corpus into name tokens (2x weight) and description+endpoint tokens (1x weight)
            const nameTokens = this._tokenize(name);
            const descTokens = [
                ...this._tokenize(def.description),
                ...def.endpoints.flatMap((e) => this._tokenize(e)),
            ];

            // Weighted hit count: name matches count double
            const nameHits = intentTokens.filter((t) => nameTokens.includes(t)).length;
            const descHits = intentTokens.filter((t) => descTokens.includes(t)).length;
            const weightedHits = nameHits * 2 + descHits;
            const maxWeighted = intentTokens.length * 2; // if all tokens matched name

            const score = maxWeighted > 0 ? weightedHits / maxWeighted : 0;

            // Count unique intent tokens that matched anywhere (name or desc), for display
            const matchedTokens = new Set([
                ...intentTokens.filter((t) => nameTokens.includes(t)),
                ...intentTokens.filter((t) => descTokens.includes(t)),
            ]);
            const displayHits = matchedTokens.size;
            const nameLabel = nameHits > 0 ? " (name match)" : "";
            const confidence: "high" | "medium" | "low" =
                score >= 0.5 ? "high" : score >= 0.2 || nameHits > 0 ? "medium" : "low";

            return {
                capability: name,
                reason: `Matched ${displayHits} of ${intentTokens.length} intent keyword(s) against "${def.description}"${nameLabel}`,
                confidence,
                score,
            };
        });

        // Sort descending by weighted score, keep all with score > 0 (or top 3 fallback)
        return scored
            .sort((a, b) => b.score - a.score)
            .filter((s) => s.score > 0 || scored.every((x) => x.score === 0))
            .slice(0, 3)
            .map(({ capability, reason, confidence }) => ({
                capability,
                reason,
                confidence,
            }));
    }

    /**
     * Tokenize a string into lowercase words, filtering common stop-words.
     */
    _tokenize(text: string): string[] {
        const STOP_WORDS = new Set([
            "a", "an", "the", "to", "and", "or", "for", "in", "of",
            "with", "on", "at", "by", "is", "it", "be", "as", "i",
            "api", "v1", "want", "my", "me", "we", "our",
        ]);

        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, " ")
            .split(/[\s-]+/)
            .map((w) => this._stem(w))
            .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
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
     * Expose the loaded registry (for testing / CLI display).
     */
    getRegistry(): CapabilityRegistry {
        return this.registry;
    }
}
