// M1 loopback transport. The random process credential is not a user account.
// PostgreSQL v3 startup/password framing + PGlite's public raw-protocol API.
import { createServer } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

function errorPacket() {
  const payload = Buffer.from('SFATAL\0C28000\0MLocal channel rejected\0\0');
  const packet = Buffer.alloc(5 + payload.length); packet[0] = 69;
  packet.writeInt32BE(payload.length + 4, 1); payload.copy(packet, 5); return packet;
}
export async function startPrivatePostgres(db, credential, onFatal = () => undefined) {
  if (!/^[a-f0-9]{64}$/.test(credential)) throw new Error('INVALID_CHANNEL_CREDENTIAL');
  await db.waitReady;
  const sockets = new Set();
  let owner, serial = Promise.resolve(), closing = false, failed = false;
  const server = createServer(socket => {
    if (closing || failed || sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket);
    let buffer = Buffer.alloc(0), startup, stage = 'startup', processing = false;
    const timer = setTimeout(() => socket.destroy(), 5000);
    const reject = () => { stage = 'closed'; buffer = Buffer.alloc(0); clearTimeout(timer); socket.end(errorPacket()); socket.destroySoon(); };
    const execute = frame => {
      const task = serial.then(async () => {
        if (socket.destroyed || failed || owner !== socket) return;
        await db.runExclusive(() => db.execProtocolRawStream(frame, {
          onRawData(bytes) { if (!socket.destroyed && owner === socket) socket.write(Buffer.from(bytes)); },
        }));
      });
      serial = task.catch(() => { failed = true; socket.destroy(); onFatal(); });
    };
    socket.on('error', () => socket.destroy());
    socket.once('close', () => {
      clearTimeout(timer); sockets.delete(socket);
      if (owner === socket) {
        serial = serial.then(async () => {
          if (db.isInTransaction()) await db.exec('ROLLBACK');
          if (owner === socket) owner = undefined;
        }).catch(() => { failed = true; onFatal(); });
      }
    });
    const drain = async () => {
      if (processing) return;
      processing = true;
      try {
        while (!socket.destroyed && stage !== 'closed' && !closing && !failed) {
          if (stage === 'startup') {
            if (buffer.length < 8) break;
            const size = buffer.readInt32BE(0), protocol = buffer.readInt32BE(4);
            if (size < 8 || size > 16_384) { reject(); break; }
            if (buffer.length < size) break;
            if (size === 8 && [80877103, 80877104].includes(protocol)) {
              // No TLS/GSS on this loopback-only transport. Prisma uses sslmode=disable.
              socket.write('N'); buffer = buffer.subarray(size); continue;
            }
            if (protocol !== 196608 || buffer[size - 1] !== 0) { reject(); break; }
            startup = Buffer.from(buffer.subarray(0, size)); buffer = buffer.subarray(size);
            const challenge = Buffer.alloc(9); challenge[0] = 82; challenge.writeInt32BE(8, 1); challenge.writeInt32BE(3, 5);
            stage = 'password'; socket.write(challenge); continue;
          }
          if (buffer.length < 5) break;
          const size = buffer.readInt32BE(1) + 1;
          if (size < 5 || size > (stage === 'password' ? 1024 : 32 * 1024 * 1024)) { reject(); break; }
          if (buffer.length < size) break;
          const frame = Buffer.from(buffer.subarray(0, size)); buffer = buffer.subarray(size);
          if (stage === 'password') {
            const password = frame.subarray(5, -1), expected = Buffer.from(credential);
            if (frame[0] !== 112 || frame.at(-1) !== 0 || password.length !== expected.length || !timingSafeEqual(password, expected)) { reject(); break; }
            // A closed previous socket may still be finishing its rollback.
            if (owner?.destroyed) await serial;
            if (owner || socket.destroyed || closing || failed) { reject(); break; }
            owner = socket; clearTimeout(timer); stage = 'ready'; execute(startup);
          } else execute(frame);
        }
      } catch { failed = true; socket.destroy(); onFatal(); }
      finally { processing = false; }
    };
    socket.on('data', chunk => {
      if (buffer.length + chunk.length > 32 * 1024 * 1024) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]); void drain();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    async stop() {
      closing = true;
      const stopped = new Promise(resolve => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await stopped; await serial;
      if (db.isInTransaction()) await db.exec('ROLLBACK');
    },
  };
}
