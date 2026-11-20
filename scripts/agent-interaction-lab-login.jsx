import React,{useEffect,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
const label=code=>({QQ_GATEWAY_RATE_LIMITED:'网关鉴权暂时限流，正在等待恢复，请稍后再刷新二维码。',QQ_ALREADY_LOGGED_IN:'账号已经登录，正在初始化。',QQ_GATEWAY_RESTART_REQUIRED:'本机测试网关的登录服务需要后台重启恢复，登录资料会保留。',QQ_QR_UNAVAILABLE:'二维码尚未就绪，请稍后再刷新。'})[code]??'本机网关暂时不可用，正在重新连接。';
async function request(url,method='GET',signal){
 const response=await fetch(url,{method,signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])}),value=await response.json();
 if(!response.ok||!value.data)throw Object.assign(new Error(label(value.error?.code)),{code:value.error?.code});
 return value.data;
}
export default function LabQQLogin({botId}){
 const [state,setState]=useState(null),[statusError,setStatusError]=useState(null),[qrError,setQRError]=useState(''),[qr,setQR]=useState(null),[busy,setBusy]=useState(false);
 useEffect(()=>{const controller=new AbortController();let timer;
  async function read(){try{const value=await request('/lab/qq/login-status','GET',controller.signal);if(!controller.signal.aborted){setState(value);setStatusError(null);if(value.loggedIn)setQR(null);}}catch(error){if(!controller.signal.aborted)setStatusError(error);}finally{if(!controller.signal.aborted)timer=setTimeout(read,3000);}}
  read();return()=>{controller.abort();clearTimeout(timer);};
 },[]);
 const phase=statusError?label(statusError.code):state?.ready?'已登录，已就绪':state?.loggedIn?'已登录，正在初始化':({qrcode_scanned:'已扫码，请在手机确认',initializing:'正在初始化',generating_qrcode:'正在生成二维码',waiting_qrcode:'等待扫码',offline:'未登录，等待扫码',reconnecting:'登录服务正在重连'})[state?.phase]??'正在读取网关状态…';
 return <main style={{maxWidth:600,margin:'40px auto',padding:16,fontFamily:'sans-serif'}}><h1>小墨鱼独立 QQ 联合验收</h1><p>测试机器人 {botId}。仅本机测试，不修改线上服务，论文关闭。</p><p>点击刷新二维码，用原独立测试账号扫码并在手机确认。不要向聊天发送密码或凭据。</p><p role="status">当前状态：{phase}</p><button disabled={busy||state?.loggedIn||statusError?.code==='QQ_GATEWAY_RATE_LIMITED'} onClick={async()=>{setBusy(true);setQRError('');try{const value=await request('/lab/qq/qrcode','POST');setQR(value.qrText);}catch(error){setQRError(error.message);}finally{setBusy(false);}}}>{busy?'正在生成二维码…':'刷新二维码'}</button>{qrError&&<p role="alert">{qrError}</p>}{qr&&!state?.loggedIn&&<div style={{marginTop:24}}><QRCodeSVG value={qr} size={280}/><p>二维码短期有效，过期后请刷新。</p></div>}</main>;
}
