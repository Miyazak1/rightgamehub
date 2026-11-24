// Compare declared runtime semantics, not Docker's generated attachment flags
// or the ordering of equivalent bind strings. Core captureRole additionally
// checks every environment, mount, network and entrypoint/command field.
const fail=k=>{throw Error('RUNTIME_MODEL_MISMATCH_'+k);};
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const same=(a,b)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
const bytes=v=>{if(v==null)return 0;if(typeof v==='number')return v;const m=String(v).match(/^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/iu);if(!m)fail('MEMORY_FORMAT');return Number(m[1])*1024**(['','k','m','g','t'].indexOf(m[2].toLowerCase()));};
const duration=v=>{if(typeof v==='number')return v;let total=0,used='';for(const m of String(v).matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gu)){total+=Number(m[1])*({ns:1,us:1000,'µs':1000,ms:1e6,s:1e9,m:60e9,h:3600e9}[m[2]]);used+=m[0];}if(used!==v)fail('HEALTH_DURATION_FORMAT');return total;};
export function verifyDeclaredRuntime(container,service,image){
 const allowed=['build','command','depends_on','entrypoint','environment','env_file','healthcheck','image','logging','mem_limit','networks','restart','volumes','labels','ports','profiles','container_name','user','working_dir','domainname','hostname','stdin_open','tty','stop_signal','stop_grace_period','read_only','privileged','init','mem_reservation','cpus','cpu_shares','cpuset','pids_limit','cap_add','cap_drop','security_opt','tmpfs'];
 if(Object.keys(service).some(k=>!allowed.includes(k)))fail('UNREVIEWED_SERVICE_KEY');
 const c=container.Config,h=container.HostConfig,checks={};
 const check=(name,actual,expected)=>{if(!same(actual,expected))fail(name);checks[name]=true;};
 check('USER',c.User??'',service.user??image.Config.User??'');check('WORKDIR',c.WorkingDir??'',service.working_dir??image.Config.WorkingDir??'');
 check('DOMAIN',c.Domainname??'',service.domainname??'');check('STDIN',!!c.OpenStdin,!!service.stdin_open);check('TTY',!!c.Tty,!!service.tty);
 check('STOP_SIGNAL',c.StopSignal??'',service.stop_signal??image.Config.StopSignal??'');
 const labels=v=>Object.fromEntries(Object.entries(v??{}).filter(([k])=>!k.startsWith('com.docker.compose.')));
 check('LABELS',labels(c.Labels),labels({...image.Config.Labels,...service.labels}));
 check('PRIVILEGED',!!h.Privileged,!!service.privileged);check('READONLY',!!h.ReadonlyRootfs,!!service.read_only);check('INIT',!!h.Init,!!service.init);
 check('MEMORY',h.Memory??0,bytes(service.mem_limit));check('MEMORY_RESERVATION',h.MemoryReservation??0,bytes(service.mem_reservation));
 check('CPU',h.NanoCpus??0,Math.round(Number(service.cpus??0)*1e9));check('CPU_SHARES',h.CpuShares??0,Number(service.cpu_shares??0));check('CPUSET',h.CpusetCpus??'',service.cpuset??'');
 check('PID_LIMIT',Number(h.PidsLimit??0),Number(service.pids_limit??0));
 const caps=v=>(v??[]).map(s=>s.toUpperCase().replace(/^CAP_/u,'')).sort(),security=v=>(v??[]).map(s=>s==='no-new-privileges'?'no-new-privileges:true':s).sort();check('CAP_ADD',caps(h.CapAdd),caps(service.cap_add));check('CAP_DROP',caps(h.CapDrop),caps(service.cap_drop));check('SECURITY_OPTIONS',security(h.SecurityOpt),security(service.security_opt));
 const tmpOptions=s=>Object.fromEntries(String(s).split(',').filter(v=>v&&v!=='rw').map(v=>{const i=v.indexOf('=');return i<0?[v,true]:[v.slice(0,i),v.startsWith('size=')?bytes(v.slice(i+1)):v.slice(i+1)];}));
 const declaredTmp={};for(const item of service.tmpfs??[]){if(typeof item!=='string')fail('TMPFS_FORMAT');const i=item.indexOf(':');declaredTmp[i<0?item:item.slice(0,i)]=tmpOptions(i<0?'':item.slice(i+1));}
 check('TMPFS',Object.fromEntries(Object.entries(h.Tmpfs??{}).map(([k,v])=>[k,tmpOptions(v)])),declaredTmp);
 check('PUBLISHED_PORTS',Object.keys(h.PortBindings??{}).length,0);check('DECLARED_PORTS',(service.ports??[]).length,0);
 const [restart,retries]=String(service.restart??'no').split(':');check('RESTART',{Name:h.RestartPolicy.Name,MaximumRetryCount:h.RestartPolicy.MaximumRetryCount??0},{Name:restart,MaximumRetryCount:Number(retries??0)});
 if(service.logging){check('LOG_DRIVER',h.LogConfig?.Type,service.logging.driver??'json-file');check('LOG_OPTIONS',h.LogConfig?.Config??{},Object.fromEntries(Object.entries(service.logging.options??{}).map(([k,v])=>[k,String(v)])));}else check('LOG_DRIVER',h.LogConfig?.Type,'json-file');
 const health=service.healthcheck??{},expected={...image.Config.Healthcheck};
 if(health.disable){check('HEALTH_DISABLED',c.Healthcheck?.Test,['NONE']);}
 else{
  if(health.test)expected.Test=health.test;
  for(const [k,target]of [['interval','Interval'],['timeout','Timeout'],['start_period','StartPeriod'],['start_interval','StartInterval']])if(health[k]!==undefined)expected[target]=duration(health[k]);
  if(health.retries!==undefined)expected.Retries=health.retries;
  check('HEALTH_TEST',c.Healthcheck?.Test??null,expected.Test??null);
  for(const k of ['Interval','Timeout','StartPeriod','StartInterval','Retries'])check('HEALTH_'+k.toUpperCase(),c.Healthcheck?.[k]??0,expected[k]??0);
 }
 return checks;
}
