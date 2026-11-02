import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildDesktopIcons } from '../../scripts/build-desktop-icons.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sharp=createRequire(new URL('../../apps/api/package.json',import.meta.url))('sharp');

test('desktop icons reuse the website logo at every Windows size, with valid ICO frame offsets and transparency',async t=>{
  const base=path.join(root,'.runtime/desktop-icon-tests');await fs.mkdir(base,{recursive:true});
  const output=await fs.mkdtemp(path.join(base,'icons-'));t.after(()=>fs.rm(output,{recursive:true,force:true}));
  const result=await buildDesktopIcons(root,output),ico=await fs.readFile(result.ico);
  assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  let offset=6+7*16;
  for(const [i,size] of result.sizes.entries()){
    const start=6+i*16,length=ico.readUInt32LE(start+8);
    assert.equal(ico[start]||256,size);assert.equal(ico[start+1]||256,size);
    assert.equal(ico.readUInt32LE(start+12),offset);
    const frame=ico.subarray(offset,offset+length),png=await fs.readFile(path.join(output,'desktop-icons',`mooyu-${size}.png`));
    assert.deepEqual(frame,png);const meta=await sharp(frame).metadata();assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.hasAlpha,true);
    const expected=await sharp(path.join(root,'apps/web/public/favicon.svg'),{density:768}).resize(size,size).raw().toBuffer();
    assert.deepEqual(await sharp(frame).raw().toBuffer(),expected);offset+=length;
  }
  assert.equal(offset,ico.length);
});
