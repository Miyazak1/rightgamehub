import { PAPER_LAYOUT_CONTRACT } from '../../../packages/agent-capabilities/src/paper-layout.mjs';
import { validatePaperLayoutEnginePlanV1 } from '../../../packages/agent-capabilities/src/paper-layout-engine.mjs';
import { fail } from './errors.mjs';

const PLAN_STAGE_KEY = 'paper-layout-engine-plan';
const exactContract = value => value?.key === PAPER_LAYOUT_CONTRACT.key
  && value?.version === PAPER_LAYOUT_CONTRACT.version;

export function createPaperLayoutComponentResolver({ engineRuntime, catalogProvider } = {}) {
  if (!engineRuntime || typeof engineRuntime.materialize !== 'function'
    || !catalogProvider || typeof catalogProvider.getCatalog !== 'function') {
    fail('PAPER_LAYOUT_COMPONENT_RESOLVER_CONFIG_INVALID');
  }

  const resolve = async ({ contract, prerequisites, signal } = {}) => {
    if (!exactContract(contract)) return [];
    if (!Array.isArray(prerequisites)) {
      fail('PAPER_LAYOUT_ENGINE_PREREQUISITE_INVALID', { safeFailure: true });
    }
    const matches = prerequisites.filter(item => item?.stageKey === PLAN_STAGE_KEY
      && item?.status === 'succeeded');
    if (matches.length !== 1) {
      fail('PAPER_LAYOUT_ENGINE_PREREQUISITE_INVALID', { safeFailure: true });
    }
    let plan;
    try { plan = validatePaperLayoutEnginePlanV1(matches[0].outputRef); }
    catch (error) {
      fail('PAPER_LAYOUT_ENGINE_PREREQUISITE_INVALID', { safeFailure: true, cause: error });
    }
    const catalog = await catalogProvider.getCatalog({
      engine: structuredClone(plan.engine),
      components: structuredClone(plan.components),
      signal,
    });
    const materialized = await engineRuntime.materialize({ catalog, plan, signal });
    if (materialized?.schemaVersion !== 'paper-layout-engine-runtime-v1'
      || !Array.isArray(materialized.componentBindings)) {
      fail('PAPER_LAYOUT_ENGINE_MATERIALIZATION_INVALID', { safeFailure: true });
    }
    return structuredClone(materialized.componentBindings);
  };

  return { resolve };
}

export const PAPER_LAYOUT_ENGINE_PLAN_STAGE_KEY = PLAN_STAGE_KEY;
