/**
 * Workflow Registry Tests
 *
 * Validates:
 * 1. All 10 predefined workflows have valid structure
 * 2. Every operationId referenced in workflow steps exists in RC OpenAPI specs
 * 3. ParameterMappings reference valid step indices
 * 4. UserParams reference valid step indices
 */

import { describe, it, expect, beforeAll } from "vitest";
import { WorkflowRegistry } from "../src/core/workflow-registry.js";
import { SuggestEngine } from "../src/core/suggest-engine.js";

describe("WorkflowRegistry", () => {
  const registry = new WorkflowRegistry();

  describe("listWorkflows", () => {
    it("should return all 13 predefined workflows", () => {
      const workflows = registry.listWorkflows();
      expect(workflows.length).toBe(13);
    });

    it("each workflow should have a unique name", () => {
      const workflows = registry.listWorkflows();
      const names = workflows.map((w) => w.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("getWorkflow", () => {
    it("should return a workflow by name", () => {
      const w = registry.getWorkflow("send_message_to_channel");
      expect(w).toBeDefined();
      expect(w!.name).toBe("send_message_to_channel");
    });

    it("should return undefined for unknown workflow", () => {
      const w = registry.getWorkflow("nonexistent_workflow");
      expect(w).toBeUndefined();
    });
  });

  describe("getWorkflows", () => {
    it("should return multiple workflows by name", () => {
      const workflows = registry.getWorkflows([
        "send_message_to_channel",
        "create_project_channel",
      ]);
      expect(workflows.length).toBe(2);
    });

    it("should throw for unknown workflow names", () => {
      expect(() =>
        registry.getWorkflows(["send_message_to_channel", "nonexistent"]),
      ).toThrow('Workflow "nonexistent" not found');
    });
  });

  describe("structural validation", () => {
    it("every workflow has at least 1 step", () => {
      for (const w of registry.listWorkflows()) {
        expect(w.steps.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("every workflow has at least 1 user param", () => {
      for (const w of registry.listWorkflows()) {
        expect(w.userParams.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("every workflow has a non-empty description", () => {
      for (const w of registry.listWorkflows()) {
        expect(w.description.length).toBeGreaterThan(10);
      }
    });

    it("parameterMappings reference valid step indices", () => {
      for (const w of registry.listWorkflows()) {
        for (let i = 0; i < w.steps.length; i++) {
          const step = w.steps[i];
          for (const mapping of step.parameterMappings) {
            expect(mapping.fromStep).toBeGreaterThanOrEqual(0);
            expect(mapping.fromStep).toBeLessThan(i); // must ref a PREVIOUS step
            expect(mapping.fromField.length).toBeGreaterThan(0);
            expect(mapping.toParam.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it("userParams reference valid step indices", () => {
      for (const w of registry.listWorkflows()) {
        for (const param of w.userParams) {
          expect(param.forStep).toBeGreaterThanOrEqual(0);
          expect(param.forStep).toBeLessThan(w.steps.length);
          expect(param.asParam.length).toBeGreaterThan(0);
        }
      }
    });

    it("first step never has parameterMappings from previous steps", () => {
      for (const w of registry.listWorkflows()) {
        expect(w.steps[0].parameterMappings.length).toBe(0);
      }
    });
  });

  describe("operationId validation against OpenAPI specs", () => {
    let validOperationIds: Set<string>;

    beforeAll(async () => {
      // Load all endpoints from the suggest engine (same source as generation)
      const engine = new SuggestEngine();
      await engine.loadEndpoints();
      const endpoints = engine.getEndpoints();
      validOperationIds = new Set(endpoints.map((ep) => ep.operationId));
    });

    it("all operationIds referenced in workflows exist in the RC specs", () => {
      const allOpIds = registry.getAllOperationIds();
      const missing: string[] = [];

      for (const opId of allOpIds) {
        if (!validOperationIds.has(opId)) {
          missing.push(opId);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `Workflow operationIds not found in RC specs: ${missing.join(", ")}`,
        );
      }
    }, 30_000);
  });

  describe("getSummary", () => {
    it("should return a formatted summary of all workflows", () => {
      const summary = registry.getSummary();
      expect(summary).toContain("send_message_to_channel");
      expect(summary).toContain("create_project_channel");
      expect(summary.split("\n").length).toBe(13);
    });
  });
});
