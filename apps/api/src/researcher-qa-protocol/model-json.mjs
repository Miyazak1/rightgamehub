// Accept a complete JSON document, optionally wrapped in one standard Markdown fence.
// Do not extract substrings, execute content, or repair malformed JSON.
export function parseModelJson(content       )         {
 const trimmed=content.trim();const fence=/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
 return JSON.parse(fence?fence[1]:trimmed);
}

export function parseWholeJson(text       )     {
 const value=JSON.parse(text),frames                                                  =[];
 for(const token of text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)??[]){
  if(token==='{')frames.push({object:true,key:true,seen:new Set()});else if(token==='[')frames.push({object:false});else if(token==='}'||token===']')frames.pop();else if(token===','){if(frames.at(-1)?.object)frames.at(-1) .key=true;}else if(token===':'){if(frames.at(-1)?.object)frames.at(-1) .key=false;}else if(token.startsWith('"')&&frames.at(-1)?.object&&frames.at(-1) .key){const frame=frames.at(-1) ,key=JSON.parse(token);if(frame.seen .has(key))throw Error('DUPLICATE_KEY');frame.seen .add(key);frame.key=false;}
 }
 return value;
}
