import { describe, it, expect, beforeAll } from "vitest";
import { MinimalityAnalyzer } from "../src/core/minimality-analyzer.js";
import { SchemaExtractor } from "../src/core/schema-extractor.js";
import { CapabilityResolver } from "../src/core/capability-resolver.js";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = resolve(__dirname, "../src/providers/rocketchat/openapi");

describe("MinimalityAnalyzer", () => {
    const specsExist = existsSync(SPEC_DIR);
    const analyzer = new MinimalityAnalyzer();

    describe("analyze (with real specs)", () => {
        it.skipIf(!specsExist)(
            "should produce a complete minimality report for send-message",
            () => {
                const resolver = new CapabilityResolver();
                const resolved = resolver.resolve(["send-message"]);
                const extractor = new SchemaExtractor();
                extractor.loadFromDirectory(SPEC_DIR);
                const endpoints = extractor.extractEndpoints(resolved.endpoints);

                const report = analyzer.analyze(
                    SPEC_DIR,
                    endpoints,
                    ["send-message"]
                );

                // Endpoint metrics
                expect(report.endpoints.totalInSpecs).toBeGreaterThan(100);
                expect(report.endpoints.selectedEndpoints).toBe(2);
                expect(report.endpoints.pruningPercentage).toBeGreaterThan(99);

                // Schema metrics
                expect(report.schema.totalSpecSizeBytes).toBeGreaterThan(100000);
                expect(report.schema.minimalSpecSizeBytes).toBeLessThan(
                    report.schema.totalSpecSizeBytes
                );
                expect(report.schema.totalComponentsDefined).toBeGreaterThan(50);
                expect(report.schema.componentsUsed).toBeLessThan(
                    report.schema.totalComponentsDefined
                );

                // Token metrics
                expect(report.tokens.fullServerTokens).toBeGreaterThan(10000);
                expect(report.tokens.minimalServerTokens).toBeLessThan(5000);
                expect(report.tokens.tokenReductionPercentage).toBeGreaterThan(90);

                // Reduction summary
                expect(report.reduction.overallVerdict).toContain("EXCELLENT");
            }
        );
    });

    describe("formatReport", () => {
        it.skipIf(!specsExist)(
            "should format a report as a readable string",
            () => {
                const resolver = new CapabilityResolver();
                const resolved = resolver.resolve(["send-message"]);
                const extractor = new SchemaExtractor();
                extractor.loadFromDirectory(SPEC_DIR);
                const endpoints = extractor.extractEndpoints(resolved.endpoints);

                const report = analyzer.analyze(
                    SPEC_DIR,
                    endpoints,
                    ["send-message"]
                );
                const formatted = analyzer.formatReport(report);

                expect(formatted).toContain("MINIMALITY ANALYSIS REPORT");
                expect(formatted).toContain("ENDPOINT PRUNING");
                expect(formatted).toContain("SCHEMA WEIGHT");
                expect(formatted).toContain("TOKEN FOOTPRINT");
                expect(formatted).toContain("REDUCTION SUMMARY");
            }
        );
    });
});
