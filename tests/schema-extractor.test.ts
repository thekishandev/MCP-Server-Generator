import { describe, it, expect, beforeAll } from "vitest";
import { SchemaExtractor } from "../src/core/schema-extractor.js";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = resolve(__dirname, "../src/providers/rocketchat/openapi");

describe("SchemaExtractor", () => {
    let extractor: SchemaExtractor;
    const specsExist = existsSync(SPEC_DIR);

    beforeAll(() => {
        if (!specsExist) return;
        extractor = new SchemaExtractor();
        extractor.loadFromDirectory(SPEC_DIR);
    });

    describe("loadFromDirectory", () => {
        it.skipIf(!specsExist)(
            "should load all spec files and index endpoints",
            () => {
                expect(extractor.getEndpointCount()).toBeGreaterThan(100);
            }
        );
    });

    describe("extractEndpoints", () => {
        it.skipIf(!specsExist)(
            "should extract login endpoint schema",
            () => {
                const endpoints = extractor.extractEndpoints(["/api/v1/login"]);
                expect(endpoints).toHaveLength(1);
                expect(endpoints[0].path).toBe("/api/v1/login");
                expect(endpoints[0].method).toBe("post");
            }
        );

        it.skipIf(!specsExist)(
            "should extract chat.postMessage with parameters",
            () => {
                const endpoints = extractor.extractEndpoints([
                    "/api/v1/chat.postMessage",
                ]);
                expect(endpoints).toHaveLength(1);
                expect(endpoints[0].operationId).toBeTruthy();
            }
        );

        it.skipIf(!specsExist)(
            "should throw for non-existent path",
            () => {
                expect(() =>
                    extractor.extractEndpoints(["/api/v1/nonexistent.endpoint"])
                ).toThrow("Endpoint not found");
            }
        );

        it.skipIf(!specsExist)(
            "should extract multiple endpoints at once",
            () => {
                const endpoints = extractor.extractEndpoints([
                    "/api/v1/login",
                    "/api/v1/chat.postMessage",
                    "/api/v1/channels.create",
                ]);
                expect(endpoints.length).toBeGreaterThanOrEqual(2);
            }
        );
    });
});
