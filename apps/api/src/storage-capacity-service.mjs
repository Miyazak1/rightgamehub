import fsp from 'node:fs/promises';
import path from 'node:path';

const WEB_EXPANDED_BYTES = 300 * 1024 ** 2;
const PARTIAL_RETENTION_MS = 2 * 60 * 60 * 1000;

export class StorageCapacityError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message);
    this.name = 'StorageCapacityError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

const asSafeNumber = value => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : Number.MAX_SAFE_INTEGER;
};

const percent = (used, total) => total > 0 ? Number((used / total * 100).toFixed(2)) : 100;

async function defaultFilesystem(root) {
  await fsp.mkdir(root, { recursive: true });
  const [filesystem, directory] = await Promise.all([fsp.statfs(root, { bigint: true }), fsp.stat(root, { bigint: true })]);
  const totalBytes = asSafeNumber(filesystem.blocks * filesystem.bsize);
  const availableBytes = asSafeNumber(filesystem.bavail * filesystem.bsize);
  return { deviceId: String(directory.dev), totalBytes, availableBytes, usedBytes: Math.max(0, totalBytes - availableBytes) };
}

async function directoryBytes(root) {
  let total = 0;
  const visit = async directory => {
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    await Promise.all(entries.map(async entry => {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory()) return visit(target);
      if (entry.isFile()) total += (await fsp.stat(target)).size;
    }));
  };
  await visit(root);
  return total;
}

const additionsFor = ({ packageType, declaredBytes, existingReservations = {} }) => ({
  quarantine: Number(existingReservations.quarantine ?? 0) + declaredBytes,
  validator: Number(existingReservations.validator ?? 0) + (packageType === 'web_zip' ? WEB_EXPANDED_BYTES : declaredBytes),
  runtime: Number(existingReservations.runtime ?? 0) + (packageType === 'web_zip' ? WEB_EXPANDED_BYTES : declaredBytes),
  avatars: 0,
  covers: 0,
});

export function createStorageCapacityService({
  roots,
  warnPercent = 70,
  blockPercent = 85,
  monitorIntervalMs = 60_000,
  clock = () => new Date(),
  statFilesystem = defaultFilesystem,
  measureDirectory = directoryBytes,
  logger = null,
} = {}) {
  const areas = Object.entries(roots ?? {}).map(([id, root]) => ({ id, root: path.resolve(root) }));
  if (!areas.length) throw new Error('At least one storage root is required.');
  let timer = null;
  let lastLevel = null;
  let nextCleanupAt = 0;
  let lastCleanup = { at: null, filesRemoved: 0, bytesReclaimed: 0 };

  const emitTransition = snapshot => {
    if (snapshot.level === lastLevel) return;
    lastLevel = snapshot.level;
    const event = { event: 'storage.capacity.transition', level: snapshot.level, acceptingUploads: snapshot.acceptingUploads, usedPercent: snapshot.usedPercent, checkedAt: snapshot.checkedAt };
    if (snapshot.level === 'healthy') logger?.info?.(event);
    else logger?.warn?.(event);
  };

  const inspect = async ({ additions = {}, includeLogicalBytes = false } = {}) => {
    const checkedAt = clock().toISOString();
    const measurements = await Promise.all(areas.map(async area => {
      try {
        const filesystem = await statFilesystem(area.root);
        return { area, filesystem };
      } catch (error) {
        logger?.warn?.({ event: 'storage.capacity.unavailable', area: area.id, code: error.code ?? 'STORAGE_STAT_FAILED' });
        return { area, error };
      }
    }));
    const reservationsByDevice = new Map();
    for (const measurement of measurements) {
      if (measurement.error) continue;
      const deviceId = measurement.filesystem.deviceId ?? `area:${measurement.area.id}`;
      const addition = Math.max(0, Number(additions[measurement.area.id] ?? 0));
      reservationsByDevice.set(deviceId, (reservationsByDevice.get(deviceId) ?? 0) + addition);
    }
    const stores = await Promise.all(measurements.map(async measurement => {
      const { area } = measurement;
      if (!measurement.error) {
        const { filesystem } = measurement;
        const deviceId = filesystem.deviceId ?? `area:${area.id}`;
        const reservedBytes = reservationsByDevice.get(deviceId) ?? 0;
        const projectedUsedBytes = Math.min(filesystem.totalBytes, filesystem.usedBytes + reservedBytes);
        const usedPercent = percent(filesystem.usedBytes, filesystem.totalBytes);
        const projectedUsedPercent = percent(projectedUsedBytes, filesystem.totalBytes);
        const level = projectedUsedPercent >= blockPercent ? 'blocked' : usedPercent >= warnPercent || projectedUsedPercent >= warnPercent ? 'warning' : 'healthy';
        return {
          id: area.id,
          available: true,
          level,
          totalBytes: String(filesystem.totalBytes),
          availableBytes: String(filesystem.availableBytes),
          usedBytes: String(filesystem.usedBytes),
          usedPercent,
          projectedUsedPercent,
          reservedBytes: String(reservedBytes),
          logicalBytes: includeLogicalBytes ? String(await measureDirectory(area.root)) : null,
        };
      }
      const error = measurement.error;
      return { id: area.id, available: false, level: 'unavailable', errorCode: error.code ?? 'STORAGE_STAT_FAILED' };
    }));
    const level = stores.some(store => store.level === 'unavailable') ? 'unavailable' : stores.some(store => store.level === 'blocked') ? 'blocked' : stores.some(store => store.level === 'warning') ? 'warning' : 'healthy';
    const usedPercent = Math.max(0, ...stores.filter(store => store.available).map(store => store.usedPercent));
    const snapshot = {
      checkedAt,
      level,
      acceptingUploads: level !== 'blocked' && level !== 'unavailable',
      usedPercent,
      thresholds: { warnPercent, blockPercent },
      stores,
      lastCleanup,
    };
    emitTransition(snapshot);
    return snapshot;
  };

  const cleanup = async () => {
    const quarantine = areas.find(area => area.id === 'quarantine');
    if (!quarantine) return lastCleanup;
    const now = clock().getTime();
    let filesRemoved = 0;
    let bytesReclaimed = 0;
    const visit = async directory => {
      const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
      await Promise.all(entries.map(async entry => {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) return;
        if (entry.isDirectory()) return visit(target);
        if (!entry.isFile() || !entry.name.endsWith('.partial')) return;
        const stat = await fsp.stat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
        if (stat && now - stat.mtimeMs > PARTIAL_RETENTION_MS) {
          await fsp.rm(target, { force: true });
          filesRemoved += 1;
          bytesReclaimed += stat.size;
        }
      }));
    };
    await visit(quarantine.root);
    lastCleanup = { at: clock().toISOString(), filesRemoved, bytesReclaimed };
    if (filesRemoved) logger?.info?.({ event: 'storage.cleanup.completed', filesRemoved, bytesReclaimed, at: lastCleanup.at });
    return lastCleanup;
  };

  const monitor = async () => {
    if (clock().getTime() >= nextCleanupAt) {
      await cleanup().catch(error => logger?.warn?.({ event: 'storage.cleanup.failed', code: error.code ?? 'STORAGE_CLEANUP_FAILED' }));
      nextCleanupAt = clock().getTime() + 10 * 60_000;
    }
    await inspect().catch(error => logger?.warn?.({ event: 'storage.capacity.failed', code: error.code ?? 'STORAGE_STAT_FAILED' }));
  };

  return Object.freeze({
    async assertCanAccept({ packageType, declaredBytes, existingReservations = {} }) {
      const snapshot = await inspect({ additions: additionsFor({ packageType, declaredBytes, existingReservations }) });
      if (snapshot.level === 'unavailable') throw new StorageCapacityError('STORAGE_CAPACITY_UNAVAILABLE', 503, '服务器暂时无法确认可用存储空间，请稍后重试。', true);
      if (snapshot.level === 'blocked') throw new StorageCapacityError('STORAGE_CAPACITY_EXCEEDED', 507, '服务器存储空间接近上限，暂时停止接受新上传；现有作品仍可正常使用。', true);
      return snapshot;
    },
    async adminOverview(actor) {
      if (actor?.profile?.role !== 'admin') throw new StorageCapacityError('ADMIN_REQUIRED', 403, '需要管理员权限。');
      return inspect({ includeLogicalBytes: true });
    },
    cleanup,
    async start() {
      if (timer) return;
      await monitor();
      timer = setInterval(monitor, monitorIntervalMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  });
}
