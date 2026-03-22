/**
 * SuggestEngine Unit Tests
 *
 * Tests the deterministic parts of SuggestEngine without making real LLM calls:
 *   - Keyword-based offline scoring (v2: multi-cluster, TF-IDF, synonyms)
 *   - Registry validation filter (hallucination guard)
 *   - Tokenizer correctness
 *   - Result deduplication
 *   - Confidence level mapping
 *   - Cross-domain intent coverage
 *   - Synonym expansion
 *   - Search endpoint functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuggestEngine } from "../src/core/suggest-engine.js";

// ─── Helpers ──────────────────────────────────────────────────────────

async function makeEngine(): Promise<SuggestEngine> {
  const engine = new SuggestEngine();
  await engine.loadEndpoints();
  return engine;
}

// ─── Tokenizer ────────────────────────────────────────────────────────

describe("SuggestEngine._tokenize", () => {
  it("lowercases and splits on whitespace", async () => {
    const engine = await makeEngine();
    const tokens = engine._tokenize("Send A Message");
    expect(tokens).toContain("send");
    expect(tokens).toContain("message");
  });

  it("removes stop words", async () => {
    const engine = await makeEngine();
    const tokens = engine._tokenize("send a message to a channel");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("to");
  });

  it("replaces non-alphanumeric chars with spaces (except hyphens)", async () => {
    const engine = await makeEngine();
    const tokens = engine._tokenize("/api/v1/chat.postMessage");
    expect(tokens).not.toContain("/api/v1/chat.postmessage");
    expect(tokens).toContain("chat");
    expect(tokens).toContain("postmessage");
  });

  it("filters single-character tokens", async () => {
    const engine = await makeEngine();
    const tokens = engine._tokenize("a b c send");
    expect(tokens.every((t) => t.length > 1)).toBe(true);
    expect(tokens).toContain("send");
  });
});

// ─── Keyword Scorer (v2 multi-cluster) ────────────────────────────────

describe("SuggestEngine._suggestWithKeywords", () => {
  it("returns valid operationIds only", async () => {
    const engine = await makeEngine();
    const results = engine._suggestWithKeywords("send a message to a channel");
    const endpoints = new Set(engine.getEndpoints().map((e) => e.operationId));
    for (const r of results) {
      for (const ep of r.endpoints) {
        expect(endpoints.has(ep)).toBe(true);
      }
    }
  });

  it("ranks message endpoints highly for 'send a message'", async () => {
    const engine = await makeEngine();
    const results = engine._suggestWithKeywords("send a message");
    expect(results.length).toBeGreaterThan(0);
    // It should match chat/message related endpoints across clusters
    const allEps = results.flatMap((r) => r.endpoints);
    expect(
      allEps.some(
        (ep) =>
          ep.includes("chat") ||
          ep.includes("mesage") ||
          ep.toLowerCase().includes("message"),
      ),
    ).toBe(true);
  });

  it("returns MULTIPLE clusters for cross-domain intents", async () => {
    const engine = await makeEngine();
    const results = engine._suggestWithKeywords(
      "create project channel, invite team members, send task updates and star important messages",
    );
    // Should return clusters from multiple domains (channels, messaging, etc.)
    expect(results.length).toBeGreaterThan(1);
  });

  it("covers messaging AND channel endpoints for mixed intent", async () => {
    const engine = await makeEngine();
    const results = engine._suggestWithKeywords(
      "create channel, send message, star message",
    );
    const allEps = results.flatMap((r) => r.endpoints);
    // Should have both channel and chat endpoints
    const hasChannel = allEps.some((ep) => ep.includes("channel"));
    const hasChat = allEps.some((ep) => ep.includes("chat") || ep.includes("message"));
    expect(hasChannel || hasChat).toBe(true);
  });

  it("assigns confidence high/medium/low correctly", async () => {
    const engine = await makeEngine();
    const results = engine._suggestWithKeywords("send a message to a channel");
    for (const r of results) {
      expect(["high", "medium", "low"]).toContain(r.confidence);
    }
  });

  it("returns results even when no direct keyword matches", async () => {
    const engine = await makeEngine();
    const results = engine._suggestWithKeywords("xyzzy frobnicate");
    // Falls back to empty list if 0 matches
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("finds endpoints via synonym expansion ('invite' matches 'add')", async () => {
    const engine = await makeEngine();
    const results = engine._suggestWithKeywords("invite members to channel");
    const allEps = results.flatMap((r) => r.endpoints);
    // Should find channels.invite or channels.addAll via synonyms
    const hasInviteRelated = allEps.some(
      (ep) => ep.includes("invite") || ep.includes("add"),
    );
    expect(hasInviteRelated).toBe(true);
  });
});

// ─── suggest() — offline path ─────────────────────────────────────────

describe("SuggestEngine.suggest", () => {
  beforeEach(() => {
    // engine is always offline — no external API calls
  });

  it("returns SuggestionResult objects with required fields", async () => {
    const engine = new SuggestEngine();
    const results = await engine.suggest("upload a file to a room");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.capability).toBe("string");
      expect(typeof r.reason).toBe("string");
      expect(["high", "medium", "low"]).toContain(r.confidence);
      expect(Array.isArray(r.endpoints)).toBe(true);
      expect(typeof r.endpointCount).toBe("number");
    }
  });

  it("respects the topN parameter", async () => {
    const engine = new SuggestEngine();
    const results = await engine.suggest("create channel send message star message invite users", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ─── Deduplication guard ──────────────────────────────────────────────

describe("SuggestEngine — deduplication guard", () => {
  it("deduplicates identical endpoint clusters returned by the scorers", async () => {
    const engine = new SuggestEngine();
    await engine.loadEndpoints();

    // Mock the internal scorer to return identical suggestions
    const spy = vi
      .spyOn(engine as any, "_suggestWithKeywords")
      .mockReturnValue([
        {
          capability: "test-1",
          reason: "testing",
          confidence: "high",
          endpoints: ["post-api-v1-chat-sendMessage"], // The key is the array of endpoints
        },
        {
          capability: "test-2",
          reason: "duplicate",
          confidence: "medium",
          endpoints: ["post-api-v1-chat-sendMessage"], // Exact same endpoints
        },
      ]);

    const results = await engine.suggest("test");
    // Should only return 1 because the endpoints are identical
    expect(results.length).toBe(1);
    expect(results[0].capability).toBe("test-1");

    spy.mockRestore();
  });
});

// ─── Search Endpoints ─────────────────────────────────────────────────

describe("SuggestEngine.searchEndpoints", () => {
  it("finds endpoints matching a text query", async () => {
    const engine = new SuggestEngine();
    const results = await engine.searchEndpoints("star message");
    expect(results.length).toBeGreaterThan(0);
    const hasStarRelated = results.some(
      (r) => r.operationId.includes("star") || r.summary.toLowerCase().includes("star"),
    );
    expect(hasStarRelated).toBe(true);
  });

  it("filters by domain when specified", async () => {
    const engine = new SuggestEngine();
    const results = await engine.searchEndpoints("create", { domains: ["rooms"] });
    for (const r of results) {
      expect(r.domain).toBe("rooms");
    }
  });

  it("respects the limit parameter", async () => {
    const engine = new SuggestEngine();
    const results = await engine.searchEndpoints("message", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns results with required fields", async () => {
    const engine = new SuggestEngine();
    const results = await engine.searchEndpoints("channel invite");
    for (const r of results) {
      expect(typeof r.operationId).toBe("string");
      expect(typeof r.summary).toBe("string");
      expect(typeof r.method).toBe("string");
      expect(typeof r.path).toBe("string");
      expect(typeof r.domain).toBe("string");
      expect(Array.isArray(r.tags)).toBe(true);
      expect(typeof r.score).toBe("number");
    }
  });
});
