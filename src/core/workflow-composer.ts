/**
 * Workflow Composer
 *
 * Takes a WorkflowDefinition and produces a GeneratedTool whose handler
 * chains multiple RC API calls sequentially. This is the core engine that
 * transforms "one-tool-per-endpoint" into "one-tool-per-workflow-operation"
 * — addressing the GSoC requirement for higher-level platform operations.
 *
 * Design principles:
 * - Generic: Uses parameterMappings from the definition — never hardcodes field names
 * - Sequential: Steps execute in order; each step's response is available to subsequent steps
 * - Error-contextual: If step N fails, reports which step + endpoint failed
 * - Same interface: Outputs GeneratedTool — scaffolder/templates need no changes
 */

import type {
  WorkflowDefinition,
  EndpointSchema,
  GeneratedTool,
  UserParam,
} from "./types.js";

export class WorkflowComposer {
  /**
   * Generate a composite MCP tool from a workflow definition.
   *
   * @param definition - The workflow definition (name, steps, parameterMappings, userParams)
   * @param endpoints  - Extracted EndpointSchema[] for the operationIds referenced by this workflow
   * @returns A GeneratedTool with a composite handler that chains all steps
   */
  compose(
    definition: WorkflowDefinition,
    endpoints: EndpointSchema[],
  ): GeneratedTool {
    // Build lookup: operationId → EndpointSchema
    const epMap = new Map<string, EndpointSchema>();
    for (const ep of endpoints) {
      epMap.set(ep.operationId, ep);
    }

    // Verify all referenced operationIds exist
    for (const step of definition.steps) {
      if (!epMap.has(step.operationId)) {
        throw new Error(
          `Workflow "${definition.name}" references operationId "${step.operationId}" which was not found in the extracted endpoints.`,
        );
      }
    }

    const zodSchemaCode = this.generateZodSchema(definition);
    const handlerCode = this.generateHandler(definition, epMap);
    const description = this.compressDescription(definition.description);

    // Use the first step's endpoint as the "primary" for metadata
    const primaryEndpoint = epMap.get(definition.steps[0].operationId)!;

    return {
      toolName: definition.name,
      description,
      zodSchemaCode,
      handlerCode,
      // Attach primary endpoint for scaffolder metadata (method, path, etc.)
      endpoint: {
        ...primaryEndpoint,
        operationId: definition.name,
        summary: definition.description,
        description: `Workflow: ${definition.steps.map((s) => s.operationId).join(" → ")}`,
      },
    };
  }

  // ─── Zod Schema Generation ──────────────────────────────────────────

  /**
   * Generate Zod schema from user-facing params only.
   * Auto-wired params (from parameterMappings) are NOT exposed.
   */
  private generateZodSchema(definition: WorkflowDefinition): string {
    const fields: string[] = [];

    // Auth params (always required for workflow tools)
    fields.push(
      'authToken: z.string().describe("Rocket.Chat Auth Token (X-Auth-Token)")',
    );
    fields.push(
      'userId: z.string().describe("Rocket.Chat User ID (X-User-Id)")',
    );

    // User-facing params from the definition
    for (const param of definition.userParams) {
      const zodType = this.typeToZod(param.type);
      const optionalSuffix = param.required ? "" : ".optional()";
      const escapedDesc = param.description.replace(/"/g, '\\"');
      fields.push(
        `${param.name}: ${zodType}${optionalSuffix}.describe("${escapedDesc}")`,
      );
    }

    return `z.object({\n${fields.map((f) => `    ${f}`).join(",\n")}\n  })`;
  }

  private typeToZod(type: string): string {
    switch (type) {
      case "string":
        return "z.string()";
      case "number":
      case "integer":
        return "z.number()";
      case "boolean":
        return "z.boolean()";
      case "array":
        return "z.array(z.string())";
      default:
        return "z.unknown()";
    }
  }

  // ─── Handler Code Generation ────────────────────────────────────────

  /**
   * Generate the composite handler that chains multiple API calls.
   * Uses stepResults array to pass data between steps via parameterMappings.
   */
  private generateHandler(
    definition: WorkflowDefinition,
    epMap: Map<string, EndpointSchema>,
  ): string {
    const lines: string[] = [];

    lines.push("async (params) => {");
    lines.push("      try {");
    lines.push(
      "        // Set auth credentials for all API calls in this workflow",
    );
    lines.push(
      "        rcClient.setAuth(params.authToken, params.userId);",
    );
    lines.push("");
    lines.push(
      "        // Store results from each step for parameter wiring",
    );
    lines.push("        const stepResults: unknown[] = [];");
    lines.push("");

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      const ep = epMap.get(step.operationId)!;
      const method = ep.method.toLowerCase();
      const stepDesc = step.description ?? step.operationId;

      lines.push(`        // ── Step ${i + 1}: ${stepDesc} ──`);

      // Build the params object for this step
      lines.push(`        const step${i}Params: Record<string, unknown> = {};`);

      // Wire user params that target this step
      for (const userParam of definition.userParams) {
        if (userParam.forStep === i) {
          lines.push(
            `        if (params.${userParam.name} !== undefined) step${i}Params["${userParam.asParam}"] = params.${userParam.name};`,
          );
        }
      }

      // Wire auto-mapped params from previous steps
      for (const mapping of step.parameterMappings) {
        lines.push(
          `        step${i}Params["${mapping.toParam}"] = ${this.generateDotPathAccess(`stepResults[${mapping.fromStep}]`, mapping.fromField)};`,
        );
      }

      // Make the API call
      const hasBody = ["post", "put", "patch"].includes(method);
      if (hasBody) {
        lines.push(
          `        const step${i}Result = await rcClient.${method}("${ep.path}", step${i}Params);`,
        );
      } else {
        // For GET/DELETE, build query string from params
        lines.push(
          `        const step${i}Query = Object.entries(step${i}Params)`,
        );
        lines.push(
          `          .filter(([, v]) => v !== undefined)`,
        );
        lines.push(
          `          .map(([k, v]) => \`\${k}=\${encodeURIComponent(String(v))}\`)`,
        );
        lines.push(`          .join("&");`);
        lines.push(
          `        const step${i}Path = step${i}Query ? \`${ep.path}?\${step${i}Query}\` : "${ep.path}";`,
        );
        lines.push(
          `        const step${i}Result = await rcClient.${method}(step${i}Path);`,
        );
      }

      lines.push(`        stepResults.push(step${i}Result);`);
      lines.push("");
    }

    // Return the final step's result
    const lastIdx = definition.steps.length - 1;
    lines.push(
      `        // Return the final result from step ${lastIdx + 1}`,
    );
    lines.push(
      `        return { content: [{ type: "text" as const, text: JSON.stringify(step${lastIdx}Result, null, 2) }] };`,
    );
    lines.push("      } catch (error) {");
    lines.push(
      '        const message = error instanceof Error ? error.message : "Unknown error";',
    );
    lines.push(
      '        return { content: [{ type: "text" as const, text: `Workflow "${' +
        JSON.stringify(definition.name) +
        '}" failed: ${message}` }], isError: true };',
    );
    lines.push("      }");
    lines.push("    }");

    return lines.join("\n");
  }

  /**
   * Generate code to access a nested field via dot-path.
   * E.g., "channel._id" → (result as any)?.channel?._id
   */
  private generateDotPathAccess(base: string, dotPath: string): string {
    const parts = dotPath.split(".");
    let access = `(${base} as any)`;
    for (const part of parts) {
      // If the part is a number, treat as array index
      if (/^\d+$/.test(part)) {
        access += `?.[${part}]`;
      } else {
        access += `?.${part}`;
      }
    }
    return access;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private compressDescription(desc: string): string {
    const maxLen = 120;
    if (desc.length <= maxLen) return desc;
    return desc.substring(0, maxLen - 3) + "...";
  }
}
