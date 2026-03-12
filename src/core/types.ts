/**
 * Core type definitions for the MCP Server Generator.
 * These types define the data structures flowing through the generator pipeline:
 *   CapabilityDefinition → EndpointSchema → Generated MCP Tool
 */

// ─── Capability Registry Types ──────────────────────────────────────────

/** A single capability definition from the capabilities.json registry */
export interface CapabilityDefinition {
  /** Human-readable description of what this capability does */
  description: string;
  /** List of Rocket.Chat API endpoint paths required for this capability */
  endpoints: string[];
  /** Whether this capability requires authentication */
  auth: boolean;
}

/** The full capability registry: capability name → definition */
export type CapabilityRegistry = Record<string, CapabilityDefinition>;

// ─── OpenAPI / Schema Extractor Types ───────────────────────────────────

import { OpenAPIV3 } from "openapi-types";

/** HTTP methods supported by Rocket.Chat REST API */
export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

/** Rocket.Chat API Domains */
export const VALID_DOMAINS = [
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

export type Domain = (typeof VALID_DOMAINS)[number];

/** A single parameter (query, path, or header) from the OpenAPI spec */
export interface ParameterSchema {
  name: string;
  in: "query" | "path" | "header";
  required: boolean;
  description: string;
  schema: JsonSchemaProperty;
}

/** JSON Schema property definition (simplified for code generation) */
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  format?: string;
  /** Marks if this was a $ref that has been resolved */
  $ref?: string;
}

/** Request body schema extracted from OpenAPI */
export interface RequestBodySchema {
  required: boolean;
  contentType: string;
  schema: JsonSchemaProperty;
}

/** Response schema extracted from OpenAPI */
export interface ResponseSchema {
  description: string;
  schema?: JsonSchemaProperty;
}

/** The fully extracted metadata for a single API endpoint */
export interface EndpointSchema {
  /** OpenAPI operationId, e.g., "postApiV1ChatPostMessage" */
  operationId: string;
  /** API path, e.g., "/api/v1/chat.postMessage" */
  path: string;
  /** HTTP method */
  method: HttpMethod;
  /** Human-readable summary from OpenAPI */
  summary: string;
  /** Detailed description from OpenAPI */
  description: string;
  /** Query/path/header parameters */
  parameters: ParameterSchema[];
  /** Request body definition (for POST/PUT) */
  requestBody?: RequestBodySchema;
  /** Response definitions keyed by status code */
  responses: Record<string, ResponseSchema>;
  /** Whether this endpoint requires authentication headers */
  requiresAuth: boolean;
  /** OpenAPI tags for this endpoint */
  tags: string[];
  /** The source OpenAPI YAML file this came from */
  sourceFile: string;
  /** The domain this endpoint belongs to */
  domain: Domain;
}

// ─── Tool Generator Types ───────────────────────────────────────────────

/** A generated MCP tool definition ready for code output */
export interface GeneratedTool {
  /** Tool name used in MCP registration, e.g., "chat_postMessage" */
  toolName: string;
  /** Human-readable description for the LLM */
  description: string;
  /** The Zod schema source code for the tool's input */
  zodSchemaCode: string;
  /** The handler function source code */
  handlerCode: string;
  /** The original endpoint schema this tool was generated from */
  endpoint: EndpointSchema;
}

// ─── Server Scaffolder Types ────────────────────────────────────────────

/** Configuration for the generated MCP server project */
export interface ServerConfig {
  /** Name of the generated server, e.g., "rc-mcp-send-message" */
  name: string;
  /** Description for package.json */
  description: string;
  /** Rocket.Chat server URL (for .env template) */
  rcUrl?: string;
  /** List of capabilities this server supports */
  capabilities: string[];
  /** Output directory path */
  outputDir: string;
}

/** A file to be written by the scaffolder */
export interface GeneratedFile {
  /** Relative path within the output directory */
  relativePath: string;
  /** File content */
  content: string;
}

// ─── CLI Types ──────────────────────────────────────────────────────────

/** Options passed to the `generate` command */
export interface GenerateOptions {
  /** Output directory */
  output?: string;
  /** Rocket.Chat server URL */
  rcUrl?: string;
  /** Custom name for the generated server */
  name?: string;
  /** Raw endpoint paths (bypasses capability resolution) */
  endpoints?: string[];
}
