const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = file => pathToFileURL(path.join(root, 'apps/api/src', file));

function pe({ machine = 0x8664, subsystem = 2, dll = false } = {}) {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ', 0, 'ascii');
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.writeUInt32LE(0x4550, 0x80);
  bytes.writeUInt16LE(machine, 0x84);
  bytes.writeUInt16LE(0xf0, 0x94);
  bytes.writeUInt16LE(0x0002 | (dll ? 0x2000 : 0), 0x96);
  bytes.writeUInt16LE(0x20b, 0x98);
  bytes.writeUInt16LE(subsystem, 0x80 + 92);
  return bytes;
}

test('Windows validator accepts only standalone x64 GUI executables', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gamehub-exe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { validateWindowsExecutable } = await import(moduleUrl('windows-exe-validator.mjs'));

  const valid = path.join(directory, 'game.exe');
  await writeFile(valid, pe());
  const report = await validateWindowsExecutable(valid, 'space-game.exe');
  assert.equal(report.entry, 'space-game.exe');
  assert.deepEqual(report.native, { os: 'windows', arch: 'x64', subsystem: 'windows', packageType: 'windows_standalone_exe' });
  assert.equal(report.totalBytes, 512);

  const x86 = path.join(directory, 'x86.exe');
  await writeFile(x86, pe({ machine: 0x14c }));
  await assert.rejects(() => validateWindowsExecutable(x86, 'x86.exe'), error => error.code === 'EXE_ARCH_UNSUPPORTED');

  const consoleExe = path.join(directory, 'console.exe');
  await writeFile(consoleExe, pe({ subsystem: 3 }));
  await assert.rejects(() => validateWindowsExecutable(consoleExe, 'console.exe'), error => error.code === 'EXE_TYPE_UNSUPPORTED');
});
