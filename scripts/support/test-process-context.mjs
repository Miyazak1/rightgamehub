import { before } from 'node:test';
import { frozenRejectionContracts } from './frozen-test-inventory.mjs';

const filename = process.argv[1]?.replaceAll('\\', '/');
if (frozenRejectionContracts.some(contract => filename?.endsWith('/' + contract.verifier))) {
  // Register after node:test initializes its own IPC reporter. A nested --test
  // process must create a fresh runner rather than inherit the parent's child
  // marker (which otherwise makes a failing subprocess exit successfully).
  before(() => { delete process.env.NODE_TEST_CONTEXT; });
}
