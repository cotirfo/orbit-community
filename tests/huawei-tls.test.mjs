import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createPinnedHuaweiAgent } from '../huawei-tls.mjs';

const raw = Buffer.from('isolated mock TLS leaf certificate');
const fingerprint = createHash('sha256').update(raw).digest('hex');
const time = Date.UTC(2026, 9, 12);
const certificate = () => ({ raw, valid_from: 'Jan 1 00:00:00 2026 GMT', valid_to: 'Jan 1 00:00:00 2027 GMT' });

class FakeSocket extends EventEmitter {
  constructor(cert = certificate()) { super(); this.cert = cert; this.destroyed = false; this.writes = []; }
  getPeerCertificate() { return this.cert; }
  write(value) { this.writes.push(value); }
  destroy() { this.destroyed = true; queueMicrotask(() => this.emit('close')); }
}

function fixture(t, { cert = certificate(), timeoutMs = 1000, connectError, now = () => time } = {}) {
  const socket = new FakeSocket(cert), calls = [];
  let options;
  const agent = createPinnedHuaweiAgent({ fingerprint, timeoutMs, now, connect: opts => {
    options = opts;
    if (connectError) throw connectError;
    return socket;
  } });
  t.after(() => agent.destroy());
  const returned = agent.createConnection({ host: 'fixture.invalid', port: 443, minVersion: 'TLSv1', rejectUnauthorized: true }, (error, received) => {
    calls.push({ error, socket: received });
    if (received) received.write('POST /fixture HTTP/1.1\r\nCookie: fixture-only\r\n\r\nfixture-body');
  });
  return { socket, calls, returned, agent, options };
}

test('pin configuration accepts only complete SHA256 encodings', () => {
  for (const bad of [undefined, null, {}, '', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), fingerprint + '\n', 'sha256:' + fingerprint]) {
    assert.throws(() => createPinnedHuaweiAgent({ fingerprint: bad }), { code: 'HUAWEI_TLS_PIN_INVALID' });
  }
  const colon = fingerprint.toUpperCase().match(/../g).join(':');
  for (const pin of [fingerprint, colon]) {
    const agent = createPinnedHuaweiAgent({ fingerprint: pin });
    assert.ok(agent instanceof https.Agent);
    assert.equal(agent.keepAlive, true);
    assert.equal(agent.maxSockets, 1);
    agent.destroy();
  }
});

test('valid pin releases asynchronously only after TLS and validity checks', async t => {
  const f = fixture(t);
  assert.equal(f.returned, undefined);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.socket.writes, []);
  assert.equal(f.options.minVersion, 'TLSv1.2');
  assert.equal(f.options.rejectUnauthorized, false);
  f.socket.emit('connect');
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.socket.writes, []);
  f.socket.emit('secureConnect');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].error, null);
  assert.equal(f.calls[0].socket, f.socket);
  assert.equal(f.socket.writes.length, 1);
  f.socket.emit('secureConnect');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 1);
});

test('forged advertised fingerprint cannot bypass hashing actual raw certificate', async t => {
  const f = fixture(t, { cert: { ...certificate(), raw: Buffer.from('different malicious leaf'), fingerprint256: fingerprint } });
  f.socket.emit('secureConnect');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].error.code, 'HUAWEI_TLS_PIN_MISMATCH');
  assert.equal(f.calls[0].socket, undefined);
  assert.equal(f.socket.destroyed, true);
  assert.deepEqual(f.socket.writes, []);
  f.socket.emit('error', new Error('late socket failure'));
  f.socket.emit('secureConnect');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
});

test('expired, future, malformed and missing peer certificates never release socket', async t => {
  const cases = [
    { ...certificate(), valid_to: 'Jul 1 00:00:00 2026 GMT' },
    { ...certificate(), valid_from: 'Dec 1 00:00:00 2026 GMT' },
    { ...certificate(), valid_to: 'invalid date' },
    { ...certificate(), valid_from: undefined },
    { ...certificate(), raw: Buffer.alloc(0) },
    {},
  ];
  for (const cert of cases) {
    const f = fixture(t, { cert });
    f.socket.emit('secureConnect');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].error.code, 'HUAWEI_TLS_CERT_INVALID');
    assert.equal(f.socket.destroyed, true);
    assert.deepEqual(f.socket.writes, []);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('handshake deadline destroys socket and reports exactly one error without writes', async t => {
  const f = fixture(t, { timeoutMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].error.code, 'HUAWEI_TLS_TIMEOUT');
  assert.equal(f.socket.destroyed, true);
  assert.deepEqual(f.socket.writes, []);
  f.socket.emit('secureConnect');
  assert.equal(f.calls.length, 1);
});

test('socket errors, close, timeout and synchronous connection failures fail once', async t => {
  for (const event of ['error', 'close', 'timeout']) {
    const f = fixture(t);
    f.socket.emit(event, new Error('fixture failure'));
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].error instanceof Error);
    assert.equal(f.socket.destroyed, true);
    assert.deepEqual(f.socket.writes, []);
    f.socket.emit('secureConnect');
    assert.equal(f.calls.length, 1);
  }
  const error = new Error('synchronous connect failure');
  const f = fixture(t, { connectError: error });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].error, error);
  assert.deepEqual(f.socket.writes, []);
  await new Promise(resolve => setImmediate(resolve));
});

test('agent destruction aborts TLS validation in progress without releasing socket', async t => {
  const f = fixture(t);
  f.agent.destroy();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].error.code, 'HUAWEI_TLS_CLOSED');
  assert.equal(f.socket.destroyed, true);
  assert.deepEqual(f.socket.writes, []);
  f.socket.emit('secureConnect');
  f.agent.destroy();
  assert.equal(f.calls.length, 1);
});

test('actual HTTPS request with queued headers and body receives no unverified socket', async t => {
  const socket = new FakeSocket({ ...certificate(), raw: Buffer.from('attacker leaf') });
  const agent = createPinnedHuaweiAgent({ fingerprint, now: () => time, connect: () => socket });
  t.after(() => agent.destroy());
  let deliveredSockets = 0;
  const request = https.request('https://fixture.invalid/fixture', {
    agent, method: 'POST', headers: { Cookie: 'fixture-only', 'Content-Type': 'application/json' },
  });
  request.on('socket', () => deliveredSockets++);
  const failed = new Promise(resolve => request.once('error', resolve));
  request.end('{"fixture":"queued-body"}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deliveredSockets, 0);
  assert.deepEqual(socket.writes, []);
  socket.emit('secureConnect');
  const error = await failed;
  assert.equal(error.code, 'HUAWEI_TLS_PIN_MISMATCH');
  assert.equal(deliveredSockets, 0);
  assert.equal(socket.destroyed, true);
  assert.deepEqual(socket.writes, []);
});
