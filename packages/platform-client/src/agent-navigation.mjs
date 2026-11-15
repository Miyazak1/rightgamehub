export function validAgentNavigation(action) {
  return action?.kind==='navigate'&&typeof action.capabilityId==='string'&&action.capabilityId!=='official-tool:paper-study'
    &&action.route!=='/tools/paper-study'
    &&typeof action.route==='string'&&/^\/(?:(?:works|play)\/[A-Za-z0-9._~-]+|tools\/[a-z0-9-]+|apps\/change-radar|learn(?:\/[a-z0-9-]+)?|discover\/c\/[A-Za-z0-9._~-]+)$/.test(action.route);
}
