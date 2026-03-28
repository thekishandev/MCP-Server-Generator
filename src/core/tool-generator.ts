/**
 * Tool Generator
 *
 * Takes extracted EndpointSchema objects and generates MCP tool definitions
 * including Zod schemas and handler functions. The output is GeneratedTool
 * objects ready for template rendering by the Server Scaffolder.
 */

import type {
  EndpointSchema,
  GeneratedTool,
  JsonSchemaProperty,
  WorkflowDefinition,
} from "./types.js";
import { WorkflowComposer } from "./workflow-composer.js";
import { type ProviderConfig, RocketChatProvider } from "./provider-config.js";

export class ToolGenerator {
  private workflowComposer = new WorkflowComposer();
  private provider: ProviderConfig;

  constructor(provider?: ProviderConfig) {
    this.provider = provider ?? RocketChatProvider;
  }

  /**
   * Generate MCP tool definitions from endpoint schemas.
   * 1:1 mapping — one tool per endpoint (raw API wrappers).
   *
   * @param endpoints - Extracted endpoint schemas from the Schema Extractor
   * @returns Array of generated tool definitions
   */
  generateTools(endpoints: EndpointSchema[]): GeneratedTool[] {
    return endpoints.map((endpoint) => this.generateTool(endpoint));
  }

  /**
   * Generate a composite MCP tool from a workflow definition.
   * N:1 mapping — multiple endpoints compose into one high-level tool.
   *
   * @param definition - Workflow definition with steps and parameterMappings
   * @param endpoints  - Extracted EndpointSchema[] for the operationIds in this workflow
   * @returns A single GeneratedTool with a chained handler
   */
  generateWorkflowTool(
    definition: WorkflowDefinition,
    endpoints: EndpointSchema[],
  ): GeneratedTool {
    return this.workflowComposer.compose(definition, endpoints);
  }

  /**
   * Generate a single MCP tool from an endpoint schema.
   */
  private generateTool(endpoint: EndpointSchema): GeneratedTool {
    const toolName = this.endpointToToolName(endpoint.path);
    const description = this.buildDescription(endpoint);
    const zodSchemaCode = this.generateZodSchema(endpoint);
    const handlerCode = this.generateHandler(endpoint, toolName);

    return {
      toolName,
      description,
      zodSchemaCode,
      handlerCode,
      endpoint,
    };
  }

  // ─── Tool Name Generation ────────────────────────────────────────────

  /**
   * Convert an API path to a valid MCP tool name.
   * e.g., "/api/v1/chat.postMessage" → "chat_postMessage"
   */
  private endpointToToolName(path: string): string {
    return path
      .replace(this.provider.apiPrefix, "") // Strip API version prefix
      .replace(/\./g, "_") // Replace dots with underscores
      .replace(/\//g, "_") // Replace slashes with underscores
      .replace(/[^a-zA-Z0-9_]/g, "") // Remove invalid characters
      .replace(/^_+|_+$/g, ""); // Trim leading/trailing underscores
  }

  // ─── Description Building (with compression) ─────────────────────────

  /**
   * Maximum description length. Balances two competing concerns:
   * - Too short → LLM can't distinguish similar tools → hallucination
   * - Too long  → context bloat shifts from tool count to description verbosity
   * Mentor feedback: "Don't compromise on descriptions — hallucination > tokens"
   */
  private static readonly MAX_DESC_LENGTH = 200;

  /**
   * Build a concise, compressed tool description.
   * Prevents context bloat from shifting from tool count → description verbosity.
   * Descriptions are automatically truncated to essential fields.
   */
  private buildDescription(endpoint: EndpointSchema): string {
    // Start with the summary — it's always the most concise
    let desc = endpoint.summary || "";

    // If no summary, build from the path
    if (!desc) {
      const pathName = endpoint.path
        .replace(/^\/api\/v[0-9]+\//, "")
        .replace(/\./g, " ");
      desc = `${endpoint.method.toUpperCase()} ${pathName}`;
    }

    // Strip common OpenAPI boilerplate phrases
    desc = desc
      .replace(/\s*\(requires authentication\)/gi, "")
      .replace(/\s*\(admin only\)/gi, "")
      .replace(/\s*Permission required:.*$/gi, "")
      .replace(/\s*<br\/?>.*$/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    // Extract required parameters
    const requiredParams = [];
    if (endpoint.parameters) {
      requiredParams.push(...endpoint.parameters.filter(p => p.required && !this.isAuthHeader(p.name)).map(p => p.name));
    }
    if (endpoint.requestBody?.schema && "required" in endpoint.requestBody.schema) {
      const req = endpoint.requestBody.schema.required;
      if (Array.isArray(req)) requiredParams.push(...req);
    }
    const reqStr = requiredParams.length > 0 ? ` Requires: ${requiredParams.join(", ")}.` : "";

    // Enrich short descriptions (e.g., "React to Message") to prevent hallucination
    if (desc.length < 30) {
      const pathName = endpoint.path.replace(this.provider.apiPrefix, "");
      desc = `${desc}. ${endpoint.method.toUpperCase()} ${pathName} API wrapper.`;
    }

    // Truncate to max base length
    const maxBaseDesc = 140;
    if (desc.length > maxBaseDesc) {
      desc = desc.substring(0, maxBaseDesc - 3) + "...";
    }

    return desc + reqStr;
  }

  // ─── Zod Schema Generation ──────────────────────────────────────────

  /**
   * Generate a Zod schema definition string from the endpoint's parameters
   * and request body.
   */
  generateZodSchema(endpoint: EndpointSchema): string {
    const fields: string[] = [];

    // Auth is handled by rcClient (pre-authenticated from .env at startup).
    // Only expose API-specific params — no authToken/userId.

    // Add query/path parameters (skip auth headers)
    for (const param of endpoint.parameters) {
      if (this.isAuthHeader(param.name)) continue;
      fields.push(
        this.paramToZodField(
          param.name,
          param.schema,
          param.required,
          param.description,
        ),
      );
    }

    // Add request body properties
    if (endpoint.requestBody?.schema.properties) {
      const bodyRequired = endpoint.requestBody.schema.required ?? [];
      for (const [name, prop] of Object.entries(
        endpoint.requestBody.schema.properties,
      )) {
        const isRequired = bodyRequired.includes(name);
        fields.push(
          this.paramToZodField(name, prop, isRequired, prop.description ?? ""),
        );
      }
    }

    if (fields.length === 0) {
      return "z.object({})";
    }

    return `z.object({\n${fields.map((f) => `    ${f}`).join(",\n")}\n  })`;
  }

  /**
   * Convert a single parameter to a Zod field declaration.
   */
  private paramToZodField(
    name: string,
    schema: JsonSchemaProperty,
    required: boolean,
    description: string,
  ): string {
    let zodType = this.jsonSchemaToZod(schema);

    if (!required) {
      zodType += ".optional()";
    }

    if (description) {
      // Escape quotes in description
      const escapedDesc = description.replace(/"/g, '\\"').replace(/\n/g, " ");
      zodType += `.describe("${escapedDesc}")`;
    }

    return `${this.sanitizeFieldName(name)}: ${zodType}`;
  }

  /**
   * Convert a JSON Schema type to a Zod type expression.
   */
  private jsonSchemaToZod(schema: JsonSchemaProperty): string {
    // Handle enums
    if (schema.enum && schema.enum.length > 0) {
      const values = schema.enum.map((v) => `"${v}"`).join(", ");
      return `z.enum([${values}])`;
    }

    switch (schema.type) {
      case "string":
        return "z.string()";
      case "number":
      case "integer":
        return "z.number()";
      case "boolean":
        return "z.boolean()";
      case "array":
        if (schema.items) {
          return `z.array(${this.jsonSchemaToZod(schema.items)})`;
        }
        return "z.array(z.unknown())";
      case "object":
        if (schema.properties) {
          const nestedFields: string[] = [];
          const requiredFields = schema.required ?? [];
          for (const [name, prop] of Object.entries(schema.properties)) {
            const isRequired = requiredFields.includes(name);
            nestedFields.push(
              this.paramToZodField(
                name,
                prop,
                isRequired,
                prop.description ?? "",
              ),
            );
          }
          return `z.object({\n      ${nestedFields.join(",\n      ")}\n    })`;
        }
        return "z.record(z.unknown())";
      default:
        return "z.unknown()";
    }
  }

  // ─── Handler Code Generation ─────────────────────────────────────────

  /**
   * Generate the tool handler function code.
   */
  private generateHandler(endpoint: EndpointSchema, _toolName: string): string {
    const method = endpoint.method.toLowerCase();
    const hasBody =
      !!endpoint.requestBody &&
      (method === "post" || method === "put" || method === "patch");

    // Build query parameter extraction
    const queryParams = endpoint.parameters.filter(
      (p) => p.in === "query" && !this.isAuthHeader(p.name),
    );
    const pathParams = endpoint.parameters.filter((p) => p.in === "path");

    // Build the handler
    const lines: string[] = [];
    lines.push("async (params) => {");
    lines.push("      try {");
    lines.push("        // Auth is pre-configured from .env — no per-call credentials needed");

    // Build the API path (with path parameter substitution)
    if (pathParams.length > 0) {
      let pathExpr = `\`${endpoint.path}\``;
      for (const pp of pathParams) {
        pathExpr = pathExpr.replace(
          `{${pp.name}}`,
          `\${params.${this.sanitizeFieldName(pp.name)}}`,
        );
      }
      lines.push(`        const apiPath = ${pathExpr};`);
    } else {
      lines.push(`        const apiPath = "${endpoint.path}";`);
    }

    // Build query string
    if (queryParams.length > 0) {
      lines.push("        const queryParts: string[] = [];");
      for (const qp of queryParams) {
        const fieldName = this.sanitizeFieldName(qp.name);
        lines.push(
          `        if (params.${fieldName} !== undefined) queryParts.push(\`${qp.name}=\${encodeURIComponent(String(params.${fieldName}))}\`);`,
        );
      }
      lines.push(
        '        const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";',
      );
      lines.push("        const fullPath = `${apiPath}${query}`;");
    }

    // Make the API call
    const pathRef = queryParams.length > 0 ? "fullPath" : "apiPath";

    if (hasBody) {
      // Extract body params (all request body properties), excluding query params
      const bodyProps = endpoint.requestBody?.schema.properties
        ? Object.keys(endpoint.requestBody.schema.properties)
        : [];
      const queryPropNames = queryParams.map((qp) => qp.name);
      const bodyParamNames = bodyProps.filter(
        (name) => !queryPropNames.includes(name),
      );

      if (bodyParamNames.length > 0) {
        const bodyObj = bodyParamNames
          .map(
            (n) =>
              `          ${this.sanitizeFieldName(n)}: params.${this.sanitizeFieldName(n)}`,
          )
          .join(",\n");
        lines.push(`        const body = {\n${bodyObj}\n        };`);
        lines.push(
          `        const result = await rcClient.${method}(${pathRef}, body);`,
        );
      } else {
        // No named body fields — pass all params as body
        lines.push(`        const result = await rcClient.${method}(${pathRef}, params);`);
      }
    } else {
      lines.push(
        `        const result = await rcClient.${method}(${pathRef});`,
      );
    }

    lines.push(
      '        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };',
    );
    lines.push("      } catch (error) {");
    lines.push('        let message = error instanceof Error ? error.message : String(error);');
    lines.push('        if (message.includes("RC API Error")) {');
    lines.push('          const match = message.match(/RC API Error \\[(\\d+)\\] .*?: (.*)/);');
    lines.push('          if (match) {');
    lines.push('            message = `HTTP ${match[1]}: ${match[2]}`;');
    lines.push('          }');
    lines.push('        }');
    lines.push('        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };');
    lines.push("      }");
    lines.push("    }");

    return lines.join("\n");
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private isAuthHeader(name: string): boolean {
    return this.provider.authHeaderKeys
      .map((k) => k.toLowerCase())
      .includes(name.toLowerCase());
  }

  private sanitizeFieldName(name: string): string {
    // If the name contains special characters, wrap in quotes
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      return name;
    }
    return `"${name}"`;
  }
}
