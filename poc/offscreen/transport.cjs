'use strict';
const { StringDecoder } = require('node:string_decoder');
const { validateCommand } = require('./protocol.cjs');

function createJsonLineReader(onMessage, onFailure, maxBytes, skipEmpty = false) {
  const decoder = new StringDecoder('utf8');
  let buffer = '', failed = false;
  return {
    push(chunk) {
      if (failed) return;
      try {
        // Process line by line: a single chunk may legitimately contain many commands.
        for (const part of decoder.write(chunk).split(/(?<=\n)/)) {
          buffer += part;
          if (Buffer.byteLength(buffer, 'utf8') > maxBytes) throw new Error('Message too large');
          if (buffer.endsWith('\n')) {
            if (!skipEmpty || buffer.trim()) onMessage(JSON.parse(buffer));
            buffer = '';
          }
        }
      } catch (error) { failed = true; buffer = ''; onFailure(error); }
    },
  };
}

function createLineReader(onCommand, onFailure) {
  return createJsonLineReader(value => onCommand(validateCommand(value)), onFailure, 2048);
}

function createRuntimeReader(onPacket, onFailure) {
  const types = new Set(['runtime', 'ready', 'frame', 'applied', 'pong', 'stopped']);
  return createJsonLineReader(packet => {
    if (!packet || !types.has(packet.type)) throw new Error('Unknown runtime message');
    onPacket(packet);
  }, onFailure, 3 * 1024 * 1024, true);
}

function createOutputWriter(stream, onFailure) {
  let blocked = false, latestFrame = null, failed = false;
  const controls = [];
  function fail() { if (!failed) { failed = true; controls.length = 0; latestFrame = null; onFailure(); } }
  function write(message) {
    try { blocked = !stream.write(JSON.stringify(message) + '\n'); }
    catch { fail(); }
  }
  stream.on('drain', () => {
    if (failed) return;
    blocked = false;
    while (!blocked && !failed && controls.length) write(controls.shift());
    if (!blocked && !failed && latestFrame) {
      const frame = latestFrame; latestFrame = null; write(frame);
    }
  });
  return {
    send(message) {
      if (failed) return;
      if (!blocked) return write(message);
      // Bound memory if the host stops consuming. Never replay a backlog of stale images.
      if (message.type === 'frame') latestFrame = message;
      else if (controls.length < 64) controls.push(message);
      else fail();
    },
  };
}

module.exports = { createLineReader, createRuntimeReader, createOutputWriter };
