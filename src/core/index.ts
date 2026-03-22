/**
 * Core module barrel export.
 * Re-exports all core components and types for the generator pipeline.
 */

export { SchemaExtractor } from "./schema-extractor.js";

export { ToolGenerator } from "./tool-generator.js";

export { ServerScaffolder } from "./server-scaffolder.js";

export { GeminiCLIIntegration } from "./gemini-integration.js";
export type {
  GeminiIntegrationOptions,
  GeminiSettingsSnippet,
} from "./gemini-integration.js";

export { MinimalityAnalyzer } from "./minimality-analyzer.js";
export type { MinimalityReport } from "./minimality-analyzer.js";

export { SuggestEngine } from "./suggest-engine.js";
export type { SuggestionResult } from "./suggest-engine.js";

export type {
  CapabilityDefinition,
  CapabilityRegistry,
  EndpointSchema,
  GeneratedTool,
  ServerConfig,
  GeneratedFile,
  GenerateOptions,
  HttpMethod,
  ParameterSchema,
  RequestBodySchema,
  ResponseSchema,
  JsonSchemaProperty,
  Domain,
  ParameterMapping,
  WorkflowStep,
  UserParam,
  WorkflowDefinition,
} from "./types.js";
export { VALID_DOMAINS } from "./types.js";

export { WorkflowRegistry } from "./workflow-registry.js";
export { WorkflowComposer } from "./workflow-composer.js";
