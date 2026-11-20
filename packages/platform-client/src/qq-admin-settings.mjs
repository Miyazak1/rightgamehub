const bounds={dailyCalls:[1,200],dailyTokens:[1024,2000000],userDailyCalls:[1,100],userMinuteMessages:[1,10],groupMinuteMessages:[1,30]};
export function qqRuntimeView(runtime){
 const view=(label,message='',online=false)=>({label,message,online});
 if(!runtime)return view('读取中…');
 if(!runtime.available)return view('登录服务不可用','QQ 登录服务暂时不可用。服务恢复后会自动更新状态；若需要重新登录，请使用下方扫码入口。');
 if(runtime.phase==='reconnecting')return view('正在恢复连接','QQ 正在尝试恢复连接，请等待状态更新。需要重新扫码时会在这里提示。');
 if(!runtime.loggedIn){
  if(runtime.phase==='qrcode_scanned')return view('等待手机确认','已扫码，请在手机 QQ 确认登录；完成后会自动更新连接状态。');
  if(runtime.phase==='initializing')return view('正在登录','QQ 正在登录，请等待连接状态更新。');
  if(runtime.phase==='generating_qrcode')return view('正在生成二维码','正在准备登录二维码，请稍候。');
  return view('待扫码登录','QQ 未登录或已离线，请使用下方二维码扫码恢复登录。登录后会自动连接，已有历史记录继续保留。');
 }
 if(!runtime.coreReady)return view('正在初始化','QQ 已登录，正在初始化，请等待连接状态更新。');
 if(!runtime.accountMatches)return view('账号不一致');
 if(!runtime.groupReady)return view('待确认入群');
 if(!runtime.connected)return view('问答连接恢复中','QQ 已登录，正在恢复问答连接，无需重新扫码。');
 return view('已连接','QQ 已连接。关闭此页面不会退出 QQ；需要重新登录时会在这里提示。',true);
}
export const qqAdminErrorLabel=error=>({QQ_ADMIN_NOT_CONFIGURED:'服务器尚未连接 QQ 管理服务，请先完成部署。',QQ_CONTROL_UNAVAILABLE:'QQ 管理服务暂时不可用，请稍后刷新。',QQ_GATEWAY_UNAVAILABLE:'QQ 登录网关暂时不可用，请稍后刷新。',QQ_SETTINGS_CONFLICT:'设置已被另一位管理员更新。请核对最新设置后重新保存。',QQ_LOGIN_CONFLICT:'二维码已被更新，请重新获取当前二维码。',QQ_WORKER_BUSY:'正在处理一条回复，请稍后再保存或刷新二维码。',QQ_ACTION_UNCERTAIN:'操作结果尚未确认，请查看当前状态或二维码，不要连续重复操作。',QQ_LOGIN_ACCOUNT_MISMATCH:'QQ 号与绑定的专用账号不一致，请核对后再登录。',QQ_PASSWORD_LOGIN_FAILED:'密码登录未成功，请核对账号和密码，或使用扫码登录。',QQ_ALREADY_LOGGED_IN:'QQ 已登录，无需再次登录。',QQ_QR_UNAVAILABLE:'二维码尚未就绪，请稍后获取。',QQ_REQUEST_CONFLICT:'本次操作标识冲突，请刷新页面后重试。',QQ_AGENT_NOT_BOUND:'此机器人尚未绑定 QQ 通道。',QQ_ADMIN_REQUIRED:'需要管理员权限。',QQ_CONTROL_RATE_LIMIT:'操作过于频繁，请稍后再试。'}[error?.code]??'操作未完成，请刷新状态后重试。');
export function buildQQSettings(form){
 const groupId=String(form.groupId??'').trim(),allowedUsers=String(form.users??'').split(/[\s,，;；]+/u).filter(Boolean);
 if(!/^[1-9][0-9]{4,15}$/u.test(groupId)||!Number.isSafeInteger(Number(groupId))||!allowedUsers.length||allowedUsers.length>20||allowedUsers.some(value=>!/^[1-9][0-9]{4,15}$/u.test(value)||!Number.isSafeInteger(Number(value)))||new Set(allowedUsers).size!==allowedUsers.length)throw Error('请填写有效群号及 1～20 个不重复的 QQ 号。');
 const result={enabled:form.enabled===true,groupId,allowedUsers};
 for(const [key,[min,max]] of Object.entries(bounds)){const value=Number(form[key]);if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('预算或限流数值超出允许范围。');result[key]=value;}
 return result;
}
export const qqForm=settings=>({...settings,users:settings.allowedUsers.join('\n')});
