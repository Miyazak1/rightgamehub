// Recover backslashes only in a sole text reply. Tool arguments always require
// normal JSON decoding and remain subject to the server's strict tool schemas.
export function parseAssistantOutput(value) {
  const source = String(value).trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, '$1');
  const reply = /^\{\s*"reply"\s*:\s*"([\s\S]*)"\s*\}$/u.exec(source);
  if (reply) {
    let escaped = '';
    const body = reply[1];
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== '\\') { escaped += body[i]; continue; }
      const next = body[i + 1];
      if (next === '\\' || next === '"' || next === '/') {
        escaped += body.slice(i, i + 2); i++; continue;
      }
      const command = /^[A-Za-z]+/u.exec(body.slice(i + 1))?.[0];
      const latex = /^(?:begin|beta|bar|boxed|binom|frac|forall|right|rho|rightarrow|text|times|theta|tan|to|triangle|nabla|neq|nu|notin|newline)$/u.test(command || '');
      const validEscape = !latex && (['b','f','n','r','t'].includes(next)
        || next === 'u' && /^[0-9a-fA-F]{4}/u.test(body.slice(i + 2)));
      escaped += validEscape ? '\\' : '\\\\';
    }
    try {
      const output = JSON.parse('{"reply":"' + escaped + '"}');
      if (Object.keys(output).length === 1) return output;
    } catch { /* A malformed envelope or unescaped quote needs model repair. */ }
  }
  return JSON.parse(source);
}
