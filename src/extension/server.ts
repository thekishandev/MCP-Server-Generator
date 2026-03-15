import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  SchemaExtractor,
  ToolGenerator,
  ServerScaffolder,
  MinimalityAnalyzer,
} from "../core/index.js";
import { VALID_DOMAINS, type Domain } from "../core/types.js";

const server = new McpServer({
  name: "rc-mcp-generator",
  version: "0.2.0",
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OPENAPI_SPEC_DIR = resolve(
  __dirname,
  "../../src/providers/rocketchat/openapi",
);

// Tool 1: Discover endpoints
server.tool(
  "rc_discover_endpoints",
  "Browse Rocket.Chat API endpoints by domain. Returns tag summaries by default. Use `expand` to reveal individual endpoints for specific tags.",
  {
    domains: z.array(z.enum(VALID_DOMAINS)).describe("RC API domains to query"),
    expand: z
      .array(z.string())
      .optional()
      .describe('Tag names to expand (use ["*"] for all)'),
  },
  async ({ domains, expand }) => {
    try {
      const extractor = new SchemaExtractor();
      await extractor.loadDomains(domains as Domain[]);

      const tagGroups = extractor.getEndpointsByTag(domains as Domain[]);
      const expandAll = expand?.includes("*");
      const expandedList = expand ?? [];

      let result = "";

      for (const domain of domains as Domain[]) {
        const tags = tagGroups.get(domain);
        if (!tags) continue;

        let domainCount = 0;
        let tagCount = 0;
        for (const endpoints of tags.values()) {
          domainCount += endpoints.length;
          tagCount++;
        }

        result += `── ${domain} (${domainCount} endpoints, ${tagCount} tags) ──\n`;

        for (const [tag, endpoints] of tags.entries()) {
          if (expandAll || expandedList.includes(tag)) {
            result += `  ▶ ${tag} (${endpoints.length} endpoints)\n`;
            for (let i = 0; i < endpoints.length; i++) {
              const ep = endpoints[i]!;
              result += `    ${i + 1}. ${ep.operationId.padEnd(40)} ${ep.method.toUpperCase()} — ${ep.summary}\n`;
            }
          } else {
            result += `    ${tag} (${endpoints.length} endpoints)\n`;
          }
        }
        result += "\n";
      }

      return {
        content: [
          { type: "text", text: result.trimEnd() || "No endpoints found." },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error discovering endpoints: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 2: Suggest endpoints based on intent (v2: multi-cluster, cross-domain)
server.tool(
  "rc_suggest_endpoints",
  "Map a natural language description of what you want to do with Rocket.Chat to specific API endpoint clusters. Returns MULTIPLE clusters grouped by functional area (e.g., channel-management, messaging, user-discovery) to cover ALL parts of the intent. Uses synonym expansion and TF-IDF scoring for accurate cross-domain matching.",
  {
    intent: z
      .string()
      .describe(
        'What the user wants to do, e.g., "create project channel, invite members, send task updates and star important messages"',
      ),
  },
  async ({ intent }) => {
    try {
      const { SuggestEngine } = await import("../core/suggest-engine.js");
      const engine = new SuggestEngine();
      const suggestions = await engine.suggest(intent, 5);

      if (suggestions.length === 0) {
        return {
          content: [{ type: "text", text: "No matching endpoints found for this intent. Try rc_search_endpoints for a broader text search, or rc_discover_endpoints to browse by domain." }],
        };
      }

      let result = `Suggestions for intent: "${intent}"\n\n`;
      const allEndpoints: string[] = [];

      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i]!;
        result += `${i + 1}. ${s.capability} (Confidence: ${s.confidence})\n`;
        result += `   Reason: ${s.reason}\n`;
        result += `   Endpoints: ${s.endpoints.join(", ")}\n\n`;
        allEndpoints.push(...s.endpoints);
      }

      result += `\n── Combined Endpoint List (${allEndpoints.length} total) ──\n`;
      result += allEndpoints.map((ep, i) => `  ${i + 1}. ${ep}`).join("\n");

      return {
        content: [{ type: "text", text: result.trimEnd() }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error suggesting endpoints: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 2b: Search endpoints by text query
server.tool(
  "rc_search_endpoints",
  "Search across ALL Rocket.Chat API endpoints by text query. Matches against operationId, summary, description, path, and tags with synonym expansion. Use this to find specific endpoints when you know what you're looking for, or to fill gaps after rc_suggest_endpoints.",
  {
    query: z
      .string()
      .describe(
        'Search terms, e.g., "star message" or "invite user channel"',
      ),
    domains: z
      .array(z.enum(VALID_DOMAINS))
      .optional()
      .describe("Limit search to specific domains"),
    limit: z
      .number()
      .optional()
      .describe("Max results (default 20)"),
  },
  async ({ query, domains, limit }) => {
    try {
      const { SuggestEngine } = await import("../core/suggest-engine.js");
      const engine = new SuggestEngine();
      const results = await engine.searchEndpoints(query, { domains, limit });

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No endpoints found matching "${query}". Try broader terms or rc_discover_endpoints to browse.` }],
        };
      }

      let output = `Search results for "${query}" (${results.length} matches):\n\n`;
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        output += `  ${i + 1}. ${r.operationId.padEnd(45)} ${r.method} — ${r.summary} [${r.domain}]\n`;
      }

      return {
        content: [{ type: "text", text: output.trimEnd() }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching endpoints: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 3: Generate Server
server.tool(
  "rc_generate_server",
  "Generate a complete, minimal MCP server project containing only the specified Rocket.Chat API operationIds.",
  {
    operationIds: z
      .array(z.string())
      .describe(
        'API operationIds to include (e.g., ["post-api-v1-chat_postMessage"])',
      ),
    outputDir: z.string().describe("Directory to output the generated server"),
    serverName: z.string().optional().describe("Name for the generated server"),
  },
  async ({ operationIds, outputDir, serverName }) => {
    try {
      // Find which domains these operationIds belong to (requires all domains to be loaded for now)
      const extractor = new SchemaExtractor();
      await extractor.loadDomains([...VALID_DOMAINS]);

      let endpoints = extractor.extractEndpointsForIds(operationIds);

      // Auto-add login if auth is required
      const needsAuth = endpoints.some((ep) => ep.requiresAuth);
      const hasLogin = endpoints.some(
        (ep) =>
          ep.operationId === "post-api-v1-login" || ep.path.includes("login"),
      );

      if (needsAuth && !hasLogin) {
        // find login endpoint manually
        const allEndpoints = Array.from(
          (extractor as any).endpointIndex.values() as any[],
        );
        const loginEndpoint = allEndpoints.filter(
          (ep: any) => ep.path === "/api/v1/login",
        );
        if (loginEndpoint && loginEndpoint.length > 0) {
          endpoints.push(loginEndpoint[0]!);
        }
      }

      const generator = new ToolGenerator();
      const tools = generator.generateTools(endpoints);

      const name = serverName ?? "rc-mcp-server";
      const absOutputDir = resolve(outputDir);

      const config = {
        name,
        description: `Minimal MCP server for Rocket.Chat generated by rc-mcp.`,
        capabilities: [],
        outputDir: absOutputDir,
      };

      const scaffolder = new ServerScaffolder();
      const files = scaffolder.scaffold(tools, config);
      scaffolder.writeFiles(files, absOutputDir);

      return {
        content: [
          {
            type: "text",
            text: `Server successfully generated at ${absOutputDir} with ${endpoints.length} endpoints.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error generating server: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 4: Analyze Minimality
server.tool(
  "rc_analyze_minimality",
  "Analyze and prove the context reduction for a set of Rocket.Chat API operationIds vs the full API surface.",
  {
    operationIds: z.array(z.string()).describe("API operationIds to analyze"),
  },
  async ({ operationIds }) => {
    try {
      const extractor = new SchemaExtractor();
      await extractor.loadDomains([...VALID_DOMAINS]);
      const endpoints = extractor.extractEndpointsForIds(operationIds);

      const analyzer = new MinimalityAnalyzer();
      // Pass OPENAPI_SPEC_DIR as placeholder, MinimalityAnalyzer currently reads raw files for schema size
      // We should ideally update MinimalityAnalyzer to use the parsed JSON, but for now this works if specs are cached
      const report = analyzer.analyze(OPENAPI_SPEC_DIR, endpoints, []);

      return {
        content: [{ type: "text", text: analyzer.formatReport(report) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error analyzing minimality: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 5: Validate Server
server.tool(
  "rc_validate_server",
  "Validate a generated MCP server for structural correctness and MCP compliance.",
  {
    serverDir: z
      .string()
      .describe("Path to the generated MCP server directory"),
    deep: z.boolean().optional().describe("Run TypeScript type-check"),
  },
  async ({ serverDir, deep }) => {
    try {
      const absDir = resolve(serverDir);
      if (!existsSync(absDir)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Server directory not found at ${absDir}`,
            },
          ],
          isError: true,
        };
      }

      let result = `Validating: ${absDir}\n\n`;

      // Structural
      result += "─── Structure ───\n";
      const requiredFiles = [
        "package.json",
        "tsconfig.json",
        "src/server.ts",
        "src/rc-client.ts",
        "src/auth.ts",
        ".env.example",
      ];
      for (const file of requiredFiles) {
        if (existsSync(resolve(absDir, file))) result += `  ✓ ${file}\n`;
        else result += `  ✗ ${file} — missing\n`;
      }

      // MCP Compliance
      result += "\n─── MCP Compliance ───\n";
      const pkgPath = resolve(absDir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.dependencies?.["@modelcontextprotocol/sdk"])
          result += "  ✓ @modelcontextprotocol/sdk dependency present\n";
        else result += "  ✗ @modelcontextprotocol/sdk dependency missing\n";

        if (pkg.dependencies?.["zod"]) result += "  ✓ zod dependency present\n";
        else result += "  ✗ zod dependency missing\n";
      }

      // Zod Schema & Tool Checks
      result += "\n─── Tool Coverage ───\n";
      const toolsDir = resolve(absDir, "src/tools");
      const testsDir = resolve(absDir, "tests");
      if (existsSync(toolsDir)) {
        const { readdirSync } = await import("fs");
        const toolFiles = readdirSync(toolsDir).filter((f) =>
          f.endsWith(".ts"),
        );
        result += `  ✓ ${toolFiles.length} tool file(s) found\n`;

        // Check each tool for Zod schema export
        for (const tf of toolFiles) {
          const toolContent = readFileSync(resolve(toolsDir, tf), "utf-8");
          if (toolContent.includes("z.object")) {
            result += `  ✓ ${tf} — Zod schema present\n`;
          } else {
            result += `  ✗ ${tf} — Zod schema missing\n`;
          }
        }

        // Check test coverage
        if (existsSync(testsDir)) {
          const testFiles = readdirSync(testsDir).filter((f) =>
            f.endsWith(".test.ts"),
          );
          result += `  ✓ ${testFiles.length} test file(s) found\n`;
          for (const tf of toolFiles) {
            const testName = tf.replace(".ts", ".test.ts");
            if (testFiles.includes(testName)) {
              result += `  ✓ ${testName} — test exists\n`;
            } else {
              result += `  ⚠ ${testName} — test missing\n`;
            }
          }
        } else {
          result += "  ⚠ tests/ directory not found\n";
        }
      } else {
        result += "  ⚠ src/tools/ directory not found\n";
      }

      if (deep) {
        result += "\n─── Type Safety (Deep) ───\n";
        try {
          const { execSync } = await import("child_process");
          execSync("npx tsc --noEmit", { cwd: absDir, stdio: "pipe" });
          result += "  ✓ TypeScript compilation — 0 errors\n";
        } catch (err) {
          result += `  ✗ TypeScript compilation failed\n`;
        }
      }

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error validating server: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rocket.Chat MCP Generator Extension Server running via stdio");
}

// Only run main if executed directly, not if imported for testing
if (process.argv[1]?.endsWith("extension/server.js")) {
  main().catch((error) => {
    console.error("Fatal error in extension server:", error);
    process.exit(1);
  });
}

export { server as mcpServer };
