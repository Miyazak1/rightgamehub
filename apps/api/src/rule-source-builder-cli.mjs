import { buildRuleSourceBundle } from './rule-source-builder.mjs';
const [inputPath,outputPath,planJson]=process.argv.slice(2);
try {
  if (!inputPath||!outputPath||!planJson) throw Object.assign(new Error('Rule Builder requires input, output and plan.'),{ code:'RULE_BUILDER_ARGUMENT_INVALID' });
  const report=await buildRuleSourceBundle({ inputPath,outputPath,plan:JSON.parse(planJson) });
  process.stdout.write(`${JSON.stringify({ ok:true,report })}\n`);
} catch(error) {
  process.stdout.write(`${JSON.stringify({ ok:false,error:{ code:error.code ?? 'RULE_BUILD_FAILED',message:error.message } })}\n`); process.exitCode=1;
}
