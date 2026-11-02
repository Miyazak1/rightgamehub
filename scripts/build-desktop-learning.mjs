import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCoursewareInventory } from '../packages/creator-tools/src/courseware-toolkit.mjs';
import { generatedLearningItems } from '../packages/platform-client/src/generated-learning-items.mjs';

export async function buildDesktopLearning(root, output) {
  for (const item of generatedLearningItems) {
    if (!/^[a-z0-9-]+$/.test(item.template) || item.runtimeUrl !== `/learning/courseware/${item.template}/dist/index.html`)
      throw Error('DESKTOP_COURSEWARE_CATALOG_INVALID');
    const inventory = await loadCoursewareInventory(path.join(root, 'templates/courseware', item.template));
    if (inventory.manifest.id !== item.id) throw Error('DESKTOP_COURSEWARE_ID_MISMATCH');
    for (const file of inventory.files) {
      const destination = path.join(output, 'learning/courseware', item.template, file.relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.bytes);
    }
  }
  return generatedLearningItems.length;
}
