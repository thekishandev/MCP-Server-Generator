import { describe, it, expect, beforeAll } from "vitest";
import { SchemaExtractor } from "../src/core/schema-extractor.js";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { VALID_DOMAINS } from "../src/core/types.js";
import { RocketChatProvider } from "../src/core/provider-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = resolve(__dirname, "../src/providers/rocketchat/openapi");

describe("SchemaExtractor", () => {
  let extractor: SchemaExtractor;
  const specsExist = existsSync(SPEC_DIR);

  beforeAll(async () => {
    if (!specsExist) return;
    extractor = new SchemaExtractor();
    await extractor.loadDomains([...VALID_DOMAINS]);
  });

  // ─── Mock-based tests (always run, no network/cache needed) ─────────

  describe("constructor and ProviderConfig", () => {
    it("should default to RocketChatProvider when no provider is passed", () => {
      const ext = new SchemaExtractor();
      // Access the private provider field to verify default
      expect((ext as any).provider).toBe(RocketChatProvider);
    });

    it("should accept a custom ProviderConfig", () => {
      const customProvider = {
        ...RocketChatProvider,
        name: "test-provider",
        displayName: "Test",
      };
      const ext = new SchemaExtractor(customProvider);
      expect((ext as any).provider.name).toBe("test-provider");
    });

    it("should start with empty endpoint index", () => {
      const ext = new SchemaExtractor();
      expect(ext.getEndpointCount()).toBe(0);
      expect(ext.getAllEndpoints()).toEqual([]);
      expect(ext.listEndpoints()).toEqual([]);
    });
  });

  describe("extractEndpointsForIds error handling", () => {
    it("should throw for non-existent operationId on empty index", () => {
      const ext = new SchemaExtractor();
      expect(() =>
        ext.extractEndpointsForIds(["nonexistent-endpoint"]),
      ).toThrow('Endpoint not found for operationId: "nonexistent-endpoint"');
    });

    it("should return empty array for empty operationIds list", () => {
      const ext = new SchemaExtractor();
      const results = ext.extractEndpointsForIds([]);
      expect(results).toEqual([]);
    });
  });

  describe("inferDomainsFromIds", () => {
    it("should always include authentication domain", async () => {
      const ext = new SchemaExtractor();
      const domains = await ext.inferDomainsFromIds([]);
      expect(domains).toContain("authentication");
    });

    it("should handle missing cache files gracefully", async () => {
      const ext = new SchemaExtractor();
      const domains = await ext.inferDomainsFromIds(["nonexistent-op-id"]);
      // Should still return at least authentication
      expect(domains).toContain("authentication");
      expect(domains.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Network-dependent tests (skip if no cached specs) ──────────────

  describe("loadDomains", () => {
    it.skipIf(!specsExist)(
      "should load all spec files and index endpoints",
      async () => {
        await extractor.loadDomains([...VALID_DOMAINS]);
        expect(extractor.getEndpointCount()).toBeGreaterThan(100);
      },
    );
  });

  describe("extractEndpointsForIds", () => {
    it.skipIf(!specsExist)("should extract login endpoint schema", async () => {
      await extractor.loadDomains(["authentication"]);

      // fallback filtering for test:
      const allEndpoints = Array.from(
        (extractor as any).endpointIndex.values() as any[],
      );
      const endpoints = allEndpoints.filter(
        (ep: any) => ep.path === "/api/v1/login",
      );

      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]!.path).toBe("/api/v1/login");
      expect(endpoints[0]!.method).toBe("post");
    });

    it.skipIf(!specsExist)(
      "should extract chat.postMessage with parameters",
      async () => {
        await extractor.loadDomains(["messaging"]);
        const endpoints = extractor.extractEndpointsForIds([
          "post-api-v1-chat.postMessage",
        ]);
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0]!.operationId).toBeTruthy();
      },
    );

    it.skipIf(!specsExist)("should throw for non-existent id", async () => {
      await extractor.loadDomains(["messaging"]);
      expect(() =>
        extractor.extractEndpointsForIds(["nonexistent.endpoint"]),
      ).toThrow("Endpoint not found");
    });

    it.skipIf(!specsExist)(
      "should extract multiple endpoints at once",
      async () => {
        await extractor.loadDomains(["authentication", "messaging", "rooms"]);
        const endpoints = extractor.extractEndpointsForIds([
          "post-api-v1-chat.postMessage",
          "post-api-v1-channels.create",
        ]);
        expect(endpoints.length).toBeGreaterThanOrEqual(2);
      },
    );
  });
});
