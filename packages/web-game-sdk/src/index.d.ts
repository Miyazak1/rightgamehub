export type SaveContentType = 'application/json' | 'application/octet-stream';
export type SaveData = Record<string, unknown> | Uint8Array;
export type SaveRevision = string;
export interface SaveResource { namespace?: string; slot: string }
export interface SaveMetadata {
  namespace: string; slot: string; revisionId: string; revision: SaveRevision; etag: string;
  schemaVersion: number | null; contentType: SaveContentType | null; contentEncoding: 'identity';
  sha256: string | null; bytes: number; updatedAt: string; deleted: boolean; restoredFromRevisionId: string | null;
}
export interface SaveRead<T extends SaveData = SaveData> extends SaveMetadata { data: T | null }
export interface SavePolicy {
  namespace: string; status: 'active' | 'retired'; maxSlots: number; maxDocumentBytes: number;
  maxLiveBytes: number; maxHistoryBytes: number; historyVersions: number; historyDays: number;
  schemaMin: number; schemaMax: number; contentTypes: SaveContentType[];
}
export interface SaveWriteResult extends SaveMetadata { historyDegraded: boolean; durability: 'cloud' }
export type SaveCondition = { createOnly: true; expectedEtag?: null } | { createOnly?: false; expectedEtag: string };
export type SaveWriteInput = SaveResource & SaveCondition & {
  schemaVersion: number; contentType?: SaveContentType; data: SaveData;
  /** Retain this key and the exact body/CAS condition to retry a failed acknowledgement. */
  idempotencyKey: string;
};
export interface SaveExistingMutation extends SaveResource { expectedEtag: string; idempotencyKey: string }
export interface SaveHistory {
  items: Array<SaveMetadata & {payloadAvailable: boolean}>; nextBeforeRevision: SaveRevision | null;
}
export interface SaveSyncStatus extends SaveResource {
  state: 'idle' | 'syncing' | 'cloud' | 'conflict' | 'error_retryable' | 'blocked';
  operation?: 'read' | 'write' | 'delete' | 'restore'; revision?: SaveRevision; code?: string; historyDegraded?: boolean;
}
export interface CloudSaveClient {
  getPolicy(input?: {namespace?: string}): Promise<SavePolicy>;
  listSlots(input?: {namespace?: string}): Promise<SaveMetadata[]>;
  getMetadata(input: SaveResource): Promise<SaveMetadata | null>;
  read<T extends SaveData = SaveData>(input: SaveResource): Promise<SaveRead<T> | null>;
  write(input: SaveWriteInput): Promise<SaveWriteResult>;
  delete(input: SaveExistingMutation): Promise<SaveWriteResult>;
  restore(input: SaveExistingMutation & {revisionId: string}): Promise<SaveWriteResult>;
  history(input: SaveResource & {beforeRevision?: SaveRevision}): Promise<SaveHistory>;
  getSyncStatus(input: SaveResource): Promise<SaveSyncStatus>;
}
export interface GameHubError extends Error {
  code: string; retryable?: boolean; status?: number;
  details?: {expectedEtag?: string | null; currentRevision?: SaveRevision | null; currentUpdatedAt?: string | null};
}
export interface MultiplayerRooms {
  list(modeId: string, query?: string): Promise<unknown[]>;
  create(input: Record<string, unknown>): Promise<unknown>;
  get(roomId: string): Promise<unknown>;
  join(roomId: string, modeId: string, joinCode?: string | null): Promise<unknown>;
  invite(roomId: string): Promise<unknown>; current(): Promise<unknown>;
  leave(roomId: string): Promise<unknown>; ready(roomId: string, ready: boolean): Promise<unknown>;
  start(roomId: string): Promise<unknown>; subscribe(roomId: string): Promise<unknown>; unsubscribe(roomId: string): Promise<unknown>;
}
export interface GameFileExport { filename:string; mimeType:'image/png'|'application/json'; data:ArrayBuffer }
export interface GameShareInput { title:string; payload:Record<string,unknown> }
export interface GameShareLink { code:string; url:string; expiresAt:string }
export interface CurrentGameShare extends GameShareInput { code:string; workId:string; releaseId:string; expiresAt:string }
export interface GameHubClient {
  files: { download(input:GameFileExport):Promise<{status:'saved'|'download_started';filename:string}> };
  shares: { create(input:GameShareInput):Promise<GameShareLink>; current():Promise<CurrentGameShare|null> };
  connect(): Promise<string[]>;
  getPlayer(): Promise<{id: string; displayName: string; avatar: unknown | null}>;
  cloudSave: CloudSaveClient;
  competition: {
    listBoards(): Promise<CompetitionBoard[]>;
    start(input:{boardId:string;requestId?:string}): Promise<CompetitionRun>;
    get(runId:string): Promise<CompetitionRun>;
    finish(runId:string,submission:{metrics?:Record<string,number>;evidence?:{format:'tile-merge-v1';moves:string}}): Promise<CompetitionRun>;
    abandon(runId:string): Promise<{abandoned:boolean}>;
    leaderboard(boardId:string,query?:{date?:string;limit?:number;offset?:number}): Promise<unknown>;
  };
  multiplayer: {
    listModes(): Promise<unknown[]>; rooms: MultiplayerRooms;
    connect(): Promise<unknown>; disconnect(): Promise<unknown>;
    matches: {
      subscribe(matchId: string, afterSeq?: number): Promise<unknown>;
      unsubscribe(matchId: string): Promise<unknown>;
      command(matchId: string, command: Record<string, unknown>): Promise<unknown>;
      resign(matchId: string): Promise<unknown>;
    };
  };
  on(event: 'cloudSave.sync.changed', listener: (status: SaveSyncStatus) => void): () => void;
  on(event: string, listener: (payload: unknown) => void): () => void;
  close(): void;
}
export function createGameHubClient(options?: {
  windowImpl?: Window; parentWindow?: Window; requestTimeoutMs?: number; cloudSaveTimeoutMs?: number;
}): GameHubClient;
export interface CompetitionBoard {id:string;key:string;title:string;modeKey:string;rulesetVersion:number;period:'daily'|'all-time';verification:'client_reported'|'replay_verified';metrics:Array<{key:string;label:string;unit:string;min:number;max:number}>;ranking:Array<{metric:string;direction:'asc'|'desc'}>}
export interface CompetitionRun {id:string;boardId:string;status:'issued'|'accepted'|'abandoned'|'invalidated';periodKey:string;seed:number;expiresAt:string;metrics:Record<string,number>|null;channel:'production'|'preview';verification?:'client_reported'|'replay_verified'}
export const WEB_GAME_BRIDGE_PROTOCOL: 'gamehub.web-game.v1';
export const WEB_GAME_BRIDGE_VERSION: 1;
export const WEB_GAME_BRIDGE_MAX_BYTES: number;
export const WEB_GAME_BRIDGE_METHODS: readonly string[];
export function bridgeEnvelope(fields: Record<string, unknown>): Record<string, unknown>;
export function isBridgeConnectMessage(value: unknown): boolean;
export function parseBridgeRequest(value: unknown): {method: string; id: string; params?: Record<string, unknown>};
export function bridgeMethodCapability(method: string): string | null;
