'use strict';
const path = require('node:path');
const { runtimeDirectory } = require('./install.cjs');
// This worker has no host credentials and never imports the Lab store or server.
globalThis.fetch = async () => { throw Error('math_lab_preview_network_forbidden'); };
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  transport.request = transport.get = () => { throw Error('math_lab_preview_network_forbidden'); };
}
const load = file => require(path.join(runtimeDirectory, 'src', file));

async function preview(input) {
  const { batchConfig, catalog } = load('config.cjs');
  const cell = catalog.find(item => item.id === input.cellId);
  if (!cell || !cell.scopes.some(scope => scope.id === input.scopeId)) throw Error('math_lab_scope_invalid');
  // Always use the frozen version's defaults, including admission and runtime binding.
  const config = batchConfig({ cells: [cell.id], scopes: { [cell.id]: [input.scopeId] }, count: 1, seed: input.seed }, 1);
  const task = { ...config, cellId: cell.id, scopeId: input.scopeId, seed: input.seed };
  const generated = await load('production-entry.cjs').run(task);
  const result = load('admission-boundary.cjs').beforeStore({
    cell_id: cell.id, scope_id: input.scopeId, seed: input.seed, config
  }, generated);
  if (result.providerCalls !== 0 || result.costUsd !== 0) throw Error('math_lab_preview_provider_violation');
  if (result.passed) {
    load('question-artifact.cjs').verify(result.candidate, input.scopeId, result.questionArtifact, result.generationSource);
    load('admission-contract.cjs').verify(result, input.scopeId);
  }
  const candidate = result.candidate;
  // Mooyu host presentation: keep phase-bound figures inside the verified worker.
  const figures = {};
  if (result.passed && result.admission?.status === 'eligible_before_history') {
    const present = require('../diagrams/adapter.cjs').prepareLocalFigure({ cell_id: cell.id, scope_id: input.scopeId, seed: input.seed, config }, result);
    for (const phase of ['question', 'review']) {
      figures[phase] = {};
      for (const language of ['zh', 'en']) {
        const shown = present(phase, language);
        if (shown.state === 'ready') figures[phase][language] = shown.display;
      }
    }
  }
  // Explicit student-facing projection: never spread a candidate, artifact or source into it.
  const presentation = result.passed === true && result.admission?.status === 'eligible_before_history' && candidate ? {
    prompt: candidate.prompt,
    options: candidate.options.map(({ id, text }) => ({ id, text })),
    localizations: Object.fromEntries(['zh', 'en'].filter(language => candidate.localizations?.[language]).map(language => {
      const localized = candidate.localizations[language];
      return [language, { prompt: localized.prompt, options: localized.options.map(({ id, text }) => ({ id, text })) }];
    }))
  } : null;
  return {
    schemaVersion: 'verified-math-generation-v1', applicationVersion: '1.43.0',
    mode: 'verified_generation_before_host_publication',
    task: { cellId: input.cellId, scopeId: input.scopeId, seed: input.seed,
      samplingVersion: config.samplingVersion, constructionVersion: config.constructionVersion,
      generationRevision: config.generationRevision,
      admissionVersion: config.admissionVersion, runtimeBundleHash: config.admissionRuntimeHash },
    providerCalls: 0, costUsd: 0, databaseReads: 0, databaseWrites: 0,
    studentPublicationAllowed: false, productionQualificationAllowed: false,
    presentation, figures, result
  };
}

process.once('message', async input => {
  try { process.send({ ok: true, value: await preview(input) }); }
  catch (error) { process.send({ ok: false, error: error.message }); }
  finally { process.disconnect(); }
});
