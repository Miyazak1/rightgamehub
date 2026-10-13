const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const sharp=require('../../apps/api/node_modules/sharp');

const rendererUrl=pathToFileURL(path.resolve(__dirname,'../../apps/api/src/growth-content-renderer.mjs'));

test('growth content renderer creates five safe 3:4 PNG slides',async()=>{
  const {growthContentSlides,renderWorkXhsSlide}=await import(rendererUrl);
  const cover=await sharp({create:{width:960,height:540,channels:3,background:'#173f5f'}}).png().toBuffer();
  const work={id:'safe-work',title:'像素 <星球> & 好友',kind:'game',description:'打开即玩，保留作者与来源。',instructions:'点击开始。使用方向键移动。完成目标即可过关。',creatorDisplayName:'作者 "甲"',openSource:true,repositoryUrl:'https://github.com/example/game',licenseSpdx:'MIT',estimatedMinutes:5,tags:['像素','益智'],targets:[{targetKey:'web'}]};
  assert.deepEqual(growthContentSlides,['cover','overview','play','source','cta']);
  for(const slide of growthContentSlides){
    const body=await renderWorkXhsSlide(work,cover,slide);
    const metadata=await sharp(body).metadata();
    assert.deepEqual({width:metadata.width,height:metadata.height,format:metadata.format},{width:1080,height:1440,format:'png'});
  }
  await assert.rejects(()=>renderWorkXhsSlide(work,cover,'invalid'),/Unknown growth content slide/u);
});

test('growth content renderer uses the current public brand',async()=>{
  const source=await fs.readFile(path.resolve(__dirname,'../../apps/api/src/growth-content-renderer.mjs'),'utf8');
  assert.match(source,/MOOYU\.FUN/u);
  assert.match(source,/墨鱼工坊/u);
  assert.doesNotMatch(source,/>GAME<.*HUB</u);
});
