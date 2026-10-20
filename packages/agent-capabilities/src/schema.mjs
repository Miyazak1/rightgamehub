export const AGENT_CAPABILITY_FORMAT = 'mooyu.agent-capability';
export const AGENT_CAPABILITY_SCHEMA_VERSION = 1;

const IDENTIFIER = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SEMVER = /^\d+\.\d+\.\d+$/u;
const EFFECTS = new Set(['read', 'ui-open', 'local-ui-write']);
const DATA_RETENTION = new Set(['none', 'device-local']);
const LAYOUTS = new Set(['sidebar', 'canvas']);
const LOCALES = ['zh-CN', 'en'];

const fail = message => { throw new TypeError(`Invalid Agent capability: ${message}`); };
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (value, allowed, path) => {
  if (!isPlainObject(value)) fail(`${path} must be an object`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail(`${path} contains unknown field ${unknown[0]}`);
};

const assertString = (value, path, { max = 500, pattern } = {}) => {
  if (typeof value !== 'string' || !value.length || value.length > max) fail(`${path} must be a non-empty string no longer than ${max}`);
  if (pattern && !pattern.test(value)) fail(`${path} has an invalid format`);
};

const assertUniqueStrings = (value, path, { maxItems = 64, maxLength = 120 } = {}) => {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || !item.length || item.length > maxLength)) fail(`${path} must be a bounded string array`);
  if (new Set(value).size !== value.length) fail(`${path} must not contain duplicates`);
};

const assertLocalizedText = (value, path, max) => {
  assertExactKeys(value, LOCALES, path);
  for (const locale of LOCALES) assertString(value[locale], `${path}.${locale}`, { max });
};

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export function defineOfficialToolCapability(value) {
  assertExactKeys(value, [
    'format', 'schemaVersion', 'id', 'version', 'kind', 'trustTier', 'status', 'toolId',
    'title', 'summary', 'discovery', 'titleKey', 'descriptionKey', 'mark', 'runtime', 'launch', 'capabilities', 'operation',
    'mcp', 'dataPolicy',
  ], 'capability');
  if (value.format !== AGENT_CAPABILITY_FORMAT) fail('format is unsupported');
  if (value.schemaVersion !== AGENT_CAPABILITY_SCHEMA_VERSION) fail('schemaVersion is unsupported');
  assertString(value.toolId, 'toolId', { max: 80, pattern: IDENTIFIER });
  if (value.id !== `official-tool:${value.toolId}`) fail('id must use the official-tool namespace and match toolId');
  assertString(value.version, 'version', { max: 32, pattern: SEMVER });
  if (value.kind !== 'official-tool') fail('kind must be official-tool');
  if (value.trustTier !== 'official-tool') fail('trustTier must be official-tool');
  if (value.status !== 'available') fail('status must be available');
  assertLocalizedText(value.title, 'title', 120);
  assertLocalizedText(value.summary, 'summary', 500);
  assertExactKeys(value.discovery, ['tags', 'intents'], 'discovery');
  assertUniqueStrings(value.discovery.tags, 'discovery.tags', { maxItems: 16 });
  assertUniqueStrings(value.discovery.intents, 'discovery.intents', { maxItems: 16 });
  assertString(value.titleKey, 'titleKey', { max: 120 });
  assertString(value.descriptionKey, 'descriptionKey', { max: 120 });
  assertString(value.mark, 'mark', { max: 8 });
  if (value.runtime !== 'trusted-react') fail('runtime must be trusted-react');

  assertExactKeys(value.launch, ['adapter', 'route', 'layouts', 'webFallback'], 'launch');
  if (value.launch.adapter !== 'hosted-ui') fail('launch.adapter must be hosted-ui');
  assertString(value.launch.route, 'launch.route', { max: 200 });
  if (!value.launch.route.startsWith(`/tools/${value.toolId}`)) fail('launch.route must match toolId');
  assertUniqueStrings(value.launch.layouts, 'launch.layouts', { maxItems: 2 });
  if (value.launch.layouts.some(layout => !LAYOUTS.has(layout))) fail('launch.layouts contains an unsupported layout');
  if (value.launch.webFallback !== true) fail('launch.webFallback must be true');

  assertUniqueStrings(value.capabilities, 'capabilities');
  assertExactKeys(value.operation, ['effect', 'confirmation'], 'operation');
  if (!EFFECTS.has(value.operation.effect)) fail('operation.effect is unsupported');
  if (value.operation.confirmation !== 'none') fail('operation.confirmation is unsupported in the anonymous registry');

  assertExactKeys(value.mcp, ['toolName', 'title', 'description', 'annotations', 'invoking', 'invoked'], 'mcp');
  assertString(value.mcp.toolName, 'mcp.toolName', { max: 80, pattern: /^[a-z][a-z0-9_]*$/u });
  assertString(value.mcp.title, 'mcp.title', { max: 120 });
  assertString(value.mcp.description, 'mcp.description', { max: 1200 });
  assertString(value.mcp.invoking, 'mcp.invoking', { max: 120 });
  assertString(value.mcp.invoked, 'mcp.invoked', { max: 120 });
  assertExactKeys(value.mcp.annotations, ['readOnlyHint', 'destructiveHint', 'openWorldHint'], 'mcp.annotations');
  for (const key of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
    if (typeof value.mcp.annotations[key] !== 'boolean') fail(`mcp.annotations.${key} must be boolean`);
  }
  if (value.mcp.annotations.destructiveHint) fail('anonymous official tools cannot be destructive');
  if (value.mcp.annotations.openWorldHint) fail('current official tools cannot be open-world operations');

  assertExactKeys(value.dataPolicy, ['localFirst', 'retention', 'prohibitedToolInputs', 'agentContext'], 'dataPolicy');
  if (typeof value.dataPolicy.localFirst !== 'boolean') fail('dataPolicy.localFirst must be boolean');
  if (!DATA_RETENTION.has(value.dataPolicy.retention)) fail('dataPolicy.retention is unsupported');
  assertUniqueStrings(value.dataPolicy.prohibitedToolInputs, 'dataPolicy.prohibitedToolInputs', { maxItems: 8 });
  if (!['none', 'bounded-disclosed'].includes(value.dataPolicy.agentContext)) fail('dataPolicy.agentContext is unsupported');

  return deepFreeze(value);
}
