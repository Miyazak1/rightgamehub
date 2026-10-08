import { GUESS_BAIKE_WORK_ID, guessBaikeWork } from './built-in-works.mjs';
import { presentCatalogWork, editorialSearchIds } from './catalog-presentation.mjs';

export class CatalogError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'CatalogError'; this.code = code; this.statusCode = statusCode; this.retryable = false; }
}

const releaseHost = (releaseId, config) => {
  const label = `r-${releaseId.replaceAll('-', '')}.${config.runtimeDomain}`;
  const port = config.runtimePublicPort ? `:${config.runtimePublicPort}` : '';
  return `${config.runtimeScheme}://${label}${port}`;
};

export function createCatalogService({ repository, config, artifactStore }) {
  return {
    async list(query = {}) {
      const limit = query.limit == null ? 20 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new CatalogError('SCHEMA_INVALID', 400, 'limit must be between 1 and 50.');
      const offset=query.offset==null?0:Number(query.offset),q=String(query.q??'').trim().toLowerCase();
      if(!Number.isInteger(offset)||offset<0||offset>100000||q.length>100||query.kind&&!['game','creative','tool'].includes(query.kind))throw new CatalogError('SCHEMA_INVALID',400,'目录查询参数无效。');
      const builtIn=(!query.kind||query.kind==='game')&&(!q||[guessBaikeWork.title,guessBaikeWork.description,...guessBaikeWork.tags,'GameHub'].join(' ').toLowerCase().includes(q));
      const includeBuiltIn=builtIn&&offset===0;
      const remaining=limit-(includeBuiltIn?1:0);
      const works=remaining?await repository.list({limit:remaining,kind:query.kind??null,q,offset:Math.max(0,offset-(builtIn?1:0)),editorialIds:editorialSearchIds(q)}):[];
      return [...(includeBuiltIn?[guessBaikeWork]:[]),...works.map(presentCatalogWork)];
    },
    async get(workId) {
      if (workId === GUESS_BAIKE_WORK_ID) return guessBaikeWork;
      const work = await repository.get(workId);
      if (!work) throw new CatalogError('NOT_FOUND', 404, 'Work not found.');
      return presentCatalogWork(work);
    },
    async download(workId, releaseId) {
      const release = await repository.getDownload(workId, releaseId);
      if (!release) throw new CatalogError('NOT_FOUND', 404, 'Downloadable Windows release not found.');
      if (!artifactStore) throw new CatalogError('DOWNLOAD_UNAVAILABLE', 503, 'Download storage is unavailable.');
      return {
        releaseId: release.id,
        targetKey: release.target_key,
        packageType: release.package_type,
        os: release.os,
        arch: release.arch,
        fileName: release.file_name,
        sizeBytes: Number(release.actual_bytes),
        sha256: release.artifact_sha256,
        filePath: artifactStore.pathFor(release.object_key),
      };
    },
    async launch(workId, releaseId) {
      if (workId === GUESS_BAIKE_WORK_ID) throw new CatalogError('BUILT_IN_GAME', 409, '内置游戏不需要远程启动描述。');
      const release = await repository.getLaunch(workId, releaseId ?? null);
      if (!release) throw new CatalogError('NOT_FOUND', 404, 'Playable release not found.');
      const origin = releaseHost(release.id, config);
      const entry = release.entry_path.split('/').map(encodeURIComponent).join('/');
      const capabilities = new Set(release.approved_capabilities ?? []);
      return {
        apiVersion: 1, workId, releaseId: release.id, releaseLabel: release.label,
        entryUrl: `${origin}/${entry}`, runtimeOrigin: origin,
        playerProtocol: { min: 1, max: 1 },
        capabilities: { localSave: capabilities.has('localSave') || capabilities.has('cloudSave'), fullscreen: capabilities.has('fullscreen'), pointerLock: capabilities.has('pointerLock'), multiplayer: capabilities.has('multiplayer') },
      };
    },
  };
}

