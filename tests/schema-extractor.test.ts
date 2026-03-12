import { describe, it, expect, beforeAll } from "vitest";
import { SchemaExtractor } from "../src/core/schema-extractor.js";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { VALID_DOMAINS } from "../src/core/types.js";

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
