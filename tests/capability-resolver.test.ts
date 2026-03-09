import { describe, it, expect } from "vitest";
import { CapabilityResolver } from "../src/core/capability-resolver.js";

describe("CapabilityResolver", () => {
    const resolver = new CapabilityResolver();

    describe("listCapabilities", () => {
        it("should return all 5 built-in capabilities", () => {
            const caps = resolver.listCapabilities();
            expect(caps.length).toBe(5);
            const names = caps.map((c) => c.name);
            expect(names).toContain("send-message");
            expect(names).toContain("read-messages");
            expect(names).toContain("manage-channels");
            expect(names).toContain("manage-users");
            expect(names).toContain("file-upload");
        });

        it("should include endpoint counts for each capability", () => {
            const caps = resolver.listCapabilities();
            for (const cap of caps) {
                expect(cap.endpointCount).toBeGreaterThan(0);
                expect(cap.description).toBeTruthy();
            }
        });
    });

    describe("resolve", () => {
        it("should resolve send-message to 2 endpoints", () => {
            const result = resolver.resolve(["send-message"]);
            expect(result.endpoints.length).toBe(2);
            expect(result.endpoints).toContain("/api/v1/login");
            expect(result.endpoints).toContain("/api/v1/chat.postMessage");
        });

        it("should deduplicate shared endpoints across capabilities", () => {
            const single = resolver.resolve(["send-message"]);
            const multi = resolver.resolve(["send-message", "read-messages"]);
            // Both include /api/v1/login, should only appear once
            const loginCount = multi.endpoints.filter(
                (e) => e === "/api/v1/login"
            ).length;
            expect(loginCount).toBe(1);
            expect(multi.endpoints.length).toBeGreaterThan(single.endpoints.length);
        });

        it("should throw on unknown capability", () => {
            expect(() => resolver.resolve(["nonexistent-capability"])).toThrow();
        });

        it("should handle multiple capabilities", () => {
            const result = resolver.resolve([
                "send-message",
                "read-messages",
                "manage-channels",
            ]);
            expect(result.endpoints.length).toBeGreaterThan(5);
        });
    });
});
