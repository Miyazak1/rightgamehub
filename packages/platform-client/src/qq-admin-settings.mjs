const bounds={dailyCalls:[1,200],dailyTokens:[1024,2000000],userDailyCalls:[1,100],userMinuteMessages:[1,10],groupMinuteMessages:[1,30]};
export const qqAdminErrorLabel=error=>({QQ_ADMIN_NOT_CONFIGURED:'服务器尚未连接 QQ 管理服务，请先完成部署。',QQ_CONTROL_UNAVAILABLE:'QQ 管理服务暂时不可用，请稍后刷新。',QQ_GATEWAY_UNAVAILABLE:'QQ 登录网关暂时不可用，请稍后刷新。',QQ_SETTINGS_CONFLICT:'设置已被另一位管理员更新。请核对最新设置后重新保存。',QQ_LOGIN_CONFLICT:'二维码已被更新，请重新获取当前二维码。',QQ_WORKER_BUSY:'正在处理一条回复，请稍后再保存或刷新二维码。',QQ_ACTION_UNCERTAIN:'操作结果尚未确认，请查看当前状态或二维码，不要连续重复操作。',QQ_ALREADY_LOGGED_IN:'QQ 已登录，无需再次扫码。',QQ_QR_UNAVAILABLE:'二维码尚未就绪，请稍后获取。',QQ_REQUEST_CONFLICT:'本次操作标识冲突，请刷新页面后重试。',QQ_AGENT_NOT_BOUND:'此机器人尚未绑定 QQ 通道。',QQ_ADMIN_REQUIRED:'需要管理员权限。',QQ_CONTROL_RATE_LIMIT:'操作过于频繁，请稍后再试。'}[error?.code]??'操作未完成，请刷新状态后重试。');
export function buildQQSettings(form){
 const groupId=String(form.groupId??'').trim(),allowedUsers=String(form.users??'').split(/[\s,，;；]+/u).filter(Boolean);
 if(!/^[1-9][0-9]{4,15}$/u.test(groupId)||!Number.isSafeInteger(Number(groupId))||!allowedUsers.length||allowedUsers.length>20||allowedUsers.some(value=>!/^[1-9][0-9]{4,15}$/u.test(value)||!Number.isSafeInteger(Number(value)))||new Set(allowedUsers).size!==allowedUsers.length)throw Error('请填写有效群号及 1～20 个不重复的 QQ 号。');
 const result={enabled:form.enabled===true,groupId,allowedUsers};
 for(const [key,[min,max]] of Object.entries(bounds)){const value=Number(form[key]);if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('预算或限流数值超出允许范围。');result[key]=value;}
 return result;
}
export const qqForm=settings=>({...settings,users:settings.allowedUsers.join('\n')});
