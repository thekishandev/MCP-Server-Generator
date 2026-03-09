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

/**
 * Create a SuggestEngine and force it into offline mode by ensuring
 * GEMINI_API_KEY is unset for the test scope.
 */
function makeOfflineEngine(): SuggestEngine {
    delete process.env.GEMINI_API_KEY;
    return new SuggestEngine();
}

// ─── Tokenizer ────────────────────────────────────────────────────────

describe("SuggestEngine._tokenize", () => {
    const engine = makeOfflineEngine();

    it("lowercases and splits on whitespace", () => {
        const tokens = engine._tokenize("Send A Message");
        expect(tokens).toContain("send");
        expect(tokens).toContain("message");
    });

    it("removes stop words", () => {
        const tokens = engine._tokenize("send a message to a channel");
        expect(tokens).not.toContain("a");
        expect(tokens).not.toContain("to");
    });

    it("replaces non-alphanumeric chars with spaces (except hyphens)", () => {
        const tokens = engine._tokenize("/api/v1/chat.postMessage");
        expect(tokens).not.toContain("/api/v1/chat.postmessage");
        expect(tokens).toContain("chat");
        expect(tokens).toContain("postmessage");
    });

    it("filters single-character tokens", () => {
        const tokens = engine._tokenize("a b c send");
        expect(tokens.every((t) => t.length > 1)).toBe(true);
        expect(tokens).toContain("send");
    });
});

// ─── Keyword Scorer ───────────────────────────────────────────────────

describe("SuggestEngine._suggestWithKeywords", () => {
    const engine = makeOfflineEngine();

    it("returns valid capability names only", () => {
        const results = engine._suggestWithKeywords("send a message to a channel");
        const registry = engine.getRegistry();
        for (const r of results) {
            expect(r.capability in registry).toBe(true);
        }
    });

    it("ranks send-message first for 'send a message'", () => {
        const results = engine._suggestWithKeywords("send a message");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.capability).toBe("send-message");
    });

    it("ranks manage-channels first for 'create and archive channels'", () => {
        const results = engine._suggestWithKeywords("create and archive channels");
        expect(results[0]!.capability).toBe("manage-channels");
    });

    it("returns at most 3 results", () => {
        const results = engine._suggestWithKeywords("I want to do things with Rocket.Chat");
        expect(results.length).toBeLessThanOrEqual(3);
    });

    it("assigns confidence high/medium/low correctly", () => {
        const results = engine._suggestWithKeywords("send a message to a channel");
        for (const r of results) {
            expect(["high", "medium", "low"]).toContain(r.confidence);
        }
    });

    it("returns results even when no keyword matches (covers all capabilities)", () => {
        const results = engine._suggestWithKeywords("xyzzy frobnicate");
        // Falls back to showing all caps when every score is 0
        expect(results.length).toBeGreaterThan(0);
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

    it("enriches results with deterministic endpoint data from registry", async () => {
        const engine = new SuggestEngine();
        const results = await engine.suggest("send a message");
        const sendMsg = results.find((r) => r.capability === "send-message");
        expect(sendMsg).toBeDefined();
        expect(sendMsg!.endpoints).toContain("/api/v1/chat.postMessage");
        expect(sendMsg!.endpointCount).toBe(2);
    });

    it("respects the topN parameter", async () => {
        const engine = new SuggestEngine();
        const results = await engine.suggest("I want to do something", 2);
        expect(results.length).toBeLessThanOrEqual(2);
    });
});

// ─── Hallucination guard (registry validation filter) ─────────────────

describe("SuggestEngine — hallucination guard", () => {
    it("filters out capability names that don't exist in the registry", async () => {
        delete process.env.GEMINI_API_KEY;
        const engine = new SuggestEngine();

        // Spy on the private keyword scorer and inject a fake result
        const spy = vi.spyOn(
            engine as unknown as { _suggestWithKeywords: (i: string) => unknown[] },
            "_suggestWithKeywords"
        ).mockReturnValue([
            { capability: "send-message",          reason: "valid",   confidence: "high" },
            { capability: "hallucinated-capability", reason: "invalid", confidence: "high" },
            { capability: "fake-endpoint-blaster",  reason: "invalid", confidence: "medium" },
        ]);

        const results = await engine.suggest("test");
        const names = results.map((r) => r.capability);

        expect(names).toContain("send-message");
        expect(names).not.toContain("hallucinated-capability");
        expect(names).not.toContain("fake-endpoint-blaster");

        spy.mockRestore();
    });

    it("deduplicates repeated capability names", async () => {
        delete process.env.GEMINI_API_KEY;
        const engine = new SuggestEngine();

        const spy = vi.spyOn(
            engine as unknown as { _suggestWithKeywords: (i: string) => unknown[] },
            "_suggestWithKeywords"
        ).mockReturnValue([
            { capability: "send-message", reason: "first",  confidence: "high" },
            { capability: "send-message", reason: "second", confidence: "medium" },
        ]);

        const results = await engine.suggest("test");
        const sendMsgResults = results.filter((r) => r.capability === "send-message");
        expect(sendMsgResults.length).toBe(1);

        spy.mockRestore();
    });
});
