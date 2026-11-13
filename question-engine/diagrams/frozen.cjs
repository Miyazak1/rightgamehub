'use strict';
// Host adaptation: fixed verified runtime only; no Lab server or alternate env path.
const path=require('node:path');
const base=require('../math-v143/install.cjs').runtimeDirectory;
module.exports={load:name=>require(path.join(base,name)),runtimeHash:'a409879ed5bf87bfec0ebd68f5b76646c56f594d5579a4bea4ef39878eba9988'};
