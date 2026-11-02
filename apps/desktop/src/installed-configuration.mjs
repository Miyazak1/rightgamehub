import path from 'node:path';
import { productionAccountProfile } from './account-configuration.mjs';
import { PRODUCTION_API_ORIGIN, PRODUCTION_RUNTIME } from './production-configuration.mjs';

// Independent of installation directory, application version and build machine.
// No launch.json, environment credential or development profile is imported.
export function installedDesktopConfig(appData, appRoot, args = []) {
  if (!path.isAbsolute(appData) || !path.isAbsolute(appRoot) || args.length && !(args.length === 1 && args[0] === '--updated')) throw Error('DESKTOP_INSTALLED_OPTIONS_INVALID');
  return {assetRoot:path.join(appRoot,'web'),
    profileRoot:productionAccountProfile(path.join(appData,'MooyuWorkshop','profiles')),
    accountApiOrigin:PRODUCTION_API_ORIGIN, accountEnvironment:'production',
    businessRuntime:PRODUCTION_RUNTIME, initialRoute:'/discover'};
}
