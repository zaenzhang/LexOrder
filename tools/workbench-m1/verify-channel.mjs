import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { startPrivatePostgres } from './private-pg.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [];
const credential = randomBytes(32).toString('hex');
const startupBody = Buffer.from('user\0postgres\0database\0postgres\0client_encoding\0UTF8\0\0');
const startup = Buffer.alloc(8 + startupBody.length);
startup.writeInt32BE(startup.length, 0); startup.writeInt32BE(196608, 4); startupBody.copy(startup, 8);
function frame(type, value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const result = Buffer.alloc(5 + payload.length); result[0] = type.charCodeAt(0);
  result.writeInt32BE(payload.length + 4, 1); payload.copy(result, 5); return result;
}
const password = value => frame('p', value + '\0');
const query = sql => frame('Q', sql + '\0');
function rows(messages) {
  return messages.filter(message => message.type === 'D').map(({ payload }) => {
    const row = []; let offset = 2;
    for (let i = 0; i < payload.readInt16BE(0); i++) {
      const length = payload.readInt32BE(offset); offset += 4;
      row.push(length === -1 ? null : payload.subarray(offset, offset + length).toString());
      if (length !== -1) offset += length;
    }
    return row;
  });
}
class Client {
  constructor(port) {
    this.socket = net.connect({ host: '127.0.0.1', port }); this.socket.setNoDelay(true);
    this.messages = []; this.buffer = Buffer.alloc(0); this.closed = false; this.errors = [];
    this.connected = new Promise((resolve, reject) => { this.socket.once('connect', resolve); this.socket.once('error', reject); });
    this.closedPromise = new Promise(resolve => this.socket.once('close', () => { this.closed = true; resolve(); }));
    this.socket.on('error', error => this.errors.push(error.code));
    this.socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 5) {
        const size = this.buffer.readInt32BE(1) + 1;
        if (this.buffer.length < size) break;
        this.messages.push({ type: String.fromCharCode(this.buffer[0]), payload: Buffer.from(this.buffer.subarray(5, size)) });
        this.buffer = this.buffer.subarray(size);
      }
    });
  }
  async takeUntil(predicate, timeout = 5000) {
    const end = Date.now() + timeout, seen = [];
    while (Date.now() < end) {
      while (this.messages.length) {
        const message = this.messages.shift(); seen.push(message);
        if (predicate(message)) return seen;
      }
      if (this.closed) throw new Error('Connection closed before expected message');
      await wait(2);
    }
    throw new Error('Protocol response timed out');
  }
  async sendSplit(buffer) {
    for (let offset = 0; offset < buffer.length; offset++) {
      this.socket.write(buffer.subarray(offset, offset + 1)); await wait(1);
    }
  }
  async challenge(split = false) {
    await this.connected;
    if (split) await this.sendSplit(startup); else this.socket.write(startup);
    const response = await this.takeUntil(message => message.type === 'R');
    assert.equal(response.at(-1).payload.readInt32BE(0), 3);
  }
  async auth(split = false) {
    await this.challenge(split);
    if (split) await this.sendSplit(password(credential)); else this.socket.write(password(credential));
    await this.takeUntil(message => message.type === 'Z');
  }
  async sql(sql, split = false) {
    if (split) await this.sendSplit(query(sql)); else this.socket.write(query(sql));
    return this.takeUntil(message => message.type === 'Z');
  }
  async close() { this.socket.destroy(); await this.closedPromise; }
}
async function boundedClose(client) {
  await Promise.race([client.closedPromise, wait(5000).then(() => { throw new Error('Rejected connection did not close'); })]);
}

let db, gateway;
let protocolCalls = 0, fatalCalls = 0, failNextQuery = false;
const clients = new Set();
function connect() { const client = new Client(gateway.port); clients.add(client); return client; }
const timeout = setTimeout(() => { console.error('FAIL global timeout'); process.exit(1); }, 45000);
try {
  db = await PGlite.create();
  await db.exec('CREATE TABLE gateway_probe(id integer PRIMARY KEY)');
  const wrapped = {
    waitReady: db.waitReady,
    runExclusive: fn => db.runExclusive(fn),
    execProtocolRawStream: (bytes, options) => {
      protocolCalls++;
      if (failNextQuery && bytes[0] === 81) { failNextQuery = false; throw new Error('Injected engine failure'); }
      return db.execProtocolRawStream(bytes, options);
    },
    isInTransaction: () => db.isInTransaction(),
    exec: sql => db.exec(sql),
  };
  gateway = await startPrivatePostgres(wrapped, credential, () => fatalCalls++);
  {
    const client = connect(), before = protocolCalls;
    await client.challenge();
    client.socket.write(Buffer.concat([password('0'.repeat(64)), query('INSERT INTO gateway_probe VALUES(90)'), password(credential), query('INSERT INTO gateway_probe VALUES(91)')]));
    await boundedClose(client);
    assert.equal(protocolCalls, before); assert.equal(fatalCalls, 0);
    reports.push({ check: 'wrong_credential_followed_by_query_and_correct_credential_is_terminal', status: 'PASS', rawDatabaseCalls: 0 });
  }
  {
    const client = connect(), before = protocolCalls;
    await client.challenge(); client.socket.write(query('INSERT INTO gateway_probe VALUES(92)'));
    await boundedClose(client); assert.equal(protocolCalls, before);
    reports.push({ check: 'query_in_password_stage_never_reaches_database', status: 'PASS', rawDatabaseCalls: 0 });
  }
  {
    const client = connect(), before = protocolCalls;
    await client.connected; client.socket.write(query('INSERT INTO gateway_probe VALUES(93)'));
    await boundedClose(client); assert.equal(protocolCalls, before);
    reports.push({ check: 'query_before_startup_never_reaches_database', status: 'PASS', rawDatabaseCalls: 0 });
  }
  const owner = connect();
  await owner.auth(true);
  assert.deepEqual(rows(await owner.sql('SELECT 123 AS number', true)), [['123']]);
  reports.push({ check: 'one_byte_startup_password_and_query_frames', status: 'PASS' });
  {
    const other = connect(), before = protocolCalls;
    await other.challenge(); other.socket.write(password(credential)); await boundedClose(other);
    assert.equal(protocolCalls, before); assert.deepEqual(rows(await owner.sql('SELECT 456')), [['456']]);
    reports.push({ check: 'second_authenticated_session_rejected_current_owner_continues', status: 'PASS' });
  }
  {
    const error = await owner.sql('SELECT 1 / 0');
    assert.ok(error.some(message => message.type === 'E'));
    assert.deepEqual(rows(await owner.sql('SELECT 789')), [['789']]); assert.equal(fatalCalls, 0);
    reports.push({ check: 'ordinary_sql_error_does_not_poison_session', status: 'PASS' });
  }
  await owner.sql('INSERT INTO gateway_probe VALUES(1)');
  await owner.sql('BEGIN'); await owner.sql('INSERT INTO gateway_probe VALUES(2)');
  assert.equal(db.isInTransaction(), true);
  assert.deepEqual(rows(await owner.sql('SELECT count(*) FROM gateway_probe')), [['2']]);
  // A migration probe can still own the socket when the next authenticated
  // connection arrives. Its uncommitted row must disappear before handoff.
  const successor = connect(); await successor.challenge();
  successor.socket.write(password(credential));
  await wait(20);
  await owner.close();
  await successor.takeUntil(message => message.type === 'Z');
  assert.equal(db.isInTransaction(), false);
  assert.deepEqual(rows(await successor.sql('SELECT id FROM gateway_probe ORDER BY id')), [['1']]);
  reports.push({ check: 'overlapping_successor_waits_for_rollback_and_reads_only_committed_row', status: 'PASS' });
  {
    failNextQuery = true; successor.socket.write(query('SELECT 1000')); await boundedClose(successor);
    assert.equal(fatalCalls, 1);
    const before = protocolCalls, afterFailure = connect(); await afterFailure.connected;
    afterFailure.socket.write(Buffer.concat([startup, password(credential), query('SELECT 1001')]));
    await boundedClose(afterFailure); assert.equal(protocolCalls, before);
    reports.push({ check: 'injected_engine_exception_closes_owner_and_rejects_future_connections', status: 'PASS', fatalCallbacks: fatalCalls });
  }
  console.log(JSON.stringify({ status: 'PASS', engine: 'PGlite 0.5.16', transport: 'actual loopback PostgreSQL frames', checks: reports }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', checks: reports, error: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.close();
  await gateway?.stop(); await db?.close(); clearTimeout(timeout);
}
