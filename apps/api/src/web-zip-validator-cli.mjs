import { validateWebZip } from './web-zip-validator.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'VALIDATOR_ARGUMENTS', message: 'Input and output paths are required.' } }));
  process.exitCode = 2;
} else {
  try {
    process.stdout.write(JSON.stringify({ ok: true, report: await validateWebZip(input, output) }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: error.code ?? 'PACKAGE_INVALID', message: error.message } }));
    process.exitCode = 1;
  }
}
