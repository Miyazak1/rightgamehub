import { open, stat } from 'node:fs/promises';

const invalid = (code, message) => Object.assign(new Error(message), { code });

export async function validateWindowsExecutable(input, fileName) {
  const info = await stat(input);
  if (!info.isFile() || info.size < 64 || info.size > 500 * 1024 ** 2) throw invalid('UPLOAD_TOO_LARGE', 'Windows EXE size is invalid.');
  const handle = await open(input, 'r');
  try {
    const dos = Buffer.alloc(64);
    if ((await handle.read(dos, 0, dos.length, 0)).bytesRead !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ') {
      throw invalid('EXE_FORMAT_INVALID', 'The file is not a Windows executable.');
    }
    const offset = dos.readUInt32LE(60);
    if (offset < 64 || offset > 1024 * 1024 || offset + 96 > info.size) throw invalid('EXE_FORMAT_INVALID', 'The PE header offset is invalid.');
    const pe = Buffer.alloc(96);
    if ((await handle.read(pe, 0, pe.length, offset)).bytesRead !== pe.length || pe.readUInt32LE(0) !== 0x4550) {
      throw invalid('EXE_FORMAT_INVALID', 'The PE signature is invalid.');
    }
    const machine = pe.readUInt16LE(4);
    const optionalSize = pe.readUInt16LE(20);
    const characteristics = pe.readUInt16LE(22);
    const magic = pe.readUInt16LE(24);
    const subsystem = pe.readUInt16LE(92);
    if (machine !== 0x8664) throw invalid('EXE_ARCH_UNSUPPORTED', 'The first release supports Windows x64 executables only.');
    if (!(characteristics & 2) || (characteristics & 0x2000)) throw invalid('EXE_TYPE_UNSUPPORTED', 'DLLs and non-executable PE files are not supported.');
    if (magic !== 0x20b || optionalSize < 112 || offset + 24 + optionalSize > info.size) throw invalid('EXE_FORMAT_INVALID', 'The PE32+ optional header is invalid.');
    if (subsystem !== 2) throw invalid('EXE_TYPE_UNSUPPORTED', 'Only graphical Windows executables are supported; console programs and drivers are rejected.');
    const safeName = String(fileName || 'game.exe').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 180);
    return {
      policyVersion: 1,
      entry: safeName.toLowerCase().endsWith('.exe') ? safeName : 'game.exe',
      approvedCapabilities: [],
      totalBytes: info.size,
      fileCount: 1,
      assets: {},
      native: { os: 'windows', arch: 'x64', subsystem: 'windows', packageType: 'windows_standalone_exe' },
    };
  } finally {
    await handle.close();
  }
}
