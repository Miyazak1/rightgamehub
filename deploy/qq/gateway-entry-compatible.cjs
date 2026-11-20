const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const token=process.env.QQ_WEBUI_TOKEN;
if(!/^[a-f0-9]{64}$/u.test(token??''))throw Error('QQ_WEBUI_TOKEN_REQUIRED');
// Refuse a mixed runtime rather than silently redirecting existing login data.
if(process.cwd()!=='/app'||process.env.HOME!=='/data/home'||process.env.NAPCAT_WORKDIR!=='/data/napcat'||process.env.NAPCAT_QQ_DATA_DIR||process.env.LD_LIBRARY_PATH||process.env.LD_PRELOAD)throw Error('QQ_COMPAT_RUNTIME_MISMATCH');
const directory='/data/napcat/config',file=path.join(directory,'webui.json');
for(const dir of [directory,'/data/home'])fs.mkdirSync(dir,{recursive:true});
if(fs.existsSync(file)){
 const previous=JSON.parse(fs.readFileSync(file,'utf8'));
 if(previous.token!==token||previous.port!==6099)throw Error('QQ_EXISTING_WEBUI_CONFIG_RETAINED');
}else fs.writeFileSync(file,JSON.stringify({host:'0.0.0.0',port:6099,prefix:'',token,loginRate:3,accessControlMode:'none',ipWhitelist:[],ipBlacklist:[],enableXForwardedFor:false}),{flag:'wx',mode:0o600});
process.env.NAPCAT_WRAPPER_PATH='/app/wrapper.node';
process.env.NAPCAT_QQ_PACKAGE_INFO_PATH='/app/package.json';
process.env.NAPCAT_PRELOAD_NODE_ADDON_PATH='/app/node_addon.node';
process.dlopen({exports:{}},'/app/node_addon.node',os.constants.dlopen.RTLD_NOW|os.constants.dlopen.RTLD_GLOBAL);
import('/app/napcat/napcat.mjs');
