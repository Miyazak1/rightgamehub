import {
  AGENT_CAPABILITY_REGISTRY_REVISION,
  findAgentCapability,
  officialToolCapabilities,
  toOfficialToolDiscoveryMetadata,
} from '@gamehub/agent-capabilities';

const SUPPORTED_KINDS = Object.freeze(['game', 'official-tool', 'courseware', 'collection']);
const WORK_KINDS = new Set(['game', 'courseware']);
const DEFAULT_LIMIT = 6;
const MAX_CATALOG_CANDIDATES = 50;
const BUILT_IN_GAME_ID = 'gamehub-guess-baike';
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const HTML_TAG = /<[^>]*>/gu;

export class AgentCapabilityError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'AgentCapabilityError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = false;
  }
}

const cleanText = (value, max) => String(value ?? '')
  .replace(CONTROL_CHARACTERS, '')
  .replace(HTML_TAG, ' ')
  .replace(/\s+/gu, ' ')
  .trim()
  .slice(0, max);

const cleanTags = value => [...new Set((Array.isArray(value) ? value : [])
  .map(tag => cleanText(tag, 40).toLowerCase())
  .filter(Boolean))].slice(0, 12);

const publicUrl = (origin, path) => new URL(path, origin).href;
const workRoute = workId => `/works/${encodeURIComponent(workId)}`;
const workUrl = (origin, workId) => publicUrl(origin, `/w/${encodeURIComponent(workId)}`);
const collectionRoute = slug => `/discover/c/${encodeURIComponent(slug)}`;

const publicTrustTier = work => {
  if (work.id === BUILT_IN_GAME_ID) return 'official-content';
  return work.claimStatus === 'verified' ? 'verified-publisher' : 'community-content';
};

const asWorkSummary = (work, origin) => ({
  id: `${work.kind}:${work.id}`,
  kind: work.kind,
  title: cleanText(work.title, 120) || 'Untitled public work',
  description: cleanText(work.description, 500),
  status: 'available',
  trustTier: publicTrustTier(work),
  estimatedMinutes: Number.isFinite(Number(work.estimatedMinutes)) ? Math.max(0, Number(work.estimatedMinutes)) : null,
  tags: cleanTags(work.tags),
  requiresUi: true,
  requiresAuth: false,
  launchable: true,
  url: workUrl(origin, work.id),
});

const asOfficialSummary = (capability, locale, origin) => {
  const publicCapability = toOfficialToolDiscoveryMetadata(capability, locale);
  return {
    id: publicCapability.id,
    kind: publicCapability.kind,
    title: publicCapability.title,
    description: publicCapability.description,
    status: publicCapability.status,
    trustTier: publicCapability.trustTier,
    estimatedMinutes: null,
    tags: publicCapability.tags,
    requiresUi: true,
    requiresAuth: false,
    launchable: true,
    url: publicUrl(origin, publicCapability.route),
  };
};

const asCollectionSummary = (campaign, origin) => ({
  id: `collection:${campaign.slug}`,
  kind: 'collection',
  title: cleanText(campaign.title, 120) || 'Untitled collection',
  description: cleanText(campaign.summary, 500),
  status: 'available',
  trustTier: 'official-content',
  estimatedMinutes: null,
  tags: cleanTags([campaign.eyebrow, campaign.campaignKind]),
  requiresUi: true,
  requiresAuth: false,
  launchable: true,
  url: publicUrl(origin, collectionRoute(campaign.slug)),
});

const detail = (summary, values) => ({
  ...summary,
  version: values.version,
  operations: ['launch'],
  dedicatedTool: values.dedicatedTool ?? null,
  launch: {
    defaultMode: 'auto',
    modes: values.modes,
    route: values.route,
    url: summary.url,
    interaction: values.interaction,
  },
  dataHandling: values.dataHandling,
  metadata: values.metadata,
});

const asWorkDetail = (work, origin) => {
  const summary = asWorkSummary(work, origin);
  return detail(summary, {
    version: cleanText(work.revision, 32) || '1',
    modes: ['auto', 'canvas', 'web'],
    route: workRoute(work.id),
    interaction: { required: true, reason: work.kind === 'courseware' ? 'learn-in-ui' : 'play-in-ui' },
    dataHandling: {
      authentication: 'none',
      confirmation: 'none',
      retention: 'runtime-defined',
      localFirst: false,
      agentContext: 'none',
    },
    metadata: {
      source: 'public-catalog',
      creator: cleanText(work.creatorDisplayName, 120) || '墨鱼工坊',
      openSource: Boolean(work.openSource),
      itemCount: null,
    },
  });
};

const asOfficialDetail = (capability, locale, origin) => {
  const publicCapability = toOfficialToolDiscoveryMetadata(capability, locale);
  const summary = asOfficialSummary(capability, locale, origin);
  return detail(summary, {
    version: publicCapability.version,
    dedicatedTool: capability.mcp.toolName,
    modes: ['auto', ...publicCapability.layouts, 'web'],
    route: publicCapability.route,
    interaction: {
      required: true,
      reason: capability.toolId === 'change-radar'
        ? 'review-and-confirm-in-ui'
        : ['pdf-reader', 'privacy-redactor', 'document-compare', 'spreadsheet-audit'].includes(capability.toolId)
          ? 'select-private-content-in-ui'
          : 'continue-in-ui',
    },
    dataHandling: {
      authentication: 'none',
      confirmation: publicCapability.operation.confirmation,
      retention: publicCapability.dataPolicy.retention,
      localFirst: publicCapability.dataPolicy.localFirst,
      agentContext: publicCapability.dataPolicy.agentContext,
    },
    metadata: {
      source: 'official-registry',
      creator: '墨鱼工坊',
      openSource: null,
      itemCount: null,
    },
  });
};

const asCollectionDetail = (campaign, origin) => {
  const summary = asCollectionSummary(campaign, origin);
  return detail(summary, {
    version: String(Number(campaign.version) || 1),
    modes: ['auto', 'canvas', 'web'],
    route: collectionRoute(campaign.slug),
    interaction: { required: true, reason: 'browse-in-ui' },
    dataHandling: {
      authentication: 'none',
      confirmation: 'none',
      retention: 'none',
      localFirst: false,
      agentContext: 'none',
    },
    metadata: {
      source: 'published-collection',
      creator: '墨鱼工坊',
      openSource: null,
      itemCount: Array.isArray(campaign.items) ? campaign.items.length : 0,
    },
  });
};

const asLegacyGame = (work, origin) => {
  const summary = asWorkSummary(work, origin);
  return {
    id: work.id,
    title: summary.title,
    description: summary.description,
    kind: work.kind,
    estimatedMinutes: summary.estimatedMinutes ?? 0,
    tags: summary.tags,
    creator: cleanText(work.creatorDisplayName, 120) || '墨鱼工坊',
    openSource: Boolean(work.openSource),
    playUrl: summary.url,
  };
};

const normalize = value => cleanText(value, 500).toLocaleLowerCase('en-US');
const searchableText = capability => normalize([
  capability.title,
  capability.description,
  ...(capability.tags ?? []),
  ...(capability.intents ?? []),
  ...(capability.aliases ?? []),
].join(' '));

const queryScore = (capability, query) => {
  const needle = normalize(query);
  if (!needle) return 1;
  const title = normalize(capability.title);
  const tags = (capability.tags ?? []).map(normalize);
  const text = searchableText(capability);
  if (title === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (title.includes(needle)) return 60;
  if (tags.some(tag => tag === needle)) return 50;
  if (tags.some(tag => tag.includes(needle))) return 40;
  return text.includes(needle) ? 20 : 0;
};

const matchesFilters = (capability, { query, tags, maxEstimatedMinutes }) => {
  if (queryScore(capability, query) === 0) return false;
  const requestedTags = (tags ?? []).map(normalize);
  const candidateTags = (capability.tags ?? []).map(normalize);
  if (requestedTags.length && !requestedTags.every(tag => candidateTags.includes(tag))) return false;
  if (maxEstimatedMinutes != null && capability.estimatedMinutes != null && capability.estimatedMinutes > maxEstimatedMinutes) return false;
  return true;
};

const sortMatches = (items, query) => items.sort((left, right) =>
  queryScore(right, query) - queryScore(left, query)
  || left.title.localeCompare(right.title, 'zh-CN')
  || left.id.localeCompare(right.id));

const interleave = (groups, limit) => {
  const output = [];
  for (let index = 0; output.length < limit; index += 1) {
    let added = false;
    for (const group of groups) {
      if (group[index]) { output.push(group[index]); added = true; }
      if (output.length === limit) break;
    }
    if (!added) break;
  }
  return output;
};

const parseCapabilityId = capabilityId => {
  const value = String(capabilityId ?? '').trim();
  const separator = value.indexOf(':');
  if (separator < 1 || separator === value.length - 1 || value.length > 180) {
    throw new AgentCapabilityError('CAPABILITY_ID_INVALID', 400, 'Capability ID is invalid.');
  }
  return { kind: value.slice(0, separator), resourceId: value.slice(separator + 1), value };
};

export function createAgentCapabilityService({ catalogService, discoveryCampaignService = null, siteOrigin = 'https://mooyu.fun' }) {
  const origin = new URL(siteOrigin).origin;
  const availableKinds = discoveryCampaignService?.listPublic && discoveryCampaignService?.getPublic
    ? SUPPORTED_KINDS
    : Object.freeze(SUPPORTED_KINDS.filter(kind => kind !== 'collection'));

  const getWork = async (kind, workId) => {
    let work;
    try { work = await catalogService.get(workId); } catch (error) {
      if (error?.statusCode === 404) throw new AgentCapabilityError('CAPABILITY_NOT_FOUND', 404, 'Capability is unavailable or was not found.');
      throw error;
    }
    if (!work || work.kind !== kind || !WORK_KINDS.has(work.kind)) {
      throw new AgentCapabilityError('CAPABILITY_NOT_FOUND', 404, 'Capability is unavailable or was not found.');
    }
    return work;
  };

  const getCapability = async ({ capabilityId, locale = 'zh-CN' }) => {
    const parsed = parseCapabilityId(capabilityId);
    if (parsed.kind === 'official-tool') {
      const capability = findAgentCapability(parsed.value);
      if (!capability) throw new AgentCapabilityError('CAPABILITY_NOT_FOUND', 404, 'Capability is unavailable or was not found.');
      return asOfficialDetail(capability, locale, origin);
    }
    if (WORK_KINDS.has(parsed.kind)) return asWorkDetail(await getWork(parsed.kind, parsed.resourceId), origin);
    if (parsed.kind === 'collection' && discoveryCampaignService?.getPublic) {
      try {
        return asCollectionDetail(await discoveryCampaignService.getPublic(parsed.resourceId), origin);
      } catch (error) {
        if (error?.statusCode === 404) throw new AgentCapabilityError('CAPABILITY_NOT_FOUND', 404, 'Capability is unavailable or was not found.');
        throw error;
      }
    }
    throw new AgentCapabilityError('CAPABILITY_NOT_FOUND', 404, 'Capability is unavailable or was not found.');
  };

  const searchCapabilities = async ({ query = '', kinds = SUPPORTED_KINDS, tags = [], maxEstimatedMinutes, locale = 'zh-CN', limit = DEFAULT_LIMIT } = {}) => {
    const requestedKinds = [...new Set(kinds)].filter(kind => availableKinds.includes(kind));
    const filters = { query, tags, maxEstimatedMinutes };
    const groupTasks = [];

    if (requestedKinds.includes('official-tool')) {
      const items = officialToolCapabilities.map(capability => {
        const localized = asOfficialSummary(capability, locale, origin);
        return {
          ...localized,
          intents: capability.discovery.intents,
          aliases: [...Object.values(capability.title), ...Object.values(capability.summary)],
        };
      }).filter(item => matchesFilters(item, filters)).map(({ intents: _intents, aliases: _aliases, ...item }) => item);
      groupTasks.push(Promise.resolve(sortMatches(items, query)));
    }

    for (const kind of requestedKinds.filter(candidate => WORK_KINDS.has(candidate))) {
      groupTasks.push(catalogService.list({ q: query, kind, runtime: 'web', limit: MAX_CATALOG_CANDIDATES }).then(works => {
        const items = works.filter(work => work?.kind === kind).map(work => asWorkSummary(work, origin)).filter(item => matchesFilters(item, filters));
        return sortMatches(items, query);
      }));
    }

    if (requestedKinds.includes('collection') && discoveryCampaignService?.listPublic) {
      groupTasks.push(discoveryCampaignService.listPublic({ limit: 12 }).then(campaigns => {
        const items = campaigns.map(campaign => asCollectionSummary(campaign, origin)).filter(item => matchesFilters(item, filters));
        return sortMatches(items, query);
      }));
    }

    const groups = await Promise.all(groupTasks);

    return {
      capabilities: interleave(groups, limit),
      registryRevision: AGENT_CAPABILITY_REGISTRY_REVISION,
      supportedKinds: availableKinds,
    };
  };

  const launchCapability = async ({ capabilityId, launchMode = 'auto', locale = 'zh-CN' }) => {
    const capability = await getCapability({ capabilityId, locale });
    const mode = capability.launch.modes.includes(launchMode) ? launchMode : 'auto';
    const status = mode === 'web' ? 'web_fallback' : capability.launch.interaction.required ? 'requires_user_interaction' : 'opened';
    const url = new URL('/mcp-app', origin);
    url.searchParams.set('gh_route', capability.launch.route);
    url.searchParams.set('gh_host', 'mcp-app');
    url.searchParams.set('lang', locale);
    return {
      status,
      capabilityId: capability.id,
      mode,
      route: capability.launch.route,
      url: mode === 'web' ? capability.url : url.href,
      message: mode === 'web'
        ? 'A stable public web fallback is available. Opening the link does not mean the activity has been completed.'
        : 'The capability was opened in MOOYU.FUN. This confirms navigation only, not completion of the activity.',
    };
  };

  const searchLegacyGames = async ({ query = '', limit = DEFAULT_LIMIT } = {}) => {
    const works = await catalogService.list({ q: query, kind: 'game', runtime: 'web', limit });
    return works.filter(work => work?.kind === 'game').map(work => asLegacyGame(work, origin));
  };

  const getLegacyGame = async workId => asLegacyGame(await getWork('game', workId), origin);

  return {
    supportedKinds: availableKinds,
    searchCapabilities,
    getCapability,
    launchCapability,
    searchLegacyGames,
    getLegacyGame,
  };
}
