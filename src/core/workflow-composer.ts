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
      if (step.fallbackOperationId && !epMap.has(step.fallbackOperationId)) {
        throw new Error(
          `Workflow "${definition.name}" references fallbackOperationId "${step.fallbackOperationId}" which was not found in the extracted endpoints.`,
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

    // Auth is handled by rcClient (pre-authenticated from .env at startup).
    // Only expose user-facing params — no authToken/userId.

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
      "        // Auth is pre-configured from .env — no per-call credentials needed",
    );
    lines.push("");
    lines.push(
      "        // Store results from each step for parameter wiring",
    );
    lines.push("        const stepResults: unknown[] = [];");
    lines.push("");

    for (let i = 0; i < definition.steps.length; i++) {
      if (i > 0) {
        lines.push(`        // Small delay to ensure previous operations are fully processed by the server`);
        lines.push(`        await new Promise(resolve => setTimeout(resolve, 500));`);
        lines.push("");
      }

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

      // Inject fixed params
      if (step.fixedParams) {
        for (const [k, v] of Object.entries(step.fixedParams)) {
          lines.push(
            `        step${i}Params["${k}"] = ${JSON.stringify(v)};`
          );
        }
      }

      lines.push(`        let step${i}Result;`);

      const generateCall = (opId: string, indent: string) => {
        const epRoute = epMap.get(opId)!;
        const callMethod = epRoute.method.toLowerCase();
        const hasB = ["post", "put", "patch"].includes(callMethod);
        const callLines: string[] = [];
        if (hasB) {
          callLines.push(`${indent}step${i}Result = await rcClient.${callMethod}("${epRoute.path}", step${i}Params);`);
        } else {
          callLines.push(`${indent}{`);
          callLines.push(`${indent}  const step${i}Query = Object.entries(step${i}Params).filter(([, v]) => v !== undefined).map(([k, v]) => \`\${k}=\${encodeURIComponent(String(v))}\`).join("&");`);
          callLines.push(`${indent}  const step${i}Path = step${i}Query ? \`${epRoute.path}?\${step${i}Query}\` : "${epRoute.path}";`);
          callLines.push(`${indent}  step${i}Result = await rcClient.${callMethod}(step${i}Path);`);
          callLines.push(`${indent}}`);
        }
        return callLines;
      };

      if (step.fallbackOperationId) {
        lines.push(`        try {`);
        lines.push(...generateCall(step.operationId, "          "));
        lines.push(`        } catch (err) {`);
        lines.push(`          // Fallback to ${step.fallbackOperationId}`);
        lines.push(...generateCall(step.fallbackOperationId, "          "));
        lines.push(`        }`);
      } else {
        lines.push(...generateCall(step.operationId, "        "));
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
    const maxLen = 200;
    const baseLen = 140;
    if (desc.length <= baseLen) return desc;
    // Truncate at base length to leave room for workflow step info
    return desc.substring(0, baseLen - 3) + "...";
  }
}
