import path from 'node:path';
import process from 'node:process';
import { inspectKnowledgeMap } from '../packages/creator-tools/src/knowledge-map.mjs';

const file=path.resolve(process.argv[2]??'curricula/cn-upper-secondary/2017-2020/catalog.json');
const report=await inspectKnowledgeMap(file);
process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
if(!report.ok)process.exitCode=1;
