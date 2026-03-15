/**
 * SuggestEngine
 *
 * Maps natural-language user intent to Rocket.Chat API endpoints using
 * the Gemini API. If no GEMINI_API_KEY is set, gracefully falls back to
 * an enhanced keyword-based scorer with synonym expansion, TF-IDF weighting,
 * and multi-cluster cross-domain grouping.
 *
 * Design principle: LLM is used ONCE at discovery time to map intent → operationIds.
 * Generation remains 100% deterministic — no LLM involved there.
 *
 * v2 improvements:
 * - Multi-cluster results grouped by domain/tag (not flat top-5)
 * - Synonym expansion bridges user vocabulary ↔ API vocabulary
 * - TF-IDF scoring weights rare terms higher than common ones
 * - Domain inference searches only relevant domains first
 * - Two-phase LLM prompting to reduce token usage
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { SchemaExtractor } from "./schema-extractor.js";
import { VALID_DOMAINS, type EndpointSchema, type Domain } from "./types.js";
import { expandWithSynonyms, inferDomains, SYNONYM_MAP, DOMAIN_HINTS } from "./synonym-map.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Public types ──────────────────────────────────────────────────────

export interface SuggestionResult {
  /** A descriptive name for the match, e.g. "channels" or "messaging" */
  capability: string;
  /** LLM or keyword-scorer's brief explanation */
  reason: string;
  /** Confidence level produced by the scorer */
  confidence: "high" | "medium" | "low";
  /** Array of operationIds that match the intent */
  endpoints: string[];
  /** Convenience alias for endpoints.length */
  endpointCount: number;
  /** true = result came from LLM, false = offline keyword fallback */
  fromLLM: boolean;
  /** The domain this cluster belongs to (v2) */
  domain?: string;
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
   * @param topN    - Maximum number of suggestion clusters to return (default: 5)
   * @returns Ordered list of SuggestionResult, best match first
   */
  async suggest(intent: string, topN = 5): Promise<SuggestionResult[]> {
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

    // Phase 1: Use domain hints + synonym expansion to narrow scope
    const intentTokens = this._tokenize(intent);
    const relevantDomains = inferDomains(intentTokens);

    // Only include endpoints from relevant domains (+ a few from others for safety)
    let scopedEndpoints: EndpointSchema[];
    if (relevantDomains.length > 0) {
      const domainSet = new Set(relevantDomains);
      const relevant = this.endpoints.filter((ep) => domainSet.has(ep.domain));
      // If we narrowed too aggressively, include all
      scopedEndpoints = relevant.length > 10 ? relevant : this.endpoints;
    } else {
      scopedEndpoints = this.endpoints;
    }

    // Phase 2: Build compact registry summary
    const registrySummary = scopedEndpoints
      .map(
        (ep) =>
          `- "${ep.operationId}": ${ep.summary} [${ep.domain}] (${ep.method.toUpperCase()} ${ep.path})`,
      )
      .join("\n");

    const prompt = `You are a capability selector for a Rocket.Chat MCP server generator tool.

Your task is to map a user's description of what they want to do to specific API endpoints.

## Available Endpoints
${registrySummary}

## User Intent
"${intent}"

## Instructions
- Return a JSON array of suggestion CLUSTERS, ordered best match first
- Each cluster should represent a LOGICAL GROUP (e.g., "channel-management", "messaging", "user-discovery")
- Select the MINIMAL set of exact endpoints needed to fulfill each part of the intent
- Group endpoints by their functional area — don't put all endpoints in one cluster
- Max 5 clusters. Each cluster covers a distinct part of the user's intent.
- Each cluster must have: 
  - capability (string: a short hyphenated name like "channel-management" or "messaging")
  - reason (string: 1-sentence explanation of why these endpoints are needed for this part of the intent)
  - confidence ("high"|"medium"|"low")
  - endpoints (array of string: exact operationIds from the list above)
- IMPORTANT: Cover ALL parts of the user's intent across the clusters. If the intent mentions "send messages AND star messages AND create channels", make sure endpoints for ALL three appear somewhere.
- No other text, just the JSON array.

## Response format
[
  { 
    "capability": "channel-management",
    "reason": "Endpoints for creating and configuring project channels",
    "confidence": "high",
    "endpoints": ["post-api-v1-channels.create", "post-api-v1-channels.setDescription"]
  },
  {
    "capability": "messaging",
    "reason": "Endpoints for sending task updates and starring important messages",
    "confidence": "high",
    "endpoints": ["post-api-v1-chat.postMessage", "post-api-v1-chat.starMessage"]
  }
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

  // ─── Offline keyword fallback (v2: multi-cluster + synonyms) ──────

  /**
   * Score each endpoint by TF-IDF-weighted keyword overlap, then group
   * results into clusters by domain/tag. Returns multiple clusters, each
   * representing a different functional area.
   */
  _suggestWithKeywords(intent: string): LLMSuggestion[] {
    const intentTokens = this._tokenize(intent);
    if (intentTokens.length === 0) return [];

    // Keep originals separate so we can weight direct matches higher
    const intentTokenSet = new Set(intentTokens);

    // Expand intent with synonyms to catch API vocabulary
    const expandedTokens = expandWithSynonyms(intentTokens);

    // Build document frequency for TF-IDF: how many endpoints contain each token
    const docFrequency = new Map<string, number>();
    for (const ep of this.endpoints) {
      const epTokens = new Set(this._getEndpointTokens(ep));
      for (const token of expandedTokens) {
        if (epTokens.has(token)) {
          docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
        }
      }
    }

    const totalDocs = this.endpoints.length;

    // Score each endpoint using TF-IDF weighted overlap
    // FIX 2: Direct intent tokens score 3× higher than synonym matches
    // FIX 5: Field-weighted scoring — operationId/path matches score much higher than description matches
    const scored = this.endpoints.map((ep) => {
      const fieldWeights = this._getFieldWeightedTokens(ep);

      let score = 0;
      let matchedTerms = 0;
      const matchedOriginalTokens = new Set<string>();

      for (const token of expandedTokens) {
        const fieldWeight = fieldWeights.get(token);
        if (fieldWeight !== undefined) {
          // TF-IDF: rare terms get higher weight
          const df = docFrequency.get(token) ?? 1;
          const idf = Math.log(totalDocs / df);

          // Direct intent tokens score 3x; synonyms score 1x
          const isDirectMatch = intentTokenSet.has(token);
          const directWeight = isDirectMatch ? 3 : 1;

          // Field weight: operationId=10, path=5, tags=3, summary=2, description=0.1
          score += idf * directWeight * fieldWeight;
          matchedTerms++;

          // Track which original intent tokens this covers
          // FIX: Only claim coverage if the match was in a strong field (>=2),
          // otherwise bloated descriptions steal coverage from accurate endpoints.
          if (fieldWeight >= 2) {
             for (const original of intentTokens) {
               if (token === original || this._isSynonymOf(original, token)) {
                 matchedOriginalTokens.add(original);
               }
             }
          }
        }
      }

      return {
        ep,
        score,
        matchedTerms,
        matchedOriginalTokens,
        coverageRatio: matchedOriginalTokens.size / intentTokens.length,
      };
    });

    // Filter to endpoints with any match, sort by score
    const matched = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (matched.length === 0) return [];

    // Group by domain → tag for multi-cluster results
    const clusters = new Map<
      string,
      {
        domain: string;
        tag: string;
        endpoints: typeof matched;
        totalScore: number;
        coveredTokens: Set<string>;
      }
    >();

    for (const item of matched) {
      const domain = item.ep.domain;
      const tag = item.ep.tags[0] ?? domain;
      const key = `${domain}::${tag}`;

      if (!clusters.has(key)) {
        clusters.set(key, {
          domain,
          tag,
          endpoints: [],
          totalScore: 0,
          coveredTokens: new Set(),
        });
      }

      const cluster = clusters.get(key)!;

      // FIX: Add per-cluster noise filtering
      // If this endpoint's score is < 50% of the cluster's top endpoint score, drop it.
      // This keeps only strong matches per cluster (e.g., dropping rooms.delete noise).
      const isNoise = cluster.endpoints.length > 0 &&
        item.score < cluster.endpoints[0].score * 0.5;

      // Limit each cluster to top 5 endpoints
      if (!isNoise && cluster.endpoints.length < 5) {
        cluster.endpoints.push(item);
        cluster.totalScore += item.score;
        for (const t of item.matchedOriginalTokens) {
          cluster.coveredTokens.add(t);
        }
      }
    }

    // Sort clusters by total score (best clusters first)
    const sortedClusters = Array.from(clusters.values())
      .filter((c) => c.endpoints.length > 0)
      .sort((a, b) => b.totalScore - a.totalScore);

    // FIX 3: Minimum relevance threshold — drop noise clusters
    // Clusters scoring < 40% of the top cluster's average score are noise
    const topAvgScore = sortedClusters.length > 0
      ? sortedClusters[0].totalScore / sortedClusters[0].endpoints.length
      : 0;
    const minAvgScore = topAvgScore * 0.4;
    const relevantClusters = sortedClusters.filter(
      (c) => (c.totalScore / c.endpoints.length) >= minAvgScore,
    );

    // Greedy set-cover with domain diversity: pick clusters that maximize
    // intent coverage while preferring cross-domain variety. When we already
    // have a cluster from domain X, additional clusters from X are penalised
    // so clusters from new domains get a fair shot (e.g. user-management
    // isn't blocked by teams winning just because both are in "rooms").
    const coveredTokens = new Set<string>();
    const selectedClusters: typeof relevantClusters = [];
    const selectedDomains = new Set<string>();

    // We iterate until we've covered all tokens or have 5 clusters.
    // On each pass, pick the candidate with the best diversity-adjusted coverage.
    const remaining = [...relevantClusters];

    while (remaining.length > 0 && selectedClusters.length < 5) {
      let bestIdx = -1;
      let bestScore = -1;

      for (let i = 0; i < remaining.length; i++) {
        const cluster = remaining[i];
        const newCoverage = Array.from(cluster.coveredTokens).filter(
          (t) => !coveredTokens.has(t),
        ).length;

        // Domain diversity: if this domain is already selected, halve the score
        const domainPenalty = selectedDomains.has(cluster.domain) ? 0.5 : 1.0;
        const adjustedScore = newCoverage * domainPenalty;

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestIdx = i;
        }
      }

      // If no candidate adds anything useful, stop
      if (bestIdx === -1 || bestScore <= 0) {
        // Unless we have no clusters yet, then take the top scorer
        if (selectedClusters.length === 0 && remaining.length > 0) {
          bestIdx = 0;
        } else {
          break;
        }
      }

      const chosen = remaining.splice(bestIdx, 1)[0];
      selectedClusters.push(chosen);
      selectedDomains.add(chosen.domain);
      for (const t of chosen.coveredTokens) {
        coveredTokens.add(t);
      }

      // Stop once we have full coverage
      if (coveredTokens.size >= intentTokens.length) {
        break;
      }
    }

    // FIX 7: Domain-coverage guarantee — if key domains inferred from the
    // intent aren't represented yet, force-add their best cluster. This
    // ensures e.g. "user-management" appears when user says "team members".
    const inferredDomains = inferDomains(intentTokens);
    // Only guarantee domains with ≥1 intent token hint (to catch single-word domains like 'statistics')
    const domainHintCounts = new Map<string, number>();
    for (const token of intentTokens) {
      const hints = DOMAIN_HINTS[token];
      if (hints) {
        for (const d of hints) {
          domainHintCounts.set(d, (domainHintCounts.get(d) ?? 0) + 1);
        }
      }
    }
    const strongDomains = Array.from(domainHintCounts.entries())
      .filter(([, count]) => count >= 1)
      .map(([domain]) => domain);

    for (const domain of strongDomains) {
      if (selectedDomains.has(domain)) continue;
      if (selectedClusters.length >= 5) break;

      // Find best cluster from this domain that passed the relevance threshold
      const domainCluster = relevantClusters.find(
        (c) => c.domain === domain && !selectedClusters.includes(c),
      );
      if (domainCluster) {
        selectedClusters.push(domainCluster);
        selectedDomains.add(domain);
      }
    }

    // Convert to LLMSuggestion format
    return selectedClusters.map((cluster) => {
      // FIX 4: Confidence based on DIRECT original-token coverage only
      const directTokenCoverage = cluster.coveredTokens.size / intentTokens.length;

      const confidence: "high" | "medium" | "low" =
        directTokenCoverage >= 0.5 ? "high" : directTokenCoverage >= 0.25 ? "medium" : "low";

      const capabilityName = this._deriveCapabilityName(
        cluster.endpoints[0].ep.operationId,
        cluster.endpoints.map((e) => e.ep.operationId),
      );

      const coveredTermsList = Array.from(cluster.coveredTokens).join(", ");

      return {
        capability: capabilityName,
        reason: `Matched intent terms [${coveredTermsList}] across ${cluster.endpoints.length} ${cluster.tag} endpoints in ${cluster.domain}.`,
        confidence,
        endpoints: cluster.endpoints.map((e) => e.ep.operationId),
      };
    });
  }

  /**
   * Get all searchable tokens from an endpoint (operationId + summary + path + tags).
   */
  private _getEndpointTokens(ep: EndpointSchema): string[] {
    return [
      ...this._tokenize(ep.summary || ""),
      ...this._tokenize(ep.path),
      ...this._tokenize(ep.operationId),
      ...ep.tags.flatMap((t) => this._tokenize(t)),
      ...this._tokenize(ep.description || ""),
    ];
  }

  /**
   * Get tokens with field-based weights. Tokens appearing in higher-priority
   * fields (operationId, path) score much higher than description-only tokens.
   * This prevents false matches from generic words in descriptions.
   */
  private _getFieldWeightedTokens(ep: EndpointSchema): Map<string, number> {
    const weights = new Map<string, number>();

    // Priority: operationId=10, path=5, tags=3, summary=2, description=0.1
    const fields: Array<{ text: string; weight: number }> = [
      { text: ep.operationId, weight: 10 },
      { text: ep.path, weight: 5 },
      ...ep.tags.map((t) => ({ text: t, weight: 3 })),
      { text: ep.summary || "", weight: 2 },
      { text: ep.description || "", weight: 0.1 },
    ];

    for (const field of fields) {
      for (const token of this._tokenize(field.text)) {
        // Keep the highest weight for each token
        const current = weights.get(token) ?? 0;
        if (field.weight > current) {
          weights.set(token, field.weight);
        }
      }
    }

    return weights;
  }

  /**
   * Check if tokenB is a synonym of tokenA.
   */
  private _isSynonymOf(tokenA: string, tokenB: string): boolean {
    if (tokenA === tokenB) return true;
    const synonyms: string[] | undefined = SYNONYM_MAP[tokenA];
    return synonyms?.includes(tokenB) ?? false;
  }

  // ─── Text Search (used by rc_search_endpoints) ────────────────────

  /**
   * Search all endpoints for a text query. Returns ranked results.
   * Searches across operationId, summary, description, path, and tags.
   */
  async searchEndpoints(
    query: string,
    options: { domains?: string[]; limit?: number } = {},
  ): Promise<
    Array<{
      operationId: string;
      summary: string;
      method: string;
      path: string;
      domain: string;
      tags: string[];
      score: number;
    }>
  > {
    await this.loadEndpoints();

    const queryTokens = this._tokenize(query);
    const expandedTokens = expandWithSynonyms(queryTokens);
    const limit = options.limit ?? 20;

    let searchPool = this.endpoints;
    if (options.domains && options.domains.length > 0) {
      const domainSet = new Set(options.domains);
      searchPool = this.endpoints.filter((ep) => domainSet.has(ep.domain));
    }

    const results = searchPool
      .map((ep) => {
        const epTokens = new Set(this._getEndpointTokens(ep));
        let score = 0;
        for (const token of expandedTokens) {
          if (epTokens.has(token)) {
            // Direct intent token matches score higher than synonym matches
            const isOriginal = queryTokens.includes(token);
            score += isOriginal ? 2 : 1;
          }
        }
        return {
          operationId: ep.operationId,
          summary: ep.summary,
          method: ep.method.toUpperCase(),
          path: ep.path,
          domain: ep.domain,
          tags: ep.tags,
          score,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  /**
   * Tokenize a string into lowercase words, filtering common stop-words.
   */
  _tokenize(text: string): string[] {
    const STOP_WORDS = new Set([
      // English
      "a", "an", "the", "to", "and", "or", "for", "in", "of",
      "with", "on", "at", "by", "is", "it", "be", "as",
      "i", "want", "my", "me", "we", "our",
      // API / HTTP boilerplate (prevents description-text false matches)
      "api", "v1", "get", "post", "put", "patch",
      "request", "response", "endpoint", "param", "parameter",
      "return", "object", "body", "type", "value", "field",
      "retriev", "allow", "support",
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
    // -ed (e.g. "archived" → "archiv")
    if (word.endsWith("ed") && word.length > 4) return word.slice(0, -1); // Just remove 'd' to preserve the 'e' base if it had one
    // -es (e.g. "searches" → "search", "creates" → "create")
    if (word.endsWith("es") && word.length > 4) {
        // If it looks like a standard plural/verb add-on, just drop 's', otherwise drop 'es'
        // For simplicity in our limited usecase, just drop the 's' preserving the 'e' (so 'creates' -> 'create')
        return word.slice(0, -1); 
    }
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
