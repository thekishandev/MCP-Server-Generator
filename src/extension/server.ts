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
  WorkflowRegistry,
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

      const allEndpoints: string[] = [];
      let result = `Intent: "${intent}"\n`;

      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i]!;
        result += `\n${i + 1}. [${s.confidence}] ${s.capability}: ${s.endpoints.join(", ")}\n`;
        allEndpoints.push(...s.endpoints);
      }

      result += `\nCombined (${allEndpoints.length}): ${allEndpoints.join(", ")}`;

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
  "Generate a complete, minimal MCP server project. Asks for Rocket.Chat credentials to bake into .env so the server is pre-configured on first run. Automatically runs npm install + build and registers the server with Gemini CLI.",
  {
    operationIds: z
      .array(z.string())
      .describe(
        'API operationIds to include (e.g., ["post-api-v1-chat_postMessage"])',
      ),
    outputDir: z.string().describe("Directory to output the generated server"),
    serverName: z.string().optional().describe("Name for the generated server"),
    rcUrl: z.string().optional().describe("Rocket.Chat server URL (e.g., http://localhost:3000). Gets written to .env."),
    rcAuthToken: z.string().optional().describe("Rocket.Chat X-Auth-Token. Gets written to .env so the server is pre-authenticated."),
    rcUserId: z.string().optional().describe("Rocket.Chat X-User-Id. Gets written to .env so the server is pre-authenticated."),
    installDeps: z.boolean().optional().describe("Run npm install + npm run build after generation (default: true). Set to false to skip."),
    registerWithGemini: z.boolean().optional().describe("Auto-register the server in ~/.gemini/settings.json for Gemini CLI (default: true). Set to false to skip."),
    workflows: z.array(z.string()).optional().describe('Optional workflow names to generate as composite tools (e.g., ["send_message_to_channel"]). Use rc_list_workflows to see available workflows.'),
  },
  async ({ operationIds, outputDir, serverName, rcUrl, rcAuthToken, rcUserId, installDeps, registerWithGemini, workflows }) => {
    try {
      // ─── Resolve all needed operationIds (raw + from workflows) ──────
      const registry = new WorkflowRegistry();
      const workflowDefs = workflows ? registry.getWorkflows(workflows) : [];

      // Collect operationIds from workflow steps
      const workflowOpIds = workflowDefs.flatMap((w) =>
        w.steps.map((s) => s.operationId),
      );

      // Combine raw operationIds + workflow operationIds (deduped)
      const allOpIds = [...new Set([...operationIds, ...workflowOpIds])];

      // Lazy domain loading: only load the domains containing the requested endpoints
      const extractor = new SchemaExtractor();
      const neededDomains = await extractor.inferDomainsFromIds(allOpIds);
      await extractor.loadDomains(neededDomains);

      let endpoints = extractor.extractEndpointsForIds(allOpIds);

      // Auto-add login if auth is required
      const needsAuth = endpoints.some((ep) => ep.requiresAuth);
      const hasLogin = endpoints.some(
        (ep) =>
          ep.operationId === "post-api-v1-login" || ep.path.includes("login"),
      );

      if (needsAuth && !hasLogin) {
        // find login endpoint manually
        const allEndpoints = extractor.getAllEndpoints();
        const loginEndpoint = allEndpoints.filter(
          (ep: any) => ep.path === "/api/v1/login",
        );
        if (loginEndpoint && loginEndpoint.length > 0) {
          endpoints.push(loginEndpoint[0]!);
        }
      }

      const generator = new ToolGenerator();

      // Generate raw 1:1 tools for endpoints not covered by workflows
      const workflowCoveredOpIds = new Set(workflowOpIds);
      const rawEndpoints = endpoints.filter(
        (ep) => !workflowCoveredOpIds.has(ep.operationId),
      );
      const rawTools = generator.generateTools(rawEndpoints);

      // Generate composite workflow tools
      const workflowTools = workflowDefs.map((def) =>
        generator.generateWorkflowTool(def, endpoints),
      );

      const tools = [...workflowTools, ...rawTools];

      const name = serverName ?? "rc-mcp-server";
      const absOutputDir = resolve(outputDir);

      // Auto-fill credentials from env (set during `gemini extensions link`) if not passed explicitly
      const resolvedRcUrl = rcUrl ?? process.env.RC_URL ?? "http://localhost:3000";
      const resolvedAuthToken = rcAuthToken ?? process.env.RC_AUTH_TOKEN ?? undefined;
      const resolvedUserId = rcUserId ?? process.env.RC_USER_ID ?? undefined;

      const config = {
        name,
        description: `Minimal MCP server for Rocket.Chat generated by rc-mcp.`,
        capabilities: [],
        outputDir: absOutputDir,
        rcUrl: resolvedRcUrl,
        rcAuthToken: resolvedAuthToken,
        rcUserId: resolvedUserId,
      };

      const scaffolder = new ServerScaffolder();
      const files = scaffolder.scaffold(tools, config);
      scaffolder.writeFiles(files, absOutputDir);

      // ─── Write .env with actual credentials ───────────────────────────
      // The scaffolder writes .env.example; write a real .env when credentials are provided.
      const { writeFileSync, mkdirSync } = await import("fs");
      const envLines = [
        `# Rocket.Chat Server Configuration`,
        `RC_URL=${resolvedRcUrl}`,
        ``,
        `# Authentication credentials (baked in during generation)`,
        `RC_AUTH_TOKEN=${resolvedAuthToken ?? ""}`,
        `RC_USER_ID=${resolvedUserId ?? ""}`,
      ];
      writeFileSync(resolve(absOutputDir, ".env"), envLines.join("\n"), "utf-8");

      const statusLines: string[] = [
        `✓ Server files written → ${absOutputDir}`,
        `✓ .env created with credentials`,
      ];

      // ─── Install deps & build ─────────────────────────────────────────
      const shouldInstall = installDeps !== false;
      if (shouldInstall) {
        try {
          const { execSync } = await import("child_process");
          execSync("npm install", { cwd: absOutputDir, stdio: "pipe" });
          execSync("npm run build", { cwd: absOutputDir, stdio: "pipe" });
          statusLines.push(`✓ npm install + build complete`);
        } catch (buildErr) {
          const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
          statusLines.push(`⚠ Build failed: ${msg.slice(0, 200)}`);
        }
      }

      // ─── Register with Gemini CLI ─────────────────────────────────────
      const shouldRegister = registerWithGemini !== false;
      if (shouldRegister) {
        try {
          const { readFileSync, writeFileSync: wf, mkdirSync: md } = await import("fs");
          const { homedir } = await import("os");
          const { join: pjoin } = await import("path");

          const geminiDir = pjoin(homedir(), ".gemini");
          const settingsPath = pjoin(geminiDir, "settings.json");

          // Read existing settings or start fresh
          let settings: Record<string, unknown> = {};
          try {
            settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
          } catch {
            // File doesn't exist or is malformed — start fresh
          }

          // Ensure mcpServers object exists
          if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
            settings.mcpServers = {};
          }

          const serverDistPath = resolve(absOutputDir, "dist", "server.js");
          const mcpEntry: Record<string, unknown> = {
            command: "node",
            args: [serverDistPath],
            env: {
              RC_URL: resolvedRcUrl,
              ...(resolvedAuthToken ? { RC_AUTH_TOKEN: resolvedAuthToken } : {}),
              ...(resolvedUserId ? { RC_USER_ID: resolvedUserId } : {}),
            },
          };

          (settings.mcpServers as Record<string, unknown>)[name] = mcpEntry;

          // Ensure ~/.gemini exists
          md(geminiDir, { recursive: true });
          wf(settingsPath, JSON.stringify(settings, null, 2), "utf-8");

          statusLines.push(`✓ Registered "${name}" in ~/.gemini/settings.json`);
          statusLines.push(`  → Restart Gemini CLI and tell it to: send a hello message to channel #general`);
        } catch (regErr) {
          const msg = regErr instanceof Error ? regErr.message : String(regErr);
          statusLines.push(`⚠ Gemini CLI registration failed: ${msg.slice(0, 200)}`);
        }
      }

      // ─── Auto-validate + minimality analysis (saves 2 round trips) ───
      let validationSummary = "";
      let minimalitySummary = "";
      try {
        // Quick structural validation
        const requiredFiles = ["package.json", "tsconfig.json", "src/server.ts", "src/rc-client.ts"];
        const missing = requiredFiles.filter(f => !existsSync(resolve(absOutputDir, f)));
        if (missing.length === 0) {
          validationSummary = `✓ Validation: all ${requiredFiles.length} required files present`;
        } else {
          validationSummary = `⚠ Validation: missing ${missing.join(", ")}`;
        }

        // Deep type check if deps were installed
        if (shouldInstall) {
          try {
            const { execSync: execS } = await import("child_process");
            execS("npx tsc --noEmit", { cwd: absOutputDir, stdio: "pipe" });
            validationSummary += `, TypeScript: 0 errors`;
          } catch {
            validationSummary += `, TypeScript: compilation errors`;
          }
        }

        // Minimality analysis
        const analyzer = new MinimalityAnalyzer();
        const report = analyzer.analyze(OPENAPI_SPEC_DIR, endpoints, []);
        minimalitySummary = `✓ Minimality: ${report.endpoints.totalInSpecs} → ${report.endpoints.selectedEndpoints} endpoints (${report.tokens.tokenReductionPercentage.toFixed(1)}% token reduction, ~${report.tokens.tokensSaved.toLocaleString()} tokens saved)`;
      } catch {
        // Non-fatal — report generation still succeeded
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `Server generated: ${absOutputDir} (${endpoints.length} endpoints)`,
              ...statusLines,
              validationSummary,
              minimalitySummary,
              shouldRegister
                ? `Restart gemini to use the new "${name}" tools.`
                : `Add "${name}" to ~/.gemini/settings.json manually.`,
            ].filter(Boolean).join("\n"),
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

// Tool 4: List Available Workflows
server.tool(
  "rc_list_workflows",
  "List predefined workflow compositions that generate higher-level MCP tools (not raw API wrappers). Each workflow composes 2-5 RC API endpoints into a single tool.",
  {},
  async () => {
    try {
      const registry = new WorkflowRegistry();
      const workflows = registry.listWorkflows();

      let result = `═══ Available Workflow Compositions (${workflows.length}) ═══\n\n`;
      result += `These workflows generate COMPOSITE tools that chain multiple\nRC API calls into a single higher-level operation.\n\n`;

      for (const w of workflows) {
        const steps = w.steps.map((s) => s.operationId).join(" → ");
        result += `── ${w.name} ──\n`;
        result += `  ${w.description}\n`;
        result += `  Steps: ${steps}\n`;
        result += `  User params: ${w.userParams.map((p) => `${p.name}${p.required ? "*" : ""}`).join(", ")}\n\n`;
      }

      result += `Use these names in the "workflows" parameter of rc_generate_server.\n`;
      result += `Example: workflows: ["send_message_to_channel", "create_project_channel"]`;

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing workflows: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 5: Analyze Minimality
server.tool(
  "rc_analyze_minimality",
  "Analyze and prove the context reduction for a set of Rocket.Chat API operationIds vs the full API surface.",
  {
    operationIds: z.array(z.string()).describe("API operationIds to analyze"),
  },
  async ({ operationIds }) => {
    try {
      const extractor = new SchemaExtractor();
      // Lazy domain loading — only load domains containing requested endpoints
      const neededDomains = await extractor.inferDomainsFromIds(operationIds);
      await extractor.loadDomains(neededDomains);
      const endpoints = extractor.extractEndpointsForIds(operationIds);

      const analyzer = new MinimalityAnalyzer();
      const report = analyzer.analyze(OPENAPI_SPEC_DIR, endpoints, []);

      // Return compact summary instead of full ASCII table to save tokens
      const compact = [
        `Endpoints: ${report.endpoints.totalInSpecs} → ${report.endpoints.selectedEndpoints} (${report.endpoints.pruningPercentage.toFixed(1)}% pruned)`,
        `Schema: ${report.reduction.schemaReduction}`,
        `Tokens: ~${report.tokens.fullServerTokens.toLocaleString()} → ~${report.tokens.minimalServerTokens.toLocaleString()} (${report.tokens.tokenReductionPercentage.toFixed(1)}% saved)`,
        `Verdict: ${report.reduction.overallVerdict}`,
      ].join("\n");

      return {
        content: [{ type: "text", text: compact }],
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
