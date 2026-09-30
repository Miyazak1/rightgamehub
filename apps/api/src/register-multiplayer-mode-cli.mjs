import crypto from 'node:crypto';
import { loadConfig } from './config.mjs';
import { createDatabase } from './database.mjs';
import { PostgresMultiplayerRoomRepository } from './multiplayer-room-repository.mjs';
import { loadRulesRegistry } from '@gamehub/rules-sdk';

const required = name => {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const integer = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
};
const boolean = (name, fallback) => {
  const value = String(process.env[name] ?? fallback).toLowerCase();
  if (!['true','false'].includes(value)) throw new Error(`${name} must be true or false.`);
  return value === 'true';
};
const stable = value => JSON.stringify(value,Object.keys(value ?? {}).sort());

const input = {
  workId: required('MULTIPLAYER_WORK_ID'),
  key: required('MULTIPLAYER_MODE_KEY'),
  name: required('MULTIPLAYER_MODE_NAME'),
  authority: process.env.MULTIPLAYER_AUTHORITY ?? 'platform_authoritative',
  minPlayers: integer('MULTIPLAYER_MIN_PLAYERS',2),
  maxPlayers: integer('MULTIPLAYER_MAX_PLAYERS',2),
  rulesetVersion: required('MULTIPLAYER_RULESET_VERSION'),
  config: {
    turnSeconds: integer('MULTIPLAYER_TURN_SECONDS',90),
    spectators: boolean('MULTIPLAYER_SPECTATORS','false'),
    reconnectGraceSeconds: integer('MULTIPLAYER_RECONNECT_GRACE_SECONDS',120),
  },
};

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.workId)) throw new Error('MULTIPLAYER_WORK_ID must be a UUID.');
if (!/^[a-z][a-z0-9_]{1,63}$/u.test(input.key)) throw new Error('MULTIPLAYER_MODE_KEY is invalid.');
if (!['platform_authoritative','external_authoritative','relay_unverified'].includes(input.authority)) throw new Error('MULTIPLAYER_AUTHORITY is invalid.');
if (input.minPlayers < 2 || input.maxPlayers > 8 || input.minPlayers > input.maxPlayers) throw new Error('Multiplayer player limits are invalid.');
if (input.config.turnSeconds < 10 || input.config.turnSeconds > 3600 || input.config.reconnectGraceSeconds < 15 || input.config.reconnectGraceSeconds > 600) throw new Error('Multiplayer timing settings are invalid.');

const config = loadConfig();
const rulesRegistry = loadRulesRegistry({ manifestPath: config.rulesManifestPath,trustedKeys: config.rulesTrustedKeys,allowUnsigned: config.rulesAllowUnsigned });
if (input.authority === 'platform_authoritative' && !rulesRegistry.get({ workId: input.workId,modeKey: input.key,rulesetVersion: input.rulesetVersion })) {
  throw new Error('The requested authoritative rules adapter is not installed and trusted.');
}

const database = createDatabase(config);
try {
  const existing = (await database.pool.query('SELECT * FROM multiplayer_game_modes WHERE work_id=$1 AND key=$2',[input.workId,input.key])).rows[0];
  if (existing) {
    const unchanged = existing.name === input.name
      && existing.authority === input.authority
      && Number(existing.min_players) === input.minPlayers
      && Number(existing.max_players) === input.maxPlayers
      && existing.ruleset_version === input.rulesetVersion
      && stable(existing.config ?? {}) === stable(input.config);
    if (!unchanged) throw new Error('The multiplayer mode already exists with different settings; use a new mode key or perform an explicit reviewed migration.');
    process.stdout.write(`${JSON.stringify({ status: 'already_registered',id: existing.id,workId: existing.work_id,key: existing.key,rulesetVersion: existing.ruleset_version })}\n`);
  } else {
    const mode = await new PostgresMultiplayerRoomRepository(database.pool).createMode({ id: crypto.randomUUID(),...input,now: new Date() });
    if (!mode) throw new Error('The work does not exist or is not a published game.');
    process.stdout.write(`${JSON.stringify({ status: 'registered',...mode })}\n`);
  }
} finally {
  await database.close();
}
