import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validatePaperLayoutEnginePlanV1,
} from '../../../packages/agent-capabilities/src/paper-layout-engine.mjs';
import { fail } from './errors.mjs';
import { verifyInstalledCapabilityComponentBundle } from './component-bundle.mjs';

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function createPaperLayoutEngineRuntime({ componentManager } = {}) {
  if (!componentManager || typeof componentManager.ensure !== 'function') {
    fail('PAPER_LAYOUT_ENGINE_RUNTIME_CONFIG_INVALID');
  }

  const materialize = async ({ catalog, plan: planValue, signal } = {}) => {
    const plan = validatePaperLayoutEnginePlanV1(planValue), componentBindings = [];
    for (const component of plan.components) {
      const installed = await componentManager.ensure({ catalog, component,
        engine: { name: plan.engine.name, version: plan.engine.version },
        languages: plan.languages, signal });
      if (!installed || !path.isAbsolute(installed.absolutePath)
        || Object.keys(component).some(key => installed.component?.[key] !== component[key])) {
        fail('PAPER_LAYOUT_ENGINE_COMPONENT_BINDING_INVALID');
      }
      if (installed.content?.kind === 'zip-bundle') {
        if (!path.isAbsolute(installed.archivePath ?? '')) {
          fail('PAPER_LAYOUT_ENGINE_COMPONENT_BINDING_INVALID');
        }
        let verified;
        try {
          verified = await verifyInstalledCapabilityComponentBundle({
            archivePath: installed.archivePath,
            bundleDirectory: path.dirname(installed.absolutePath), component,
            content: installed.content,
          });
        } catch { fail('PAPER_LAYOUT_ENGINE_COMPONENT_BINDING_INVALID'); }
        componentBindings.push({ ...component, format: 'zip-bundle',
          archivePath: installed.archivePath, localPath: verified.rootDirectory,
          content: verified.content, files: verified.files.map(file => ({
            path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes,
            executable: file.executable,
          })) });
      } else {
        const stats = await fs.promises.lstat(installed.absolutePath).catch(() => null);
        if (!stats?.isFile() || stats.isSymbolicLink() || stats.size !== component.sizeBytes
          || await sha256(installed.absolutePath) !== component.sha256) {
          fail('PAPER_LAYOUT_ENGINE_COMPONENT_BINDING_INVALID');
        }
        componentBindings.push({ ...component, localPath: installed.absolutePath });
      }
    }
    return { schemaVersion: 'paper-layout-engine-runtime-v1', plan,
      componentBindings };
  };

  return { materialize };
}
