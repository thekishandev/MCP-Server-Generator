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
} from "./types.js";

export class ToolGenerator {
  /**
   * Generate MCP tool definitions from endpoint schemas.
   *
   * @param endpoints - Extracted endpoint schemas from the Schema Extractor
   * @returns Array of generated tool definitions
   */
  generateTools(endpoints: EndpointSchema[]): GeneratedTool[] {
    return endpoints.map((endpoint) => this.generateTool(endpoint));
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
      .replace(/^\/api\/v[0-9]+\//, "") // Strip API version prefix
      .replace(/\./g, "_") // Replace dots with underscores
      .replace(/\//g, "_") // Replace slashes with underscores
      .replace(/[^a-zA-Z0-9_]/g, "") // Remove invalid characters
      .replace(/^_+|_+$/g, ""); // Trim leading/trailing underscores
  }

  // ─── Description Building (with compression) ─────────────────────────

  /** Maximum description length in characters to prevent context bloat shifting */
  private static readonly MAX_DESC_LENGTH = 120;

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

    // Truncate to max length
    if (desc.length > ToolGenerator.MAX_DESC_LENGTH) {
      desc = desc.substring(0, ToolGenerator.MAX_DESC_LENGTH - 3) + "...";
    }

    return desc;
  }

  // ─── Zod Schema Generation ──────────────────────────────────────────

  /**
   * Generate a Zod schema definition string from the endpoint's parameters
   * and request body.
   */
  generateZodSchema(endpoint: EndpointSchema): string {
    const fields: string[] = [];

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
      // Extract body params (all request body properties)
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
        lines.push(
          `        const result = await rcClient.${method}(${pathRef}, params);`,
        );
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
    lines.push(
      '        const message = error instanceof Error ? error.message : "Unknown error";',
    );
    lines.push(
      '        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };',
    );
    lines.push("      }");
    lines.push("    }");

    return lines.join("\n");
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private isAuthHeader(name: string): boolean {
    const authHeaders = [
      "x-auth-token",
      "x-user-id",
      "x-2fa-code",
      "authorization",
    ];
    return authHeaders.includes(name.toLowerCase());
  }

  private sanitizeFieldName(name: string): string {
    // If the name contains special characters, wrap in quotes
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      return name;
    }
    return `"${name}"`;
  }
}
