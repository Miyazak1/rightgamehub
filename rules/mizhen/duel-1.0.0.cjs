'use strict';

// Trusted server-authoritative rules for 迷阵. This bundle is deliberately
// dependency-free because production loads it in the restricted rules VM.

const WORK_ID = '1a13df55-8906-4b03-a19a-5e5a3b776649';
const MODE_KEY = 'duel';
const RULESET_VERSION = '1.0.0';
const ROWS = 8;
const COLS = 10;
const MAX_COMMAND = 5;
const RELAYS = new Set([12, 17, 62, 67]);
const TYPES = [
  'general', 'advisor', 'advisor', 'elephant', 'elephant', 'horse', 'horse',
  'rook', 'rook', 'cannon', 'cannon', 'soldier', 'soldier', 'soldier',
  'soldier', 'soldier',
];
const PIECE_SCORE = { general: 8, rook: 5, cannon: 4, horse: 3, advisor: 2, elephant: 2, soldier: 1 };

const clone = value => JSON.parse(JSON.stringify(value));
const other = color => color === 'red' ? 'black' : 'red';
const colorFor = (state, userId) => state.players.red === userId ? 'red' : state.players.black === userId ? 'black' : null;
const userFor = (state, color) => state.players[color];
const pieceAt = (state, position) => state.pieces.find(piece => piece.pos === position);
const isProtected = piece => Boolean(piece && piece.revealed && piece.prep > 0);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Small dependency-free SHA-256 implementation for deterministic state hashes.
function sha256(text) {
  const encoded = encodeURIComponent(text);
  const output = [];
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === '%') { output.push(Number.parseInt(encoded.slice(index + 1,index + 3),16)); index += 2; }
    else output.push(encoded.charCodeAt(index));
  }
  const bytes = Uint8Array.from(output);
  const bitLength = bytes.length * 8;
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(total);
  data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(total - 4, bitLength >>> 0, false);
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000), false);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const k = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const w = new Uint32Array(64);
  const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
    h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return [...h].map(value => value.toString(16).padStart(8, '0')).join('');
}

function hashSeed(seed) {
  let value = 2166136261;
  for (const character of String(seed)) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function createRng(seed) {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function adjacent(a, b) {
  const ar = Math.floor(a / COLS), ac = a % COLS, br = Math.floor(b / COLS), bc = b % COLS;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc)) === 1;
}

function createSlots(rng) {
  const result = [];
  const anchors = { '0-0': 12, '0-1': 17, '3-0': 62, '3-1': 67 };
  for (let band = 0; band < 4; band++) {
    for (let side = 0; side < 2; side++) {
      const pool = [];
      for (let row = band * 2; row < band * 2 + 2; row++) for (let column = side * 5; column < side * 5 + 5; column++) pool.push(row * COLS + column);
      const anchor = anchors[`${band}-${side}`];
      if (anchor !== undefined) result.push(anchor, ...shuffle(pool.filter(position => position !== anchor), rng).slice(0, 3));
      else result.push(...shuffle(pool, rng).slice(0, 4));
    }
  }
  return shuffle(result, rng);
}

function createPieces(seed) {
  const rng = createRng(seed);
  let result = [];
  for (let tries = 0; tries < 400; tries++) {
    const identities = [], slots = createSlots(rng);
    for (const color of ['red', 'black']) for (const type of TYPES) identities.push({ color,type,revealed: false,prep: 0,revealedPly: -1 });
    shuffle(identities, rng);
    result = slots.map((position, id) => ({ ...identities[id],pos: position,id }));
    const redOnLeft = result.filter(piece => piece.pos % COLS < COLS / 2 && piece.color === 'red').length;
    const generals = result.filter(piece => piece.type === 'general');
    if (redOnLeft >= 6 && redOnLeft <= 10 && !adjacent(generals[0].pos, generals[1].pos)) break;
  }
  return result;
}

function legalMoves(state, piece) {
  const moves = new Map();
  const row = Math.floor(piece.pos / COLS), column = piece.pos % COLS;
  const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const add = (r, c) => {
    if (!inBounds(r, c)) return;
    const target = pieceAt(state, r * COLS + c);
    if (!target) moves.set(r * COLS + c, 'move');
    else if (target.revealed && target.color !== piece.color && !isProtected(target)) moves.set(r * COLS + c, 'capture');
  };
  const scan = (dr, dc, cannon = false) => {
    let r = row + dr, c = column + dc, screen = false;
    while (inBounds(r, c)) {
      const position = r * COLS + c, target = pieceAt(state, position);
      if (!cannon) {
        if (!target) moves.set(position, 'move');
        else { if (target.revealed && target.color !== piece.color && !isProtected(target)) moves.set(position, 'capture'); break; }
      } else if (!screen) {
        if (!target) moves.set(position, 'move'); else screen = true;
      } else if (target) {
        if (target.revealed && target.color !== piece.color && !isProtected(target)) moves.set(position, 'capture');
        break;
      }
      r += dr; c += dc;
    }
  };
  if (piece.type === 'rook' || piece.type === 'cannon') {
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr,dc]) => scan(dr,dc,piece.type === 'cannon'));
  } else if (piece.type === 'horse') {
    [[-2,-1,-1,0],[-2,1,-1,0],[2,-1,1,0],[2,1,1,0],[-1,-2,0,-1],[1,-2,0,-1],[-1,2,0,1],[1,2,0,1]].forEach(([dr,dc,lr,lc]) => {
      if (inBounds(row + lr, column + lc) && !pieceAt(state, (row + lr) * COLS + column + lc)) add(row + dr, column + dc);
    });
  } else if (piece.type === 'advisor') {
    [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => add(row + dr,column + dc));
  } else if (piece.type === 'elephant') {
    [[2,2],[2,-2],[-2,2],[-2,-2]].forEach(([dr,dc]) => {
      if (inBounds(row + dr,column + dc) && !pieceAt(state,(row + dr / 2) * COLS + column + dc / 2)) add(row + dr,column + dc);
    });
  } else if (piece.type === 'general') {
    [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => add(row + dr,column + dc));
  } else {
    const forward = piece.color === 'red' ? -1 : 1;
    add(row,column + forward);
    const crossed = piece.color === 'red' ? column < COLS / 2 : column >= COLS / 2;
    if (crossed) { add(row - 1,column); add(row + 1,column); }
  }
  return moves;
}

const inExploreRange = (state, color, position) => RELAYS.has(position) || state.pieces.some(piece => piece.revealed && piece.color === color && piece.prep === 0 && adjacent(piece.pos, position));
const exploreCost = (state, color, position) => inExploreRange(state,color,position) ? 1 : 3;
const hasLegalAction = (state, color = state.turn) => {
  const dark = state.pieces.filter(piece => !piece.revealed);
  if (!state.decision && dark.some(piece => state.cmd[color] >= exploreCost(state,color,piece.pos))) return true;
  if (dark.length && state.intel[color] >= 2) return true;
  return state.pieces.some(piece => piece.revealed && piece.color === color && legalMoves(state,piece).size > 0);
};

function beginTurn(state) {
  if (state.started[state.turn]) state.cmd[state.turn] = Math.min(MAX_COMMAND, state.cmd[state.turn] + 1);
  else state.started[state.turn] = true;
}

function startDecision(state) {
  state.decision = true; state.noCapture = 0;
  for (const piece of state.pieces) if (!piece.revealed) { piece.revealed = true; piece.revealedPly = state.ply; piece.prep = piece.type === 'general' ? 2 : 1; }
}

function scoreGame(state, reason) {
  const score = { red: 0,black: 0 };
  for (const piece of state.pieces) score[piece.color] += PIECE_SCORE[piece.type];
  state.winner = score.red === score.black ? 'draw' : score.red > score.black ? 'red' : 'black';
  state.finishReason = reason; state.score = score;
}

function rawAdvance(state, captured) {
  state.noCapture = captured ? 0 : state.noCapture + 1;
  const owner = state.turn;
  for (const piece of state.pieces) if (piece.revealed && piece.color === owner && piece.prep > 0 && piece.revealedPly < state.ply) piece.prep -= 1;
  state.ply += 1; state.half += 1; state.turn = other(state.turn);
  if (state.half === 2) {
    state.half = 0; state.round += 1;
    if (state.round === 21 && !state.decision) startDecision(state);
    if (state.round > 40) return scoreGame(state,'round_limit');
  }
  if (state.decision && state.noCapture >= 20) return scoreGame(state,'decision_stalemate');
  beginTurn(state);
}

function advance(state, captured) {
  state.stalled = 0;
  rawAdvance(state,captured);
  const skipped = [];
  while (!state.winner && !hasLegalAction(state,state.turn) && skipped.length < 2) {
    skipped.push(state.turn); state.stalled += 1;
    if (state.stalled >= 2) { scoreGame(state,'no_legal_actions'); break; }
    rawAdvance(state,false);
  }
  if (!state.winner && hasLegalAction(state,state.turn)) state.stalled = 0;
  return skipped;
}

function playerResults(state) {
  return ['red','black'].map(color => ({
    userId: userFor(state,color),
    result: state.winner === 'draw' ? 'draw' : state.winner === color ? 'win' : 'loss',
  }));
}

function transition(state, event, extra = {}) {
  const completed = Boolean(state.winner);
  return {
    state,
    eventType: event.type,
    event,
    completed,
    ...(completed ? {
      result: { winner: state.winner,reason: state.finishReason,score: state.score ?? null },
      terminationReason: extra.terminationReason ?? 'normal',
      playerResults: playerResults(state),
    } : {}),
  };
}

function commandValidation({ state,command,actorUserId }) {
  if (state.winner) return { valid: false,code: 'MATCH_COMPLETED',message: '本局已经结束。' };
  const color = colorFor(state,actorUserId);
  if (!color) return { valid: false,code: 'PLAYER_NOT_SEATED',message: '你不是本局玩家。' };
  if (state.turn !== color) return { valid: false,code: 'NOT_YOUR_TURN',message: '还没有轮到你行动。' };
  if (!command || typeof command !== 'object' || Array.isArray(command)) return { valid: false,code: 'COMMAND_INVALID',message: '命令格式无效。' };
  if (!['reveal','scout','move'].includes(command.type)) return { valid: false,code: 'COMMAND_UNKNOWN',message: '未知的迷阵命令。' };
  if (!Number.isInteger(command.pieceId) || command.pieceId < 0 || command.pieceId >= 32) return { valid: false,code: 'PIECE_INVALID',message: '棋子编号无效。' };
  const piece = state.pieces.find(item => item.id === command.pieceId);
  if (!piece) return { valid: false,code: 'PIECE_NOT_FOUND',message: '棋子不存在或已被吃掉。' };
  if (command.type === 'reveal') {
    if (piece.revealed || state.decision) return { valid: false,code: 'PIECE_ALREADY_REVEALED',message: '该棋子已经公开。' };
    const cost = exploreCost(state,color,piece.pos);
    if (state.cmd[color] < cost) return { valid: false,code: 'COMMAND_POINTS_INSUFFICIENT',message: `翻棋需要${cost}点军令。` };
  }
  if (command.type === 'scout') {
    if (piece.revealed) return { valid: false,code: 'SCOUT_TARGET_INVALID',message: '只能侦察暗棋。' };
    if (state.intel[color] < 2) return { valid: false,code: 'INTEL_INSUFFICIENT',message: '秘密侦察需要2枚情报。' };
  }
  if (command.type === 'move') {
    if (!piece.revealed || piece.color !== color) return { valid: false,code: 'PIECE_NOT_CONTROLLED',message: '只能移动己方明棋。' };
    if (!Number.isInteger(command.to) || command.to < 0 || command.to >= ROWS * COLS) return { valid: false,code: 'DESTINATION_INVALID',message: '目标位置无效。' };
    if (!legalMoves(state,piece).has(command.to)) return { valid: false,code: 'MOVE_ILLEGAL',message: '该棋子不能移动到目标位置。' };
  }
  return { valid: true };
}

function createInitialState(input) {
  const players = [...(input?.players ?? [])].sort((a,b) => Number(a.seat) - Number(b.seat));
  if (players.length !== 2 || !players[0]?.userId || !players[1]?.userId || players[0].userId === players[1].userId) throw new TypeError('迷阵双人模式需要两个不同玩家。');
  const seconds = Number(input?.settings?.turnSeconds ?? 90);
  const state = {
    schemaVersion: 1,
    players: { red: players[0].userId,black: players[1].userId },
    pieces: createPieces(input.seed),
    turn: 'red',round: 1,half: 0,ply: 0,
    started: { red: false,black: false },cmd: { red: 3,black: 3 },intel: { red: 0,black: 0 },
    captured: [],decision: false,noCapture: 0,stalled: 0,winner: null,finishReason: null,score: null,
    scouted: { red: {},black: {} },timeoutStrikes: { red: 0,black: 0 },
    turnSeconds: Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600 ? seconds : 90,
  };
  beginTurn(state);
  return state;
}

function applyCommand({ state: original,command,actorUserId }) {
  const state = clone(original);
  const validation = commandValidation({ state,command,actorUserId });
  if (!validation.valid) throw Object.assign(new Error(validation.message), { code: validation.code });
  const color = colorFor(state,actorUserId), piece = state.pieces.find(item => item.id === command.pieceId);
  let event;
  if (command.type === 'reveal') {
    const cost = exploreCost(state,color,piece.pos);
    state.cmd[color] -= cost; piece.revealed = true; piece.prep = piece.type === 'general' ? 2 : 1; piece.revealedPly = state.ply;
    const hostile = piece.color !== color;
    if (hostile) state.intel[color] += 1;
    event = { type: 'mizhen.piece.revealed',actorColor: color,piece: { id: piece.id,pos: piece.pos,color: piece.color,type: piece.type },cost,hostile };
    event.skipped = advance(state,false);
  } else if (command.type === 'scout') {
    state.intel[color] -= 2; state.scouted[color][piece.id] = true;
    event = { type: 'mizhen.piece.scouted',actorColor: color,pieceId: piece.id,cost: 2 };
    event.skipped = advance(state,false);
  } else {
    const from = piece.pos, target = pieceAt(state,command.to);
    if (target) {
      state.captured.push(clone(target)); state.pieces = state.pieces.filter(item => item.id !== target.id);
      if (target.type !== 'general') state.cmd[color] = Math.min(MAX_COMMAND,state.cmd[color] + 1);
    }
    piece.pos = command.to; piece.prep = 0;
    event = { type: target ? 'mizhen.piece.captured' : 'mizhen.piece.moved',actorColor: color,pieceId: piece.id,from,to: command.to,...(target ? { captured: { id: target.id,color: target.color,type: target.type } } : {}) };
    if (target?.type === 'general') { state.winner = color; state.finishReason = 'general_captured'; }
    else event.skipped = advance(state,Boolean(target));
  }
  return transition(state,event);
}

function viewFor(state, userId = null) {
  const color = colorFor(state,userId);
  const known = color ? state.scouted[color] : {};
  const pieces = state.pieces.map(piece => {
    if (piece.revealed || known[piece.id]) return clone(piece);
    return { id: piece.id,pos: piece.pos,revealed: false,prep: 0,revealedPly: -1 };
  });
  const remaining = { red: state.pieces.filter(piece => piece.color === 'red').length,black: state.pieces.filter(piece => piece.color === 'black').length };
  return {
    schemaVersion: state.schemaVersion,pieces,turn: state.turn,turnUserId: userFor(state,state.turn),round: state.round,half: state.half,ply: state.ply,
    cmd: clone(state.cmd),intel: clone(state.intel),captured: clone(state.captured),decision: state.decision,noCapture: state.noCapture,
    winner: state.winner,finishReason: state.finishReason,score: clone(state.score),remaining,timeoutStrikes: clone(state.timeoutStrikes),
    ownColor: color,canAct: Boolean(color && color === state.turn && !state.winner),
    scouted: color ? { red: color === 'red' ? clone(state.scouted.red) : {},black: color === 'black' ? clone(state.scouted.black) : {} } : { red: {},black: {} },
  };
}

function handleResign({ state: original,actorUserId }) {
  const state = clone(original), color = colorFor(state,actorUserId);
  if (!color) throw new Error('Player is not seated.');
  state.winner = other(color); state.finishReason = 'resignation';
  return transition(state,{ type: 'mizhen.player.resigned',actorColor: color },{ terminationReason: 'resignation' });
}

function handleTimeout({ state: original,turnUserId }) {
  const state = clone(original), color = colorFor(state,turnUserId);
  if (!color || color !== state.turn) throw new Error('Timeout player is not the current player.');
  state.timeoutStrikes[color] += 1;
  const event = { type: 'mizhen.turn.timed_out',actorColor: color,strikes: state.timeoutStrikes[color] };
  if (state.timeoutStrikes[color] >= 3) { state.winner = other(color); state.finishReason = 'three_timeouts'; return transition(state,event,{ terminationReason: 'timeout' }); }
  event.skipped = advance(state,false);
  return transition(state,event);
}

const rulesAdapter = {
  workId: WORK_ID,
  modeKey: MODE_KEY,
  rulesetVersion: RULESET_VERSION,
  createInitialState,
  getTurn: state => ({ userId: userFor(state,state.turn),seconds: state.turnSeconds }),
  getPlayerView: (state,userId) => viewFor(state,userId),
  getSpectatorView: state => viewFor(state,null),
  serializeState: state => clone(state),
  deserializeState: value => {
    const state = clone(value);
    if (state?.schemaVersion !== 1 || !Array.isArray(state.pieces) || !state.players?.red || !state.players?.black) throw new TypeError('Invalid 迷阵 state.');
    return state;
  },
  hashState: state => sha256(canonicalJson(state)),
  validateCommand: commandValidation,
  applyCommand,
  handleResign,
  handleTimeout,
};

module.exports = rulesAdapter;
