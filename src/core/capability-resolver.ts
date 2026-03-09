/**
 * Capability Resolver
 * 
 * Maps high-level capability names (e.g., "send-message") to the specific
 * Rocket.Chat API endpoints required. Supports composing multiple capabilities
 * with automatic deduplication.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { CapabilityRegistry, CapabilityDefinition } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Default path to the Rocket.Chat capabilities registry */
const DEFAULT_CAPABILITIES_PATH = resolve(
    __dirname,
    "../providers/rocketchat/capabilities.json"
);

export class CapabilityResolver {
    private registry: CapabilityRegistry;

    constructor(registryPath?: string) {
        const path = registryPath ?? DEFAULT_CAPABILITIES_PATH;
        const raw = readFileSync(path, "utf-8");
        this.registry = JSON.parse(raw) as CapabilityRegistry;
    }

    /**
     * Resolve one or more capabilities into a deduplicated list of API endpoint paths.
     * 
     * @param capabilities - Capability names (e.g., ["send-message", "read-messages"])
     * @returns Object with merged endpoints and metadata
     * @throws Error if a capability name is not found in the registry
     */
    resolve(capabilities: string[]): ResolvedCapabilities {
        const allEndpoints = new Set<string>();
        const resolvedCapabilities: Record<string, CapabilityDefinition> = {};
        let requiresAuth = false;

        for (const cap of capabilities) {
            const definition = this.registry[cap];
            if (!definition) {
                const available = this.listCapabilities().map((c) => c.name);
                throw new Error(
                    `Unknown capability: "${cap}". Available capabilities: ${available.join(", ")}`
                );
            }

            resolvedCapabilities[cap] = definition;

            for (const endpoint of definition.endpoints) {
                allEndpoints.add(endpoint);
            }

            if (definition.auth) {
                requiresAuth = true;
            }
        }

        return {
            endpoints: Array.from(allEndpoints),
            capabilities: resolvedCapabilities,
            requiresAuth,
        };
    }

    /**
     * List all available capabilities with their descriptions.
     */
    listCapabilities(): CapabilitySummary[] {
        return Object.entries(this.registry).map(([name, def]) => ({
            name,
            description: def.description,
            endpointCount: def.endpoints.length,
            requiresAuth: def.auth,
        }));
    }

    /**
     * Check if a capability exists in the registry.
     */
    hasCapability(name: string): boolean {
        return name in this.registry;
    }

    /**
     * Get the raw definition for a single capability.
     */
    getCapability(name: string): CapabilityDefinition | undefined {
        return this.registry[name];
    }
}

// ─── Result Types ─────────────────────────────────────────────────────

export interface ResolvedCapabilities {
    /** Deduplicated list of API endpoint paths */
    endpoints: string[];
    /** The resolved capability definitions */
    capabilities: Record<string, CapabilityDefinition>;
    /** Whether any of the capabilities require authentication */
    requiresAuth: boolean;
}

export interface CapabilitySummary {
    name: string;
    description: string;
    endpointCount: number;
    requiresAuth: boolean;
}
