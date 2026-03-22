/**
 * Provider Configuration Interface
 *
 * Abstracts the platform-specific configuration that currently hardcodes
 * the generator to Rocket.Chat. This interface defines the contract for
 * supporting additional platforms (e.g., Slack, Discord, Mattermost)
 * in Phase 2+ of the GSoC timeline.
 *
 * Currently, only the RocketChatProvider is implemented. This interface
 * exists to demonstrate architectural readiness for genericity (R6)
 * without blocking the MVP on a second provider implementation.
 */

/** Where to load OpenAPI specification files from. */
export interface SpecSource {
  /** Base URL for downloading spec files */
  baseUrl: string;
  /** File extension pattern (.yaml, .json, etc.) */
  fileExtension: string;
  /** Local cache directory */
  cacheDir: string;
  /** How to convert a domain name → spec filename */
  domainToFilename: (domain: string) => string;
}

/** How the platform handles authentication. */
export interface AuthScheme {
  /** Type of auth (header-based, bearer, api-key, oauth) */
  type: "header" | "bearer" | "api-key" | "oauth";
  /** Header names for injecting auth (e.g., X-Auth-Token, X-User-Id) */
  headers: string[];
  /** Whether auth can be set per-request via tool parameters */
  supportsPerRequestAuth: boolean;
  /** Names for auth parameters in generated tool schemas */
  authParamNames: AuthParamNames;
}

export interface AuthParamNames {
  token: string;
  userId: string;
}

/**
 * Platform-agnostic provider configuration.
 * Each supported platform (Rocket.Chat, Slack, Mattermost, etc.)
 * must implement this interface.
 */
export interface ProviderConfig {
  /** Unique provider identifier (e.g., "rocketchat", "slack") */
  name: string;

  /** Human-readable label */
  displayName: string;

  /** How to find and load the platform's OpenAPI specs */
  specSource: SpecSource;

  /** Valid API domains for this platform */
  domains: readonly string[];

  /** Domain-specific synonym expansion for intelligent discovery */
  synonymMap: Record<string, string[]>;

  /** Authentication configuration */
  authScheme: AuthScheme;

  /** API path prefix to strip when generating tool names */
  apiPathPrefix: RegExp;

  /** Auth header names to filter out of generated schemas */
  authHeaderNames: string[];
}

// ─── Rocket.Chat Implementation ──────────────────────────────────────

export const ROCKETCHAT_DOMAINS = [
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
] as const;

export const ROCKETCHAT_SYNONYMS: Record<string, string[]> = {
  message: ["chat", "post", "send", "text", "thread", "reply"],
  channel: ["room", "group", "discussion"],
  user: ["member", "people", "account", "profile"],
  auth: ["login", "credential", "token", "session", "2fa"],
  admin: ["setting", "config", "permission", "role"],
  dm: ["im", "direct", "private"],
  emoji: ["reaction", "react"],
  file: ["upload", "attachment"],
  search: ["find", "query", "lookup"],
  notification: ["push", "alert", "mention"],
};

export const RocketChatProvider: ProviderConfig = {
  name: "rocketchat",
  displayName: "Rocket.Chat",

  specSource: {
    baseUrl:
      "https://raw.githubusercontent.com/RocketChat/Rocket.Chat-Open-API/main",
    fileExtension: ".yaml",
    cacheDir: ".cache",
    domainToFilename: (domain: string) => `${domain}.yaml`,
  },

  domains: ROCKETCHAT_DOMAINS,

  synonymMap: ROCKETCHAT_SYNONYMS,

  authScheme: {
    type: "header",
    headers: ["X-Auth-Token", "X-User-Id"],
    supportsPerRequestAuth: true,
    authParamNames: {
      token: "authToken",
      userId: "userId",
    },
  },

  apiPathPrefix: /^\/api\/v[0-9]+\//,

  authHeaderNames: ["x-auth-token", "x-user-id", "x-2fa-code", "authorization"],
};
