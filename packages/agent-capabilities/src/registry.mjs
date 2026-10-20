import { officialToolCapabilities } from './manifests/official-tools.mjs';

export const AGENT_CAPABILITY_REGISTRY_REVISION = 'official-tools-v1';
export const agentCapabilities = officialToolCapabilities;

const byId = new Map();
const byToolId = new Map();
const byMcpToolName = new Map();
const byRoute = new Map();

for (const capability of agentCapabilities) {
  const entries = [
    [byId, capability.id, 'capability id'],
    [byToolId, capability.toolId, 'official tool id'],
    [byMcpToolName, capability.mcp.toolName, 'MCP tool name'],
    [byRoute, capability.launch.route, 'launch route'],
  ];
  for (const [map, key, label] of entries) {
    if (map.has(key)) throw new TypeError(`Duplicate ${label}: ${key}`);
    map.set(key, capability);
  }
}

export const findAgentCapability = id => byId.get(id) ?? null;
export const findOfficialToolCapability = toolId => byToolId.get(toolId) ?? null;
export const findCapabilityByMcpToolName = toolName => byMcpToolName.get(toolName) ?? null;
export const findCapabilityByRoute = route => byRoute.get(route) ?? null;

export function requireOfficialToolCapability(toolId) {
  const capability = findOfficialToolCapability(toolId);
  if (!capability) throw new TypeError(`Unknown official tool capability: ${toolId}`);
  return capability;
}

export const getAgentCapabilityRegistrySnapshot = () => Object.freeze({
  revision: AGENT_CAPABILITY_REGISTRY_REVISION,
  schemaVersion: 1,
  capabilities: agentCapabilities,
});
