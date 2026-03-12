#!/usr/bin/env node
/**
 * rc-mcp CLI — Minimal MCP Server Generator for Rocket.Chat
 *
 * Usage:
 *   rc-mcp generate <capabilities...> [options]
 *   rc-mcp list
 *   rc-mcp generate --endpoints <path1,path2> [options]
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve, dirname } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  SchemaExtractor,
  ToolGenerator,
  ServerScaffolder,
  GeminiCLIIntegration,
} from "../core/index.js";
import { VALID_DOMAINS, type Domain } from "../core/types.js";
import type { ServerConfig } from "../core/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENAPI_SPEC_DIR = resolve(__dirname, "../providers/rocketchat/openapi");

const program = new Command();

program
  .name("rc-mcp")
  .version("0.1.0")
  .description(
    "Minimal MCP Server Generator for Rocket.Chat — generate production-ready MCP servers with only the APIs you need.",
  );

// ─── Generate Command ─────────────────────────────────────────────────

program
  .command("generate")
  .description("Generate a minimal MCP server for the specified endpoints")
  .requiredOption(
    "--endpoints <paths>",
    "Comma-separated list of OpenAPI operationIds or paths to include",
  )
  .option("-o, --output <dir>", "Output directory")
  .option("-n, --name <name>", "Custom name for the generated server")
  .option("--rc-url <url>", "Rocket.Chat server URL", "http://localhost:3000")
  .option(
    "--gemini",
    "Auto-generate gemini-cli integration files (extension + GEMINI.md)",
  )
  .action(async (options) => {
    const spinner = ora();

    try {
      if (!options.endpoints) {
        console.error(
          chalk.red(
            'Error: You must specify --endpoints. Tip: Run `rc-mcp suggest "intent"` to discover endpoints.\n',
          ),
        );
        process.exit(1);
      }

      spinner.start("Parsing endpoints...");
      const endpointPaths = (options.endpoints as string)
        .split(",")
        .map((e: string) => e.trim());

      spinner.succeed(
        `Using ${chalk.bold(endpointPaths.length)} specified endpoints`,
      );

      // Step 2: Extract schemas from OpenAPI specs
      spinner.start("Extracting API schemas...");

      spinner.start("Extracting API schemas...");
      const extractor = new SchemaExtractor();
      // In the new architecture, we fetch all domains remotely instead of local directory
      await extractor.loadDomains([...VALID_DOMAINS]);
      // Convert endpoint paths to operationIds or fallback to fuzzy matching inside extractEndpoints
      let endpoints;
      try {
        endpoints = extractor.extractEndpointsForIds(endpointPaths);
      } catch {
        // To support legacy endpoints argument (which passes paths), we need to extract by path
        // Since extractEndpoints is gone, we manually filter
        const allEndpoints = Array.from(
          (extractor as any).endpointIndex.values() as any[],
        );
        endpoints = allEndpoints.filter(
          (ep: any) =>
            endpointPaths.includes(ep.path) ||
            endpointPaths.some((p) => ep.path.endsWith(p)),
        );
      }
      spinner.succeed(
        `Extracted schemas for ${chalk.bold(endpoints.length)} endpoints (from ${chalk.dim(extractor.getEndpointCount().toString())} total)`,
      );

      // Step 3: Generate MCP tools
      spinner.start("Generating MCP tools...");
      const generator = new ToolGenerator();
      const tools = generator.generateTools(endpoints);
      spinner.succeed(`Generated ${chalk.bold(tools.length)} MCP tools`);

      // Step 4: Scaffold the server project
      const serverName = options.name ?? `rc-mcp-custom-server`;

      const outputDir = resolve(options.output ?? `./${serverName}`);

      spinner.start(`Scaffolding server → ${chalk.dim(outputDir)}`);

      const config: ServerConfig = {
        name: serverName,
        description: `Minimal MCP server for Rocket.Chat: custom endpoints`,
        rcUrl: options.rcUrl,
        capabilities: ["custom-endpoints"],
        outputDir,
      };

      const scaffolder = new ServerScaffolder();
      const files = scaffolder.scaffold(tools, config);
      scaffolder.writeFiles(files, outputDir);

      spinner.succeed(`Server scaffolded to ${chalk.bold(outputDir)}`);

      // Step 5 (optional): Generate gemini-cli integration
      let geminiFiles: string[] = [];
      if (options.gemini) {
        spinner.start("Generating gemini-cli integration...");

        const gemini = new GeminiCLIIntegration();
        const integrationOpts = {
          serverDir: outputDir,
          serverConfig: config,
          tools,
          mode: "extension" as const,
        };

        // Create extension files inside the generated server
        geminiFiles = gemini.createExtension(integrationOpts);

        // Also write settings.json snippet
        const snippet = gemini.generateSettingsSnippet(integrationOpts);
        const settingsPath = resolve(outputDir, "gemini-settings.json");
        gemini.writeSettingsSnippet(snippet, settingsPath);
        geminiFiles.push("gemini-settings.json");

        spinner.succeed(
          `Generated ${chalk.bold(geminiFiles.length.toString())} gemini-cli integration files`,
        );
      }

      // Summary
      console.log("\n" + chalk.green("✓ MCP server generated successfully!\n"));
      console.log(chalk.bold("Generated files:"));
      for (const file of files) {
        console.log(`  ${chalk.dim("├──")} ${file.relativePath}`);
      }
      if (geminiFiles.length > 0) {
        console.log(chalk.bold("\ngemini-cli integration:"));
        for (const f of geminiFiles) {
          console.log(`  ${chalk.dim("├──")} ${chalk.magenta(f)}`);
        }
      }

      console.log(`\n${chalk.bold("Next steps:")}`);
      console.log(`  ${chalk.cyan("1.")} cd ${config.outputDir}`);
      console.log(`  ${chalk.cyan("2.")} npm install`);
      console.log(
        `  ${chalk.cyan("3.")} cp .env.example .env  ${chalk.dim("# configure credentials")}`,
      );
      console.log(`  ${chalk.cyan("4.")} npm run build`);
      console.log(`  ${chalk.cyan("5.")} npm start`);

      if (options.gemini) {
        console.log(`\n${chalk.bold("gemini-cli setup:")}`);
        console.log(
          `  ${chalk.cyan("•")} Copy ${chalk.magenta("gemini-settings.json")} content into your ${chalk.dim("~/.gemini/settings.json")}`,
        );
        console.log(
          `  ${chalk.cyan("•")} Or copy ${chalk.magenta(".gemini-extension/")} to ${chalk.dim("~/.gemini/extensions/" + serverName)}`,
        );
      }

      console.log(
        `\n${chalk.dim(`Context reduction: ${tools.length} tools vs ~200+ in a full MCP server`)}`,
      );
    } catch (error) {
      spinner.fail(
        chalk.red(error instanceof Error ? error.message : "Unknown error"),
      );
      process.exit(1);
    }
  });

// ─── Integrate Command ────────────────────────────────────────────────

program
  .command("integrate")
  .description(
    "Generate gemini-cli integration files for an existing MCP server",
  )
  .argument("<server-dir>", "Path to a generated MCP server directory")
  .option(
    "--mode <mode>",
    'Integration mode: "config" (settings.json snippet) or "extension" (full extension)',
    "extension",
  )
  .option("--rc-url <url>", "Rocket.Chat server URL", "http://localhost:3000")
  .option(
    "--settings-path <path>",
    "Path to write settings.json (config mode)",
    "./gemini-settings.json",
  )
  .action(async (serverDir: string, options) => {
    const spinner = ora();

    try {
      const absServerDir = resolve(serverDir);

      if (!existsSync(absServerDir)) {
        console.error(
          chalk.red(`Error: Server directory not found: ${absServerDir}`),
        );
        process.exit(1);
      }

      // Re-run the pipeline to get tool metadata
      // (we need the tool list for GEMINI.md generation)
      spinner.start("Reading server configuration...");

      // Try to read the generated README to extract capability info
      const pkgPath = resolve(absServerDir, "package.json");
      let serverName = "rc-mcp-server";
      let description = "Minimal MCP server for Rocket.Chat";

      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<
          string,
          string
        >;
        serverName = pkg.name ?? serverName;
        description = pkg.description ?? description;
      }

      spinner.succeed(`Server: ${chalk.bold(serverName)}`);

      // Scan src/tools/ to discover tool files
      const toolsDir = resolve(absServerDir, "src/tools");
      let toolNames: string[] = [];

      if (existsSync(toolsDir)) {
        const { readdirSync } = await import("fs");
        toolNames = readdirSync(toolsDir)
          .filter((f: string) => f.endsWith(".ts"))
          .map((f: string) => f.replace(".ts", ""));
      }

      // Build minimal tool metadata for documentation
      const tools = toolNames.map((name) => ({
        toolName: name,
        description: `Rocket.Chat API tool: ${name.replace(/_/g, ".")}`,
        zodSchemaCode: "z.object({})",
        handlerCode: "",
        endpoint: {
          operationId: name,
          path: `/api/v1/${name.replace(/_/g, ".")}`,
          method: "post" as const,
          summary: `${name.replace(/_/g, ".")}`,
          description: "",
          parameters: [],
          responses: {},
          requiresAuth: true,
          tags: [],
          sourceFile: "",
          domain: "miscellaneous" as Domain,
        },
      }));

      const config: ServerConfig = {
        name: serverName,
        description,
        rcUrl: options.rcUrl,
        capabilities: [],
        outputDir: absServerDir,
      };

      const gemini = new GeminiCLIIntegration();
      const integrationOpts = {
        serverDir: absServerDir,
        serverConfig: config,
        tools,
        mode: options.mode as "config" | "extension",
      };

      if (options.mode === "config") {
        spinner.start("Generating settings.json snippet...");
        const snippet = gemini.generateSettingsSnippet(integrationOpts);
        const settingsPath = resolve(options.settingsPath);
        gemini.writeSettingsSnippet(snippet, settingsPath);
        spinner.succeed(
          `Settings snippet written to ${chalk.bold(settingsPath)}`,
        );

        console.log(
          `\n${chalk.dim("Merge this into your ~/.gemini/settings.json")}`,
        );
      } else {
        spinner.start("Creating gemini-cli extension...");
        const files = gemini.createExtension(integrationOpts);
        spinner.succeed(
          `Extension created with ${chalk.bold(files.length.toString())} files`,
        );

        console.log(chalk.bold("\nCreated:"));
        for (const f of files) {
          console.log(`  ${chalk.dim("├──")} ${chalk.magenta(f)}`);
        }

        const extDir = resolve(absServerDir, ".gemini-extension");
        console.log(
          `\n${chalk.dim(`Copy ${extDir} to ~/.gemini/extensions/${serverName}`)}`,
        );
      }
    } catch (error) {
      spinner.fail(
        chalk.red(error instanceof Error ? error.message : "Unknown error"),
      );
      process.exit(1);
    }
  });

// ─── Suggest Command ──────────────────────────────────────────────────

program
  .command("suggest")
  .description(
    "Use AI to suggest capabilities that match your natural-language intent (requires GEMINI_API_KEY or falls back to keyword matching)",
  )
  .argument("<intent>", "What you want to do, in plain English")
  .option("--top <n>", "Maximum number of suggestions to show", "3")
  .option("--json", "Output raw JSON instead of formatted results")
  .option("--generate", "Auto-run rc-mcp generate with the top suggestion")
  .option("-o, --output <dir>", "Output directory (used with --generate)")
  .option(
    "--gemini",
    "Include --gemini flag when auto-generating (used with --generate)",
  )
  .option(
    "--rc-url <url>",
    "Rocket.Chat server URL (used with --generate)",
    "http://localhost:3000",
  )
  .action(async (intent: string, options) => {
    const spinner = ora();

    try {
      const { SuggestEngine } = await import("../core/suggest-engine.js");
      const engine = new SuggestEngine();
      const topN = parseInt(options.top as string, 10) || 3;

      const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

      if (!options.json) {
        spinner.start(
          hasApiKey
            ? "Analyzing intent with Gemini..."
            : "Scoring capabilities with keyword matching (set GEMINI_API_KEY for AI-powered suggestions)...",
        );
      }

      const suggestions = await engine.suggest(intent, topN);

      if (!options.json) {
        spinner.succeed("Intent analyzed");
      }

      if (options.json) {
        console.log(JSON.stringify(suggestions, null, 2));
        return;
      }

      if (suggestions.length === 0) {
        console.log(
          chalk.yellow("\nNo matching capabilities found for that intent."),
        );
        console.log(
          chalk.dim("Run `rc-mcp list` to see all available capabilities.\n"),
        );
        return;
      }

      const modeLabel = hasApiKey
        ? chalk.magenta("✦ Gemini")
        : chalk.dim("⌘ Keyword fallback");

      console.log(
        `\n${chalk.bold("Capability Suggestions")} ${chalk.dim(`for:`)} "${chalk.italic(intent)}"`,
      );
      console.log(chalk.dim(`Mode: ${modeLabel}\n`));

      const confidenceColor = (c: string) => {
        if (c === "high") return chalk.green(c);
        if (c === "medium") return chalk.yellow(c);
        return chalk.dim(c);
      };

      const confidenceBadge = (c: string) => {
        if (c === "high") return chalk.bgGreen.black(" HIGH ");
        if (c === "medium") return chalk.bgYellow.black(" MED  ");
        return chalk.bgGray.white(" LOW  ");
      };

      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i]!;
        const rank = i === 0 ? chalk.cyan(`${i + 1}.`) : chalk.dim(`${i + 1}.`);
        console.log(
          `  ${rank} ${chalk.bold(s.capability.padEnd(20))} ${confidenceBadge(s.confidence)}`,
        );
        console.log(`     ${chalk.dim(s.reason)}`);
        const epPreview =
          s.endpoints.length > 3
            ? s.endpoints.slice(0, 3).join(", ") +
              ` (+${s.endpoints.length - 3} more)`
            : s.endpoints.join(", ");
        console.log(
          `     ${chalk.dim(`${s.endpointCount} endpoint(s): ${epPreview}`)}\n`,
        );
      }

      // Always show the ready-to-run command
      const topEndpoints = suggestions[0]!.endpoints.join(",");
      const generateCmd = `rc-mcp generate --endpoints ${topEndpoints}`;
      console.log(chalk.bold("→ Suggested command:"));
      console.log(`  ${chalk.cyan(generateCmd)}\n`);

      if (!hasApiKey) {
        console.log(
          chalk.dim(
            "Tip: Set GEMINI_API_KEY for AI-powered intent matching.\n" +
              "     export GEMINI_API_KEY=your-key-here\n",
          ),
        );
      }

      // --generate: spawn the generate pipeline with the top suggestion
      if (options.generate) {
        console.log(chalk.bold(`Auto-running: ${generateCmd} ...\n`));
        const { execSync } = await import("child_process");
        const extraArgs: string[] = [];
        if (options.output) extraArgs.push(`-o ${options.output}`);
        if (options.gemini) extraArgs.push("--gemini");
        if (options.rcUrl) extraArgs.push(`--rc-url ${options.rcUrl}`);

        execSync(
          `rc-mcp generate --endpoints ${topEndpoints} ${extraArgs.join(" ")}`.trim(),
          { stdio: "inherit" },
        );
      }
    } catch (error) {
      spinner.fail(
        chalk.red(error instanceof Error ? error.message : "Unknown error"),
      );
      process.exit(1);
    }
  });

// ─── Analyze Command ──────────────────────────────────────────────────

program
  .command("analyze")
  .description(
    "Analyze minimality metrics for an endpoint group — shows schema weight, component pruning, and token footprint",
  )
  .requiredOption(
    "--endpoints <paths>",
    "Comma-separated list of OpenAPI operationIds or paths to analyze",
  )
  .option("--json", "Output raw JSON instead of formatted table")
  .action(async (options) => {
    const spinner = ora();

    try {
      if (!options.endpoints) {
        console.error(
          chalk.red("Error: You must specify --endpoints to analyze.\n"),
        );
        process.exit(1);
      }

      spinner.start("Parsing endpoints...");
      const endpointPaths = (options.endpoints as string)
        .split(",")
        .map((e: string) => e.trim());

      spinner.succeed(
        `Analyzing ${chalk.bold(endpointPaths.length.toString())} specified endpoints`,
      );

      // Step 2: Extract schemas
      spinner.start("Extracting API schemas...");

      const extractor = new SchemaExtractor();
      await extractor.loadDomains([...VALID_DOMAINS]);

      // Extract by paths / operationIds
      const allEndpoints = Array.from(
        (extractor as any).endpointIndex.values() as any[],
      );
      const endpoints = allEndpoints.filter(
        (ep: any) =>
          endpointPaths.includes(ep.path) ||
          endpointPaths.includes(ep.operationId),
      );

      spinner.succeed(
        `Extracted ${chalk.bold(endpoints.length.toString())} endpoint schemas`,
      );

      // Step 3: Run minimality analysis
      spinner.start("Running minimality analysis...");
      const { MinimalityAnalyzer } =
        await import("../core/minimality-analyzer.js");
      const analyzer = new MinimalityAnalyzer();
      const report = analyzer.analyze(OPENAPI_SPEC_DIR, endpoints, [
        "custom-analysis",
      ]);
      spinner.succeed("Analysis complete");

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log("");
        console.log(analyzer.formatReport(report));
      }
    } catch (error) {
      spinner.fail(
        chalk.red(error instanceof Error ? error.message : "Unknown error"),
      );
      process.exit(1);
    }
  });

// ─── Validate Command ─────────────────────────────────────────────────

program
  .command("validate")
  .description(
    "Validate a generated MCP server for structural correctness, type safety, and MCP compliance",
  )
  .argument("<server-dir>", "Path to a generated MCP server directory")
  .option("--deep", "Run TypeScript type-check (requires npm install first)")
  .action(async (serverDir: string, options) => {
    const absDir = resolve(serverDir);
    let issues = 0;
    let passed = 0;
    let warnings = 0;

    console.log(chalk.bold(`\nValidating: ${absDir}\n`));

    // ── Section 1: Structural checks ────────────────────────────────
    console.log(chalk.dim("─── Structure ───"));

    const requiredFiles = [
      "package.json",
      "tsconfig.json",
      "src/server.ts",
      "src/rc-client.ts",
      "src/auth.ts",
      ".env.example",
    ];

    for (const file of requiredFiles) {
      const filePath = resolve(absDir, file);
      if (existsSync(filePath)) {
        console.log(`  ${chalk.green("✓")} ${file}`);
        passed++;
      } else {
        console.log(`  ${chalk.red("✗")} ${file} — ${chalk.dim("missing")}`);
        issues++;
      }
    }

    // Discover tool files
    const toolsDir = resolve(absDir, "src/tools");
    let toolFiles: string[] = [];
    if (existsSync(toolsDir)) {
      const { readdirSync } = await import("fs");
      toolFiles = readdirSync(toolsDir).filter((f: string) =>
        f.endsWith(".ts"),
      );
      if (toolFiles.length > 0) {
        console.log(
          `  ${chalk.green("✓")} src/tools/ — ${toolFiles.length} tool(s) found`,
        );
        passed++;
      } else {
        console.log(
          `  ${chalk.red("✗")} src/tools/ — ${chalk.dim("no tool files")}`,
        );
        issues++;
      }
    } else {
      console.log(
        `  ${chalk.red("✗")} src/tools/ — ${chalk.dim("directory missing")}`,
      );
      issues++;
    }

    // Check package.json for MCP SDK dependency
    const pkgPath = resolve(absDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<
        string,
        Record<string, string>
      >;
      if (pkg.dependencies?.["@modelcontextprotocol/sdk"]) {
        console.log(
          `  ${chalk.green("✓")} MCP SDK dependency present (${pkg.dependencies["@modelcontextprotocol/sdk"]})`,
        );
        passed++;
      } else {
        console.log(
          `  ${chalk.red("✗")} @modelcontextprotocol/sdk — ${chalk.dim("not in dependencies")}`,
        );
        issues++;
      }
      // Check for Zod dependency
      if (pkg.dependencies?.["zod"]) {
        console.log(
          `  ${chalk.green("✓")} Zod runtime validation dependency (${pkg.dependencies["zod"]})`,
        );
        passed++;
      } else {
        console.log(
          `  ${chalk.red("✗")} zod — ${chalk.dim("not in dependencies")}`,
        );
        issues++;
      }
    }

    // Check .env.example
    const envPath = resolve(absDir, ".env.example");
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, "utf-8");
      const hasUrl = env.includes("RC_URL");
      const hasUser = env.includes("RC_USER");
      const hasPass = env.includes("RC_PASSWORD");
      if (hasUrl && hasUser && hasPass) {
        console.log(`  ${chalk.green("✓")} .env.example has all required vars`);
        passed++;
      } else {
        const missing = [
          !hasUrl && "RC_URL",
          !hasUser && "RC_USER",
          !hasPass && "RC_PASSWORD",
        ].filter(Boolean);
        console.log(
          `  ${chalk.yellow("⚠")} .env.example missing: ${missing.join(", ")}`,
        );
        warnings++;
      }
    }

    // ── Section 2: Zod & MCP compliance per tool ────────────────────
    console.log(chalk.dim("\n─── MCP Compliance ───"));

    for (const toolFile of toolFiles) {
      const toolPath = resolve(toolsDir, toolFile);
      const toolSrc = readFileSync(toolPath, "utf-8");
      const toolName = toolFile.replace(".ts", "");

      // Check Zod import
      const hasZod =
        toolSrc.includes('from "zod"') || toolSrc.includes("from 'zod'");
      if (hasZod) {
        console.log(
          `  ${chalk.green("✓")} ${toolFile} — Zod schema validation`,
        );
        passed++;
      } else {
        console.log(
          `  ${chalk.red("✗")} ${toolFile} — ${chalk.dim("missing Zod import (no runtime validation)")}`,
        );
        issues++;
      }

      // Check exported schema
      const hasSchema = toolSrc.includes(`${toolName}Schema`);
      if (hasSchema) {
        console.log(
          `  ${chalk.green("✓")} ${toolFile} — exports ${toolName}Schema`,
        );
        passed++;
      } else {
        console.log(
          `  ${chalk.yellow("⚠")} ${toolFile} — ${chalk.dim("no exported schema found")}`,
        );
        warnings++;
      }
    }

    // Check server.ts MCP registration
    const serverPath = resolve(absDir, "src/server.ts");
    if (existsSync(serverPath)) {
      const serverSrc = readFileSync(serverPath, "utf-8");

      // McpServer import
      if (serverSrc.includes("McpServer")) {
        console.log(`  ${chalk.green("✓")} server.ts — imports McpServer`);
        passed++;
      } else {
        console.log(
          `  ${chalk.red("✗")} server.ts — ${chalk.dim("McpServer not imported")}`,
        );
        issues++;
      }

      // Tool registrations
      const registerCalls = (serverSrc.match(/register_/g) ?? []).length;
      if (registerCalls >= toolFiles.length && toolFiles.length > 0) {
        console.log(
          `  ${chalk.green("✓")} server.ts — ${registerCalls} tool registration(s)`,
        );
        passed++;
      } else if (toolFiles.length > 0) {
        console.log(
          `  ${chalk.yellow("⚠")} server.ts — only ${registerCalls}/${toolFiles.length} tools registered`,
        );
        warnings++;
      }

      // StdioServerTransport
      if (serverSrc.includes("StdioServerTransport")) {
        console.log(
          `  ${chalk.green("✓")} server.ts — uses StdioServerTransport`,
        );
        passed++;
      } else {
        console.log(
          `  ${chalk.yellow("⚠")} server.ts — ${chalk.dim("no StdioServerTransport (non-standard transport)")}`,
        );
        warnings++;
      }
    }

    // ── Section 3: Test coverage per tool ───────────────────────────
    console.log(chalk.dim("\n─── Test Coverage ───"));

    const testsDir = resolve(absDir, "tests");
    let testsMissing = 0;
    let testsFound = 0;

    for (const toolFile of toolFiles) {
      const toolName = toolFile.replace(".ts", "");
      const testFile = `${toolName}.test.ts`;
      const testPath = resolve(testsDir, testFile);

      if (existsSync(testPath)) {
        const testSrc = readFileSync(testPath, "utf-8");
        const testCount = (testSrc.match(/\bit\(/g) ?? []).length;
        console.log(
          `  ${chalk.green("✓")} tests/${testFile} — ${testCount} test(s)`,
        );
        passed++;
        testsFound++;
      } else {
        console.log(
          `  ${chalk.red("✗")} tests/${testFile} — ${chalk.dim("missing (no test coverage)")}`,
        );
        issues++;
        testsMissing++;
      }
    }

    if (toolFiles.length > 0) {
      const coverage = ((testsFound / toolFiles.length) * 100).toFixed(0);
      console.log(
        chalk.dim(
          `  Tool test coverage: ${coverage}% (${testsFound}/${toolFiles.length})`,
        ),
      );
    }

    // ── Section 4 (optional): TypeScript type-check ─────────────────
    if (options.deep) {
      console.log(chalk.dim("\n─── Type Safety ───"));
      try {
        const { execSync } = await import("child_process");
        execSync("npx tsc --noEmit", { cwd: absDir, stdio: "pipe" });
        console.log(`  ${chalk.green("✓")} TypeScript compilation — 0 errors`);
        passed++;
      } catch (err) {
        const output = (err as { stdout?: Buffer }).stdout?.toString() ?? "";
        const errorLines = output
          .split("\n")
          .filter((l: string) => l.includes("error TS")).length;
        console.log(
          `  ${chalk.red("✗")} TypeScript compilation — ${errorLines || "?"} error(s)`,
        );
        issues++;
      }
    }

    // ── Section 5: Auth support ─────────────────────────────────────
    console.log(`\n${chalk.bold("Auth Support:")}`);
    console.log(`  ${chalk.green("✓")} Username/password login`);
    console.log(
      `  ${chalk.dim("○")} Personal access tokens — ${chalk.dim("planned")}`,
    );
    console.log(`  ${chalk.dim("○")} OAuth 2.0 — ${chalk.dim("planned")}`);
    console.log(`  ${chalk.dim("○")} 2FA support — ${chalk.dim("planned")}`);

    // ── Summary ─────────────────────────────────────────────────────
    const parts = [chalk.green(`${passed} passed`)];
    if (warnings > 0) parts.push(chalk.yellow(`${warnings} warnings`));
    if (issues > 0) parts.push(chalk.red(`${issues} issues`));
    else parts.push(chalk.green("0 issues"));

    console.log(`\n${chalk.bold("Result:")} ${parts.join(", ")}`);

    if (!options.deep) {
      console.log(
        chalk.dim("\nTip: Run with --deep for TypeScript type-checking"),
      );
    }

    if (issues > 0) {
      process.exit(1);
    }
  });

// ─── Parse & Run ──────────────────────────────────────────────────────

program.parse();
