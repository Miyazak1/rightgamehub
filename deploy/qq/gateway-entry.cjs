const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const token=process.env.QQ_WEBUI_TOKEN;
if(!token||!/^[a-f0-9]{64}$/.test(token))throw Error('QQ_WEBUI_TOKEN_REQUIRED');
const directory='/data/napcat/config',file=path.join(directory,'webui.json');
for(const dir of [directory,'/data/qq','/data/home'])fs.mkdirSync(dir,{recursive:true});
if(fs.existsSync(file)){
 const prior=JSON.parse(fs.readFileSync(file,'utf8'));
 if(prior.token!==token||prior.port!==6099)throw Error('QQ_EXISTING_WEBUI_CONFIG_RETAINED');
}else fs.writeFileSync(file,JSON.stringify({host:'0.0.0.0',port:6099,prefix:'',token,loginRate:3,accessControlMode:'none',ipWhitelist:[],ipBlacklist:[],enableXForwardedFor:false}),{flag:'wx',mode:0o600});
process.env.NAPCAT_WRAPPER_PATH='/opt/qq/wrapper.node';
process.env.NAPCAT_QQ_PACKAGE_INFO_PATH='/opt/qq/package.json';
process.env.NAPCAT_QQ_VERSION_CONFIG_PATH='/opt/qq/config.json';
process.env.NAPCAT_DISABLE_PIPE='1';
process.env.NAPCAT_PRELOAD_NODE_ADDON_PATH='/opt/node_addon.node';
process.dlopen({exports:{}},'/opt/node_addon.node',os.constants.dlopen.RTLD_NOW|os.constants.dlopen.RTLD_GLOBAL);
import('/opt/napcat/napcat.mjs');
