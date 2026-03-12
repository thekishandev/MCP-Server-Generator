/**
 * Schema Extractor
 *
 * Parses Rocket.Chat OpenAPI YAML specification files and extracts structured
 * endpoint metadata (EndpointSchema) for the endpoints requested by the
 * Capability Resolver.
 *
 * Key responsibilities:
 * - Parse OpenAPI 3.x YAML files
 * - Resolve $ref references within specs
 * - Extract parameters, request bodies, and response schemas
 * - Build a searchable index of all endpoints
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { resolve, join } from "path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV3 } from "openapi-types";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type {
  EndpointSchema,
  HttpMethod,
  ParameterSchema,
  RequestBodySchema,
  ResponseSchema,
  JsonSchemaProperty,
  Domain,
} from "./types.js";
import { VALID_DOMAINS } from "./types.js";

export class SchemaExtractor {
  /** Index of all discovered endpoints keyed by API path */
  private endpointIndex: Map<string, EndpointSchema> = new Map();
  /** Raw parsed OpenAPI documents for $ref resolution */
  private documents: Map<string, Record<string, unknown>> = new Map();

  /** Base URL for Rocket.Chat OpenAPI specs */
  private static readonly SPEC_BASE_URL =
    "https://raw.githubusercontent.com/RocketChat/Rocket.Chat-Open-API/main";
  /** TTL for disk cache (24 hours) */
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  /**
   * Load an OpenAPI spec from GitHub (with memory and disk fallback).
   */
  async loadDomain(domain: Domain): Promise<void> {
    if (this.documents.has(domain)) return;

    const doc = await this.fetchWithCache(domain);
    this.documents.set(domain, doc as any);

    const paths = doc.paths ?? {};

    for (const [apiPath, methods] of Object.entries(paths)) {
      if (!methods) continue;
      for (const [method, operation] of Object.entries(methods)) {
        if (!isHttpMethod(method)) continue;

        const op = operation as OpenAPIV3.OperationObject;
        const endpoint = this.extractEndpoint(
          apiPath,
          method,
          op,
          `${domain}.yaml`,
          doc,
          domain,
        );
        this.endpointIndex.set(apiPath, endpoint);
      }
    }
  }

  /**
   * Load multiple domains concurrently.
   */
  async loadDomains(domains: Domain[]): Promise<void> {
    await Promise.all(domains.map((d) => this.loadDomain(d)));
  }

  private async fetchWithCache(domain: Domain): Promise<OpenAPIV3.Document> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const cacheDir = resolve(__dirname, "..", "..", ".cache");
    const cacheFile = join(cacheDir, `${domain}.json`);

    // Check disk cache
    if (existsSync(cacheFile)) {
      const age = Date.now() - statSync(cacheFile).mtimeMs;
      if (age < SchemaExtractor.CACHE_TTL_MS) {
        try {
          return JSON.parse(
            readFileSync(cacheFile, "utf-8"),
          ) as OpenAPIV3.Document;
        } catch {
          // Cache invalid, fall through
        }
      }
    }

    // Fetch from network
    const url = `${SchemaExtractor.SPEC_BASE_URL}/${domain}.yaml`;
    let api: OpenAPIV3.Document;
    try {
      api = (await SwaggerParser.dereference(url)) as OpenAPIV3.Document;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch OpenAPI spec for "${domain}": ${msg}`);
    }

    // Write to disk cache
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(api), "utf-8");
    } catch {
      // Non-fatal
    }

    return api;
  }

  /**
   * Get tag-based summaries for progressive disclosure.
   * Groups endpoints by domain and then by OpenAPI tag.
   */
  getEndpointsByTag(
    domains: Domain[],
  ): Map<Domain, Map<string, EndpointSchema[]>> {
    const result = new Map<Domain, Map<string, EndpointSchema[]>>();

    for (const [_, endpoint] of this.endpointIndex) {
      if (!domains.includes(endpoint.domain)) continue;

      let domainMap = result.get(endpoint.domain);
      if (!domainMap) {
        domainMap = new Map<string, EndpointSchema[]>();
        result.set(endpoint.domain, domainMap);
      }

      for (const tag of endpoint.tags) {
        const tagList = domainMap.get(tag) ?? [];
        tagList.push(endpoint);
        domainMap.set(tag, tagList);
      }
    }

    return result;
  }

  /**
   * Extract full endpoints for a specific list of operationIds.
   */
  extractEndpointsForIds(operationIds: string[]): EndpointSchema[] {
    const results: EndpointSchema[] = [];
    const allEndpoints = Array.from(this.endpointIndex.values());

    for (const id of operationIds) {
      const endpoint = allEndpoints.find((ep) => ep.operationId === id);
      if (!endpoint) {
        // Try fuzzy matching (matching path instead of operationId directly)
        let fuzzyMatch = allEndpoints.find(
          (ep) => ep.operationId.endsWith(id) || id.endsWith(ep.operationId),
        );

        if (!fuzzyMatch) {
          fuzzyMatch = allEndpoints.find(
            (ep) =>
              ep.path === id ||
              ep.path.endsWith(id.replace(/^\/?api\/v1\/?/, "")),
          );
        }

        if (fuzzyMatch) {
          results.push(fuzzyMatch);
          continue;
        }

        throw new Error(`Endpoint not found for operationId: "${id}"`);
      }
      results.push(endpoint);
    }

    return results;
  }

  /**
   * Get the total number of endpoints indexed across all loaded spec files.
   */
  getEndpointCount(): number {
    return this.endpointIndex.size;
  }

  /**
   * List all indexed endpoint paths.
   */
  listEndpoints(): string[] {
    return Array.from(this.endpointIndex.keys());
  }

  // ─── Private: Extraction Logic ──────────────────────────────────────

  private extractEndpoint(
    path: string,
    method: HttpMethod,
    operation: OpenAPIV3.OperationObject,
    sourceFile: string,
    doc: OpenAPIV3.Document,
    domain: Domain,
  ): EndpointSchema {
    const operationId =
      operation.operationId ?? this.generateOperationId(path, method);

    const summary = operation.summary ?? "";
    const description = operation.description ?? summary;
    const tags = operation.tags ?? [];

    // Extract parameters (already dereferenced by SwaggerParser)
    const rawParams = (operation.parameters ??
      []) as OpenAPIV3.ParameterObject[];
    const parameters = rawParams.map((p) => this.extractParameter(p));

    // Extract request body
    let requestBody: RequestBodySchema | undefined;
    if (operation.requestBody) {
      requestBody = this.extractRequestBody(
        operation.requestBody as OpenAPIV3.RequestBodyObject,
      );
    }

    // Extract responses
    const rawResponses = operation.responses ?? {};
    const responses: Record<string, ResponseSchema> = {};
    for (const [status, resp] of Object.entries(rawResponses)) {
      responses[status] = this.extractResponse(
        resp as OpenAPIV3.ResponseObject,
      );
    }

    // Determine auth requirement (look for security or auth-related headers)
    const globalSecurity = doc.security ?? [];
    const operationSecurity = operation.security ?? globalSecurity;
    const requiresAuth =
      operationSecurity.length > 0 || this.detectAuthRequirement(parameters);

    return {
      operationId,
      path,
      method,
      summary,
      description,
      parameters,
      requestBody,
      responses,
      requiresAuth,
      tags,
      sourceFile,
      domain,
    };
  }

  private extractParameter(param: OpenAPIV3.ParameterObject): ParameterSchema {
    return {
      name: param.name ?? "unknown",
      in: (param.in as "query" | "path" | "header") ?? "query",
      required: param.required ?? false,
      description: param.description ?? "",
      schema: this.normalizeSchema(
        (param.schema as OpenAPIV3.SchemaObject) ?? { type: "string" },
      ),
    };
  }

  private extractRequestBody(
    body: OpenAPIV3.RequestBodyObject,
  ): RequestBodySchema {
    const content = body.content ?? {};

    // Prefer application/json
    const jsonContent = content["application/json"];
    if (jsonContent) {
      const schema = jsonContent.schema as OpenAPIV3.SchemaObject | undefined;
      return {
        required: body.required ?? false,
        contentType: "application/json",
        schema: schema ? this.normalizeSchema(schema) : { type: "object" },
      };
    }

    // Fallback to first content type
    const firstEntry = Object.entries(content)[0];
    if (firstEntry) {
      const [contentType, contentDef] = firstEntry;
      const schema = contentDef.schema as OpenAPIV3.SchemaObject | undefined;
      return {
        required: body.required ?? false,
        contentType,
        schema: schema ? this.normalizeSchema(schema) : { type: "object" },
      };
    }

    return {
      required: false,
      contentType: "application/json",
      schema: { type: "object" },
    };
  }

  private extractResponse(resp: OpenAPIV3.ResponseObject): ResponseSchema {
    const description = resp.description ?? "";
    const content = resp.content ?? {};
    const jsonContent = content["application/json"];

    let schema: JsonSchemaProperty | undefined;
    if (jsonContent?.schema) {
      schema = this.normalizeSchema(
        jsonContent.schema as OpenAPIV3.SchemaObject,
      );
    }

    return { description, schema };
  }

  // ─── Private: Helpers ───────────────────────────────────────────────

  private normalizeSchema(schema: OpenAPIV3.SchemaObject): JsonSchemaProperty {
    // Handle $ref if it wasn't fully dereferenced by swagger-parser
    if ("$ref" in schema) {
      return { type: "object", $ref: (schema as any).$ref };
    }

    return {
      type: (schema.type as string) ?? "string",
      description: schema.description,
      enum: schema.enum as string[] | undefined,
      default: schema.default,
      items: (schema as any).items
        ? this.normalizeSchema((schema as any).items as OpenAPIV3.SchemaObject)
        : undefined,
      properties: schema.properties
        ? Object.fromEntries(
            Object.entries(schema.properties).map(([k, v]) => [
              k,
              this.normalizeSchema(v as OpenAPIV3.SchemaObject),
            ]),
          )
        : undefined,
      required: schema.required,
      format: schema.format,
    };
  }

  private detectAuthRequirement(parameters: ParameterSchema[]): boolean {
    // Check for auth-related headers
    const authHeaders = parameters.filter(
      (p) =>
        p.in === "header" &&
        (p.name.toLowerCase().includes("auth") ||
          p.name.toLowerCase().includes("token") ||
          p.name === "X-Auth-Token" ||
          p.name === "X-User-Id"),
    );

    return authHeaders.length > 0;
  }

  private generateOperationId(path: string, method: HttpMethod): string {
    // Convert /api/v1/chat.postMessage → post-api-v1-chat_postMessage
    return `${method}${path.replace(/[/]/g, "-").replace(/[.]/g, "_")}`;
  }

  private fuzzyFind(path: string): EndpointSchema | undefined {
    // Try matching without /api/v1/ prefix
    const withPrefix = path.startsWith("/api/v1/") ? path : `/api/v1/${path}`;

    const match = this.endpointIndex.get(withPrefix);
    if (match) return match;

    // Try matching by endpoint name (e.g., "chat.postMessage")
    for (const [key, value] of this.endpointIndex.entries()) {
      if (key.endsWith(path) || key.endsWith(`/${path}`)) {
        return value;
      }
    }

    return undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function isHttpMethod(method: string): method is HttpMethod {
  return ["get", "post", "put", "delete", "patch"].includes(
    method.toLowerCase(),
  );
}
