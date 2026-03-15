/**
 * Synonym Map
 *
 * Maps common user intent terms to API-specific vocabulary used in the
 * Rocket.Chat OpenAPI specs. This bridges the gap between how users describe
 * actions ("invite members") and how the API names them ("channels.invite",
 * "channels.addAll").
 *
 * Also provides domain hints: for a given intent keyword, which API domains
 * are most likely to contain relevant endpoints.
 */

// ─── Intent → API Term Synonyms ──────────────────────────────────────

/**
 * Each key is a normalized intent term (what users say).
 * Each value is an array of API terms that should also match (what the API calls it).
 */
export const SYNONYM_MAP: Record<string, string[]> = {
  // Messaging
  send: ["send", "post", "message", "chat"],
  message: ["message", "chat", "post", "send"],
  reply: ["reply", "thread", "message", "follow"],
  thread: ["thread", "follow", "message"],
  react: ["react", "emoji", "reaction"],
  pin: ["pin", "pinmessage", "pinned"],
  star: ["star", "starmessage", "starred", "bookmark", "favorite"],
  unstar: ["unstar", "unstarmessage"],
  search: ["search", "find", "query"],
  delete: ["delete", "remove", "destroy"],
  update: ["update", "edit", "modify", "set", "change", "post", "send"],

  // Channels / Rooms — Note: "channel" and "group" are DISTINCT RC concepts
  channel: ["channel", "room"],
  group: ["group", "private"],
  create: ["create", "new", "make", "open"],
  invite: ["invite", "add", "join", "member"],
  kick: ["kick", "remove", "ban", "exclude"],
  join: ["join", "enter", "subscribe"],
  leave: ["leave", "exit", "unsubscribe", "close"],
  archive: ["archive", "close", "deactivate"],
  description: ["description", "setdescription", "purpose", "topic"],
  topic: ["topic", "settopic", "subject"],
  announcement: ["announcement", "setannouncement", "notice", "pin", "broadcast"],
  rename: ["rename", "name", "title"],

  // User Management
  user: ["user", "member", "people", "person"],
  member: ["member", "user", "participant"],
  team: ["member", "user", "participant"],
  list: ["list", "get", "fetch", "show", "browse", "view"],
  info: ["info", "detail", "information", "get", "profile"],
  status: ["status", "presence", "online", "available"],
  avatar: ["avatar", "photo", "picture", "image"],
  role: ["role", "permission", "admin", "moderator", "owner", "leader"],

  // DM
  dm: ["dm", "direct", "im", "private"],
  direct: ["direct", "dm", "im", "private"],

  // Omnichannel
  livechat: ["livechat", "omnichannel", "agent", "visitor"],
  agent: ["agent", "livechat", "omnichannel"],
  visitor: ["visitor", "guest", "livechat"],
  queue: ["queue", "routing", "livechat"],

  // Integrations
  webhook: ["webhook", "integration", "incoming", "outgoing"],
  integration: ["integration", "webhook", "connect"],

  // Settings
  setting: ["setting", "config", "preference", "permission"],
  permission: ["permission", "role", "access", "setting"],

  // Statistics
  statistic: ["statistic", "stat", "metric", "analytics", "report", "count"],
  metric: ["metric", "statistic", "analytics", "dashboard"],

  // Notifications
  notification: ["notification", "push", "alert", "notify"],
  push: ["push", "notification", "mobile"],

  // Natural language intent helpers
  task: ["task", "update", "message", "post"],
  important: ["important", "star", "pin", "bookmark", "favorite"],
  monitor: ["monitor", "check", "track", "observe", "watch"],
  transfer: ["transfer", "forward", "route", "redirect", "move"],
  assign: ["assign", "take", "allocate", "route"],
  conversation: ["conversation", "chat", "room", "thread"],
  manage: ["manage", "admin", "control", "configure"],
  server: ["server", "workspace", "instance"],

  // Content
  emoji: ["emoji", "emoticon", "reaction", "custom"],
  asset: ["asset", "file", "upload", "attachment"],
  file: ["file", "upload", "attachment", "download"],
  upload: ["upload", "file", "attach", "send"],

  // Marketplace
  app: ["app", "marketplace", "install", "extension"],
  marketplace: ["marketplace", "app", "store"],
};

// ─── Domain Hints ─────────────────────────────────────────────────────

/**
 * Maps intent keywords to the most relevant API domains.
 * This helps the suggest engine know which domains to search when a user
 * expresses an intent, even before doing keyword matching.
 */
export const DOMAIN_HINTS: Record<string, string[]> = {
  // Messaging terms
  send: ["messaging"],
  message: ["messaging"],
  chat: ["messaging"],
  post: ["messaging"],
  reply: ["messaging"],
  thread: ["messaging"],
  react: ["messaging"],
  pin: ["messaging"],
  star: ["messaging"],
  unstar: ["messaging"],

  // Room terms → both rooms and messaging
  channel: ["rooms"],
  room: ["rooms"],
  group: ["rooms"],
  create: ["rooms"],
  invite: ["rooms", "user-management"],
  kick: ["rooms"],
  join: ["rooms"],
  leave: ["rooms"],
  archive: ["rooms"],
  description: ["rooms"],
  topic: ["rooms"],
  announcement: ["rooms"],
  rename: ["rooms"],
  dm: ["messaging"],
  direct: ["messaging"],

  // User terms
  user: ["user-management"],
  member: ["user-management", "rooms"],
  team: ["rooms", "user-management"],
  people: ["user-management"],
  role: ["user-management"],
  permission: ["user-management", "settings"],
  avatar: ["user-management"],
  presence: ["user-management"],
  status: ["user-management"],
  manage: ["user-management", "settings"],
  roles: ["user-management"],

  // Omnichannel
  livechat: ["omnichannel"],
  omnichannel: ["omnichannel"],
  agent: ["omnichannel"],
  visitor: ["omnichannel"],
  queue: ["omnichannel"],

  // Integrations
  webhook: ["integrations"],
  integration: ["integrations"],

  // Settings
  setting: ["settings"],
  config: ["settings"],

  // Statistics
  statistic: ["statistics"],
  stat: ["statistics"],
  metric: ["statistics"],
  analytics: ["statistics"],
  dashboard: ["statistics"],
  monitor: ["statistics", "user-management"],

  // Notifications
  notification: ["notifications"],
  push: ["notifications"],

  // Content
  emoji: ["content-management"],
  asset: ["content-management"],

  // File (could be messaging or content)
  file: ["messaging", "content-management"],
  upload: ["messaging", "content-management"],

  // Marketplace
  app: ["marketplace-apps"],
  marketplace: ["marketplace-apps"],

  // Auth
  login: ["authentication"],
  auth: ["authentication"],
  token: ["authentication"],
  "2fa": ["authentication"],

  // Misc
  server: ["statistics", "miscellaneous"],
  license: ["miscellaneous"],
  dns: ["miscellaneous"],
};

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Expand a list of intent tokens using the synonym map.
 * Returns the original tokens PLUS all synonym expansions (deduplicated).
 */
export function expandWithSynonyms(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const synonyms = SYNONYM_MAP[token];
    if (synonyms) {
      for (const syn of synonyms) {
        expanded.add(syn);
      }
    }
  }
  return Array.from(expanded);
}

/**
 * Infer which API domains are most relevant for the given intent tokens.
 * Returns domains ordered by frequency of mention.
 */
export function inferDomains(tokens: string[]): string[] {
  const domainCounts = new Map<string, number>();

  for (const token of tokens) {
    const hints = DOMAIN_HINTS[token];
    if (hints) {
      for (const domain of hints) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      }
    }
  }

  return Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);
}
