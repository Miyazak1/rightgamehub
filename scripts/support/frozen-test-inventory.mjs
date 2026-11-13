// These immutable historical contracts deliberately fail. Their successor tests
// execute the originals and require the exact rejection, not a repaired baseline.
export const frozenRejectionContracts = Object.freeze([
  Object.freeze({
    original: 'tests/platform/paper-responses-freeze.test.mjs',
    verifier: 'tests/platform/paper-responses-runtime-freeze.test.mjs',
    baseline: 'v18',
  }),
  Object.freeze({
    original: 'tests/platform/paper-duty-kernel-acceptance-freeze.test.mjs',
    verifier: 'tests/platform/paper-duty-kernel-acceptance-freeze-v26.test.mjs',
    baseline: 'v25',
  }),
]);

export function buildTestInventory(files) {
  const selected = new Set(files.map(file => file.replaceAll('\\', '/')));
  const rejectedBaselines = frozenRejectionContracts.filter(contract => selected.has(contract.original));
  for (const contract of rejectedBaselines) {
    if (!selected.has(contract.verifier)) {
      throw new Error(`Frozen ${contract.baseline} rejection requires ${contract.verifier}`);
    }
    selected.delete(contract.original);
  }
  return { files: [...selected].sort(), rejectedBaselines };
}
