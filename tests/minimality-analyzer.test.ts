import { describe, it, expect, beforeAll } from "vitest";
import { MinimalityAnalyzer } from "../src/core/minimality-analyzer.js";
import { SchemaExtractor } from "../src/core/schema-extractor.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ROCKETCHAT_DOMAINS } from "../src/core/provider-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The tests still mock a fake directory pointing to some cache if needed,
// but for now we pass a dummy string since analyze() doesn't strict check it until reading.
// Actually, MinimalityAnalyzer reads the raw YAMLs to count bytes, so we need a valid path if it expects one.
// The real CLI fetches remotely now. We'll pass a dummy dir.
const SPEC_DIR = "/tmp/dummy";

describe("MinimalityAnalyzer", () => {
  const analyzer = new MinimalityAnalyzer();

  describe("analyze (with loaded endpoints)", () => {
    it("should produce a complete minimality report for send-message operationId", async () => {
      const extractor = new SchemaExtractor();
      await extractor.loadDomains([...ROCKETCHAT_DOMAINS]);
      const allEndpoints = Array.from(
        (extractor as any).endpointIndex.values() as any[],
      );
      const endpoints = allEndpoints.filter(
        (ep: any) =>
          ep.operationId === "post-api-v1-chat-sendMessage" ||
          ep.path === "/api/v1/login",
      );

      const report = analyzer.analyze(SPEC_DIR, endpoints, ["send-message"]);

      // Endpoint metrics
      expect(report.endpoints.totalInSpecs).toBeGreaterThan(100);
      expect(report.endpoints.selectedEndpoints).toBeGreaterThanOrEqual(1);
      expect(report.endpoints.pruningPercentage).toBeGreaterThan(99);

      // Schema metrics
      expect(report.schema.totalSpecSizeBytes).toBeGreaterThan(100000);
      expect(report.schema.minimalSpecSizeBytes).toBeLessThan(
        report.schema.totalSpecSizeBytes,
      );
      expect(report.schema.totalComponentsDefined).toBeGreaterThan(50);
      expect(report.schema.componentsUsed).toBeLessThan(
        report.schema.totalComponentsDefined,
      );

      // Token metrics
      expect(report.tokens.fullServerTokens).toBeGreaterThan(10000);
      expect(report.tokens.minimalServerTokens).toBeLessThan(5000);
      expect(report.tokens.tokenReductionPercentage).toBeGreaterThan(90);

      // Reduction summary
      expect(report.reduction.overallVerdict).toContain("EXCELLENT");
    }, 30_000);
  });

  describe("formatReport", () => {
    it("should format a report as a readable string", async () => {
      const extractor = new SchemaExtractor();
      await extractor.loadDomains([...ROCKETCHAT_DOMAINS]);
      const allEndpoints = Array.from(
        (extractor as any).endpointIndex.values() as any[],
      );
      const endpoints = allEndpoints.filter(
        (ep: any) =>
          ep.operationId === "post-api-v1-chat-sendMessage" ||
          ep.path === "/api/v1/login",
      );

      const report = analyzer.analyze(SPEC_DIR, endpoints, ["send-message"]);
      const formatted = analyzer.formatReport(report);

      expect(formatted).toContain("MINIMALITY ANALYSIS REPORT");
      expect(formatted).toContain("ENDPOINT PRUNING");
      expect(formatted).toContain("SCHEMA WEIGHT");
      expect(formatted).toContain("TOKEN FOOTPRINT");
      expect(formatted).toContain("REDUCTION SUMMARY");
    }, 30_000);
  });
});
