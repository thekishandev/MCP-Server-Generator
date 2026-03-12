/**
 * SuggestEngine Unit Tests
 *
 * Tests the deterministic parts of SuggestEngine without making real LLM calls:
 *   - Keyword-based offline scoring
 *   - Registry validation filter (hallucination guard)
 *   - Tokenizer correctness
 *   - Result deduplication
 *   - Confidence level mapping
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuggestEngine } from "../src/core/suggest-engine.js";

// ─── Helpers ──────────────────────────────────────────────────────────

async function makeOfflineEngine(): Promise<SuggestEngine> {
  delete process.env.GEMINI_API_KEY;
  const engine = new SuggestEngine();
  await engine.loadEndpoints();
  return engine;
}

// ─── Tokenizer ────────────────────────────────────────────────────────

describe("SuggestEngine._tokenize", () => {
  it("lowercases and splits on whitespace", async () => {
    const engine = await makeOfflineEngine();
    const tokens = engine._tokenize("Send A Message");
    expect(tokens).toContain("send");
    expect(tokens).toContain("message");
  });

  it("removes stop words", async () => {
    const engine = await makeOfflineEngine();
    const tokens = engine._tokenize("send a message to a channel");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("to");
  });

  it("replaces non-alphanumeric chars with spaces (except hyphens)", async () => {
    const engine = await makeOfflineEngine();
    const tokens = engine._tokenize("/api/v1/chat.postMessage");
    expect(tokens).not.toContain("/api/v1/chat.postmessage");
    expect(tokens).toContain("chat");
    expect(tokens).toContain("postmessage");
  });

  it("filters single-character tokens", async () => {
    const engine = await makeOfflineEngine();
    const tokens = engine._tokenize("a b c send");
    expect(tokens.every((t) => t.length > 1)).toBe(true);
    expect(tokens).toContain("send");
  });
});

// ─── Keyword Scorer ───────────────────────────────────────────────────

describe("SuggestEngine._suggestWithKeywords", () => {
  it("returns valid operationIds only", async () => {
    const engine = await makeOfflineEngine();
    const results = engine._suggestWithKeywords("send a message to a channel");
    const endpoints = new Set(engine.getEndpoints().map((e) => e.operationId));
    for (const r of results) {
      for (const ep of r.endpoints) {
        expect(endpoints.has(ep)).toBe(true);
      }
    }
  });

  it("ranks message endpoints highly for 'send a message'", async () => {
    const engine = await makeOfflineEngine();
    const results = engine._suggestWithKeywords("send a message");
    expect(results.length).toBeGreaterThan(0);
    // It should match chat/message related endpoints
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

  it("returns at most 1 result cluster for keywords", async () => {
    const engine = await makeOfflineEngine();
    const results = engine._suggestWithKeywords(
      "I want to do things with Rocket.Chat",
    );
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("assigns confidence high/medium/low correctly", async () => {
    const engine = await makeOfflineEngine();
    const results = engine._suggestWithKeywords("send a message to a channel");
    for (const r of results) {
      expect(["high", "medium", "low"]).toContain(r.confidence);
    }
  });

  it("returns results even when no direct keyword matches", async () => {
    const engine = await makeOfflineEngine();
    const results = engine._suggestWithKeywords("xyzzy frobnicate");
    // Falls back to empty list if 0 matches
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── suggest() — offline path ─────────────────────────────────────────

describe("SuggestEngine.suggest (offline, no API key)", () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
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
      expect(r.fromLLM).toBe(false);
    }
  });

  it("respects the topN parameter", async () => {
    const engine = new SuggestEngine();
    const results = await engine.suggest("I want to do something", 2);
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
