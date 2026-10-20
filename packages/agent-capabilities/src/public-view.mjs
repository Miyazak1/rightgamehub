export const toOfficialToolClientMetadata = capability => Object.freeze({
  id: capability.toolId,
  route: capability.launch.route,
  titleKey: capability.titleKey,
  descriptionKey: capability.descriptionKey,
  mark: capability.mark,
  status: capability.status,
  runtime: capability.runtime,
  layouts: capability.launch.layouts,
  capabilities: capability.capabilities,
});

export const toOfficialToolMcpMetadata = capability => Object.freeze({
  toolName: capability.mcp.toolName,
  title: capability.mcp.title,
  description: capability.mcp.description,
  annotations: capability.mcp.annotations,
  invoking: capability.mcp.invoking,
  invoked: capability.mcp.invoked,
  route: capability.launch.route,
});

export const toOfficialToolDiscoveryMetadata = (capability, locale = 'zh-CN') => {
  const resolvedLocale = locale === 'en' ? 'en' : 'zh-CN';
  return Object.freeze({
    id: capability.id,
    kind: capability.kind,
    title: capability.title[resolvedLocale],
    description: capability.summary[resolvedLocale],
    status: capability.status,
    trustTier: capability.trustTier,
    tags: capability.discovery.tags,
    intents: capability.discovery.intents,
    route: capability.launch.route,
    layouts: capability.launch.layouts,
    version: capability.version,
    operation: capability.operation,
    dataPolicy: capability.dataPolicy,
  });
};
