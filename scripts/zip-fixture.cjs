// Minimal ZIP writer for self-owned test/demo fixtures only, not an upload parser.
const { crc32, deflateRawSync } = require('node:zlib');
exports.makeZip = entries => {
  const files = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const filename = Buffer.from(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const method = entry.method ?? 8;
    const packed = method === 8 ? deflateRawSync(data) : data;
    const crc = entry.crc ?? crc32(data);
    const flags = entry.flags ?? 0x800;
    const size = entry.size ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(filename.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(flags, 8); header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(packed.length, 20); header.writeUInt32LE(size, 24); header.writeUInt16LE(filename.length, 28);
    header.writeUInt32LE(((entry.mode ?? (entry.name.endsWith('/') ? 0x41ed : 0x81a4)) << 16) >>> 0, 38); header.writeUInt32LE(offset, 42);
    files.push(local, filename, packed); central.push(header, filename); offset += local.length + filename.length + packed.length;
  }
  const table = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, table, end]);
};
