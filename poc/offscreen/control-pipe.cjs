'use strict';
const net = require('node:net');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createRuntimeReader } = require('./transport.cjs');

// The protocol does not depend on Windows GUI standard handles. No TCP listener.
async function createControlPipe() {
  if (process.platform !== 'win32') throw new Error('This probe requires Windows named pipes');
  const name = '\\\\.\\pipe\\gamehub-offscreen-' + randomUUID();
  const token = randomBytes(32).toString('hex');
  const events = new EventEmitter(), sockets = new Set();
  let channel, closing = false;
  const server = net.createServer(socket => {
    if (channel || closing) return socket.destroy();
    sockets.add(socket);
    let pending = Buffer.alloc(0), authenticated = false;
    const reader = createRuntimeReader(packet => events.emit('packet', packet), error => {
      events.emit('failure', error); socket.destroy();
    });
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', error => { if (authenticated && !closing) events.emit('failure', error); });
    socket.on('close', () => {
      sockets.delete(socket);
      if (authenticated && !closing) events.emit('disconnected');
    });
    socket.on('data', chunk => {
      if (authenticated) return reader.push(chunk);
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf(10);
      if (end < 0) { if (pending.length > 1024) socket.destroy(); return; }
      if (end > 1024) return socket.destroy();
      try {
        const hello = JSON.parse(pending.subarray(0, end).toString('utf8'));
        if (hello.type !== 'hello' || typeof hello.token !== 'string' ||
            !/^[a-f0-9]{64}$/.test(hello.token) ||
            !timingSafeEqual(Buffer.from(hello.token), Buffer.from(token)) || channel) return socket.destroy();
        authenticated = true; channel = socket; socket.setTimeout(0);
        for (const other of sockets) if (other !== socket) other.destroy();
        events.emit('connected');
        reader.push(pending.subarray(end + 1)); pending = Buffer.alloc(0);
      } catch { socket.destroy(); }
    });
  });
  server.maxConnections = 4;
  const closed = new Promise(resolve => server.once('close', resolve));
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(name, resolve);
  });
  server.on('error', error => { if (!closing) events.emit('failure', error); });
  return {
    name, token, events,
    send(command) {
      if (!channel || channel.destroyed || closing) return false;
      // Commands are tiny and generated locally. Stop if the peer cannot consume them.
      if (channel.writableLength > 16 * 1024) { events.emit('failure', new Error('Control pipe backpressure')); return false; }
      return channel.write(JSON.stringify(command) + '\n');
    },
    async close() {
      if (!closing) {
        closing = true;
        for (const socket of sockets) socket.destroy();
        server.close();
      }
      await closed;
    },
  };
}

module.exports = { createControlPipe };
