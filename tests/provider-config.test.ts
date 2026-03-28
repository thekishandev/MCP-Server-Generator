/**
 * Provider Config Tests
 *
 * Validates that the ProviderConfig interface and RocketChatProvider implementation
 * correctly match the existing hardcoded values used throughout the codebase.
 *
 * This ensures that when Phase 2 genericity is implemented, the RocketChatProvider
 * can be swapped into existing modules without behavior changes.
 */

import { describe, it, expect } from "vitest";
import {
  RocketChatProvider,
  ROCKETCHAT_DOMAINS,
  ROCKETCHAT_SYNONYMS,
  type ProviderConfig,
} from "../src/core/provider-config.js";

describe("ProviderConfig interface", () => {
  it("RocketChatProvider satisfies the ProviderConfig interface", () => {
    // TypeScript enforces this at compile time, but we verify at runtime too
    const provider: ProviderConfig = RocketChatProvider;
    expect(provider.name).toBe("rocketchat");
    expect(provider.displayName).toBe("Rocket.Chat");
    expect(provider.domainNames.length).toBeGreaterThan(0);
    expect(provider.authScheme.type).toBe("header");
    expect(provider.authScheme.headers).toContain("X-Auth-Token");
    expect(provider.authScheme.headers).toContain("X-User-Id");
  });

  it("RC domains match the hardcoded VALID_DOMAINS used in suggest-engine", () => {
    // These are the domains currently hardcoded in suggest-engine.ts
    const EXPECTED_DOMAINS = [
      "authentication",
      "messaging",
      "rooms",
      "user-management",
      "omnichannel",
      "integrations",
      "settings",
      "statistics",
      "notifications",
      "content-management",
      "marketplace-apps",
      "miscellaneous",
    ];

    expect([...ROCKETCHAT_DOMAINS]).toEqual(EXPECTED_DOMAINS);
  });

  it("RC synonyms cover all core domain keywords", () => {
    // Ensure synonyms exist for important concepts
    expect(ROCKETCHAT_SYNONYMS.message).toBeDefined();
    expect(ROCKETCHAT_SYNONYMS.channel).toBeDefined();
    expect(ROCKETCHAT_SYNONYMS.user).toBeDefined();
    expect(ROCKETCHAT_SYNONYMS.auth).toBeDefined();
    expect(ROCKETCHAT_SYNONYMS.admin).toBeDefined();
    expect(ROCKETCHAT_SYNONYMS.dm).toBeDefined();

    // Ensure key synonyms are present
    expect(ROCKETCHAT_SYNONYMS.message).toContain("chat");
    expect(ROCKETCHAT_SYNONYMS.channel).toContain("room");
    expect(ROCKETCHAT_SYNONYMS.dm).toContain("im");
  });

  it("RC auth scheme matches existing tool-generator auth handling", () => {
    // The tool-generator injects these exact header patterns
    expect(RocketChatProvider.authHeaderKeys).toContain("x-auth-token");
    expect(RocketChatProvider.authHeaderKeys).toContain("x-user-id");
    expect(RocketChatProvider.authHeaderKeys).toContain("x-2fa-code");
    expect(RocketChatProvider.authHeaderKeys).toContain("authorization");

    // Auth param names match what ToolGenerator injects into Zod schemas
    expect(RocketChatProvider.authScheme.authParamNames.token).toBe("authToken");
    expect(RocketChatProvider.authScheme.authParamNames.userId).toBe("userId");
  });

  it("RC apiPrefix strips versioned API paths correctly", () => {
    const path = "/api/v1/chat.postMessage";
    const stripped = path.replace(RocketChatProvider.apiPrefix, "");
    expect(stripped).toBe("chat.postMessage");
  });

  it("RC specSource has valid configuration", () => {
    expect(RocketChatProvider.specSource.baseUrl).toContain("RocketChat");
    expect(RocketChatProvider.specSource.fileExtension).toBe(".yaml");
    expect(RocketChatProvider.specSource.cacheDir).toBe(".cache");

    // domainToFilename should generate expected filenames
    const filename = RocketChatProvider.specSource.domainToFilename("messaging");
    expect(filename).toBe("messaging.yaml");
  });

  it("ProviderConfig supports per-request auth for Rocket.Chat", () => {
    expect(RocketChatProvider.authScheme.supportsPerRequestAuth).toBe(true);
  });
});
