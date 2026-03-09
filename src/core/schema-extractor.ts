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

import { readFileSync, readdirSync } from "fs";
import { resolve, basename } from "path";
import { parse as parseYaml } from "yaml";
import type {
    EndpointSchema,
    HttpMethod,
    ParameterSchema,
    RequestBodySchema,
    ResponseSchema,
    JsonSchemaProperty,
} from "./types.js";

export class SchemaExtractor {
    /** Index of all discovered endpoints keyed by API path */
    private endpointIndex: Map<string, EndpointSchema> = new Map();
    /** Raw parsed OpenAPI documents for $ref resolution */
    private documents: Map<string, Record<string, unknown>> = new Map();

    /**
     * Load all OpenAPI YAML files from a directory.
     * Builds an internal index of every endpoint across all files.
     *
     * @param specDir - Directory containing OpenAPI YAML files
     */
    loadFromDirectory(specDir: string): void {
        const files = readdirSync(specDir).filter(
            (f) => f.endsWith(".yaml") || f.endsWith(".yml")
        );

        for (const file of files) {
            const filePath = resolve(specDir, file);
            this.loadFile(filePath);
        }
    }

    /**
     * Load a single OpenAPI YAML file and index its endpoints.
     */
    loadFile(filePath: string): void {
        const raw = readFileSync(filePath, "utf-8");
        const doc = parseYaml(raw) as Record<string, unknown>;
        const fileName = basename(filePath);

        this.documents.set(fileName, doc);

        const paths = (doc.paths as Record<string, Record<string, unknown>>) ?? {};

        for (const [apiPath, methods] of Object.entries(paths)) {
            for (const [method, operation] of Object.entries(methods)) {
                if (!isHttpMethod(method)) continue;

                const op = operation as Record<string, unknown>;
                const endpoint = this.extractEndpoint(apiPath, method, op, fileName, doc);
                this.endpointIndex.set(apiPath, endpoint);
            }
        }
    }

    /**
     * Extract endpoint schemas for the given API paths.
     *
     * @param paths - Array of API paths (e.g., ["/api/v1/chat.postMessage"])
     * @returns Array of extracted EndpointSchema objects
     * @throws Error if a requested endpoint is not found in any loaded spec
     */
    extractEndpoints(paths: string[]): EndpointSchema[] {
        const results: EndpointSchema[] = [];

        for (const path of paths) {
            const endpoint = this.endpointIndex.get(path);
            if (!endpoint) {
                // Try fuzzy matching (without /api/v1/ prefix)
                const fuzzyMatch = this.fuzzyFind(path);
                if (fuzzyMatch) {
                    results.push(fuzzyMatch);
                    continue;
                }

                const available = Array.from(this.endpointIndex.keys()).slice(0, 10);
                throw new Error(
                    `Endpoint not found: "${path}". ` +
                    `Some available endpoints: ${available.join(", ")}...`
                );
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
        operation: Record<string, unknown>,
        sourceFile: string,
        doc: Record<string, unknown>
    ): EndpointSchema {
        const operationId =
            (operation.operationId as string) ??
            this.generateOperationId(path, method);

        const summary = (operation.summary as string) ?? "";
        const description = (operation.description as string) ?? summary;
        const tags = (operation.tags as string[]) ?? [];

        // Extract parameters
        const rawParams =
            (operation.parameters as Array<Record<string, unknown>>) ?? [];
        const parameters = rawParams.map((p) =>
            this.extractParameter(p, doc)
        );

        // Extract request body
        let requestBody: RequestBodySchema | undefined;
        if (operation.requestBody) {
            requestBody = this.extractRequestBody(
                operation.requestBody as Record<string, unknown>,
                doc
            );
        }

        // Extract responses
        const rawResponses =
            (operation.responses as Record<string, Record<string, unknown>>) ?? {};
        const responses: Record<string, ResponseSchema> = {};
        for (const [status, resp] of Object.entries(rawResponses)) {
            responses[status] = this.extractResponse(resp, doc);
        }

        // Determine auth requirement (look for security or auth-related headers)
        const requiresAuth = this.detectAuthRequirement(operation, parameters);

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
        };
    }

    private extractParameter(
        param: Record<string, unknown>,
        doc: Record<string, unknown>
    ): ParameterSchema {
        // Resolve $ref if present
        const resolved = param.$ref
            ? this.resolveRef(param.$ref as string, doc)
            : param;

        return {
            name: (resolved.name as string) ?? "unknown",
            in: (resolved.in as "query" | "path" | "header") ?? "query",
            required: (resolved.required as boolean) ?? false,
            description: (resolved.description as string) ?? "",
            schema: this.normalizeSchema(
                (resolved.schema as Record<string, unknown>) ?? { type: "string" }
            ),
        };
    }

    private extractRequestBody(
        body: Record<string, unknown>,
        doc: Record<string, unknown>
    ): RequestBodySchema {
        // Resolve $ref if present
        const resolved = body.$ref
            ? this.resolveRef(body.$ref as string, doc)
            : body;

        const content = (resolved.content as Record<string, Record<string, unknown>>) ?? {};

        // Prefer application/json
        const jsonContent = content["application/json"];
        if (jsonContent) {
            const schema = jsonContent.schema
                ? this.resolveSchemaRefs(
                    jsonContent.schema as Record<string, unknown>,
                    doc
                )
                : { type: "object" };

            return {
                required: (resolved.required as boolean) ?? false,
                contentType: "application/json",
                schema: this.normalizeSchema(schema),
            };
        }

        // Fallback to first content type
        const firstEntry = Object.entries(content)[0];
        if (firstEntry) {
            const [contentType, contentDef] = firstEntry;
            const schema = contentDef.schema
                ? this.resolveSchemaRefs(
                    contentDef.schema as Record<string, unknown>,
                    doc
                )
                : { type: "object" };

            return {
                required: (resolved.required as boolean) ?? false,
                contentType,
                schema: this.normalizeSchema(schema),
            };
        }

        return {
            required: false,
            contentType: "application/json",
            schema: { type: "object" },
        };
    }

    private extractResponse(
        resp: Record<string, unknown>,
        doc: Record<string, unknown>
    ): ResponseSchema {
        const resolved = resp.$ref
            ? this.resolveRef(resp.$ref as string, doc)
            : resp;

        const description = (resolved.description as string) ?? "";
        const content = (resolved.content as Record<string, Record<string, unknown>>) ?? {};
        const jsonContent = content["application/json"];

        let schema: JsonSchemaProperty | undefined;
        if (jsonContent?.schema) {
            schema = this.normalizeSchema(
                this.resolveSchemaRefs(
                    jsonContent.schema as Record<string, unknown>,
                    doc
                )
            );
        }

        return { description, schema };
    }

    // ─── Private: $ref Resolution ───────────────────────────────────────

    private resolveRef(
        ref: string,
        doc: Record<string, unknown>
    ): Record<string, unknown> {
        // Handle internal refs like "#/components/schemas/Message"
        if (ref.startsWith("#/")) {
            const parts = ref.slice(2).split("/");
            let current: unknown = doc;

            for (const part of parts) {
                if (current && typeof current === "object") {
                    current = (current as Record<string, unknown>)[part];
                } else {
                    return {}; // Ref not found, return empty
                }
            }

            return (current as Record<string, unknown>) ?? {};
        }

        return {};
    }

    private resolveSchemaRefs(
        schema: Record<string, unknown>,
        doc: Record<string, unknown>,
        depth = 0
    ): Record<string, unknown> {
        // Prevent infinite recursion
        if (depth > 10) return schema;

        if (schema.$ref) {
            const resolved = this.resolveRef(schema.$ref as string, doc);
            return this.resolveSchemaRefs(resolved, doc, depth + 1);
        }

        // Recursively resolve properties
        const result = { ...schema };

        if (result.properties && typeof result.properties === "object") {
            const props: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(
                result.properties as Record<string, Record<string, unknown>>
            )) {
                props[key] = this.resolveSchemaRefs(value, doc, depth + 1);
            }
            result.properties = props;
        }

        if (result.items && typeof result.items === "object") {
            result.items = this.resolveSchemaRefs(
                result.items as Record<string, unknown>,
                doc,
                depth + 1
            );
        }

        return result;
    }

    // ─── Private: Helpers ───────────────────────────────────────────────

    private normalizeSchema(
        schema: Record<string, unknown>
    ): JsonSchemaProperty {
        return {
            type: (schema.type as string) ?? "string",
            description: schema.description as string | undefined,
            enum: schema.enum as string[] | undefined,
            default: schema.default,
            items: schema.items
                ? this.normalizeSchema(schema.items as Record<string, unknown>)
                : undefined,
            properties: schema.properties
                ? Object.fromEntries(
                    Object.entries(
                        schema.properties as Record<string, Record<string, unknown>>
                    ).map(([k, v]) => [k, this.normalizeSchema(v)])
                )
                : undefined,
            required: schema.required as string[] | undefined,
            format: schema.format as string | undefined,
        };
    }

    private detectAuthRequirement(
        operation: Record<string, unknown>,
        parameters: ParameterSchema[]
    ): boolean {
        // Check for security definitions
        if (operation.security) return true;

        // Check for auth-related headers
        const authHeaders = parameters.filter(
            (p) =>
                p.in === "header" &&
                (p.name.toLowerCase().includes("auth") ||
                    p.name.toLowerCase().includes("token") ||
                    p.name === "X-Auth-Token" ||
                    p.name === "X-User-Id")
        );

        return authHeaders.length > 0;
    }

    private generateOperationId(path: string, method: HttpMethod): string {
        // Convert /api/v1/chat.postMessage → postChatPostMessage
        const cleanPath = path
            .replace(/^\/api\/v[0-9]+\//, "")
            .replace(/[./]/g, "_");
        return `${method}${cleanPath.charAt(0).toUpperCase()}${cleanPath.slice(1)}`;
    }

    private fuzzyFind(path: string): EndpointSchema | undefined {
        // Try matching without /api/v1/ prefix
        const withPrefix = path.startsWith("/api/v1/")
            ? path
            : `/api/v1/${path}`;

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
        method.toLowerCase()
    );
}
