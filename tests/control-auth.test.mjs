import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createControlAuth } from '../control-auth.mjs';

const work = os.tmpdir();
const password = 'Senha-local-ORBIT-2026';
const local = '127.0.0.1';

test('authenticated session status restores CSRF for a new tab without exposing it anonymously',async t=>{
 const {auth}=await fixture(t,{remoteAllowed:true});const issued=await auth.setup({password,ip:local});
 const restored=auth.status({token:issued.token,ip:local});assert.equal(restored.csrf,issued.csrf);assert.equal(restored.authenticated,true);
 auth.authorize({token:issued.token,ip:local,csrf:restored.csrf,write:true});
 assert.equal(auth.status({ip:local}).csrf,undefined);assert.equal(auth.status({token:issued.token,ip:'192.168.3.20'}).csrf,undefined);
 auth.logout({token:issued.token});assert.equal(auth.status({token:issued.token,ip:local}).csrf,undefined);
});

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(work, 'control-auth-fixture-'));
  t.after(async () => {
    const target = resolve(root);
    assert.ok(target.startsWith(resolve(work) + sep));
    await rm(target, { recursive: true, force: true });
  });
  return { root, auth: await createControlAuth({ root, ...options }) };
}

test('first setup is local-only even when remote control is enabled', async t => {
  const { auth, root } = await fixture(t, { remoteAllowed: true });
  await assert.rejects(auth.setup({ password, ip: '192.168.3.107' }), { status: 403 });
  for (const bad of ['127.0.0.1.evil', 'localhost', '', undefined]) {
    await assert.rejects(auth.setup({ password, ip: bad }), { status: 403 });
  }
  await assert.rejects(auth.setup({ password: 'short', ip: local }), { status: 400 });
  await assert.rejects(auth.setup({ password: 'x'.repeat(257), ip: local }), { status: 400 });
  const session = await auth.setup({ password, ip: '::ffff:127.0.0.1' });
  assert.equal(session.token.length, 43);
  assert.equal(session.csrf.length, 43);
  assert.notEqual(session.token, session.csrf);
  assert.equal(auth.status({ token: session.token, ip: local }).authenticated, true);
  await assert.rejects(auth.setup({ password, ip: local }), { status: 409 });
  const stored = JSON.parse(await readFile(join(root, 'data', 'control-auth.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored).sort(), ['hash', 'salt', 'version']);
  assert.equal(stored.salt.length, 64);
  assert.equal(stored.hash.length, 128);
  assert.ok(!JSON.stringify(stored).includes(password));
});

test('password hash persists; status exposes only the authenticated callers CSRF', async t => {
  const { auth, root } = await fixture(t);
  const first = await auth.setup({ password, ip: local });
  const publicStatus = auth.status();
  const privateStatus = auth.status({ token: first.token, ip: local });
  assert.deepEqual(publicStatus, { configured: true, authenticated: false, remoteAllowed: false, expiresAt: null });
  for (const status of [publicStatus, privateStatus]) {
    const serialized = JSON.stringify(status);
    for (const secret of [password, first.token]) assert.ok(!serialized.includes(secret));
    assert.equal('salt' in status, false);
    assert.equal('hash' in status, false);
    assert.equal('ip' in status, false);
  }
  assert.equal(publicStatus.csrf,undefined);
  assert.equal(privateStatus.csrf,first.csrf);
  const next = await createControlAuth({ root });
  assert.equal(next.status({ token: first.token, ip: local }).authenticated, false);
  const renewed = await next.login({ password, ip: local });
  assert.equal(next.authorize({ token: renewed.token, ip: local }).authenticated, true);
  await assert.rejects(next.setup({ password, ip: local }), { status: 409 });
});

test('writes require separate csrf token; session bound to IP; logout revokes', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  const { code } = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  const remote = auth.pair({ code, ip: '192.168.3.109' });
  assert.equal(auth.authorize({ token: remote.token, ip: '192.168.3.109' }).authenticated, true);
  assert.throws(() => auth.authorize({ token: remote.token, ip: '192.168.3.110' }), { status: 401 });
  for (const csrf of [undefined, 'bad', remote.token]) {
    assert.throws(() => auth.authorize({ token: remote.token, ip: '192.168.3.109', write: true, csrf }), { status: 403 });
  }
  assert.equal(auth.authorize({ token: remote.token, ip: '192.168.3.109', write: true, csrf: remote.csrf }).authenticated, true);
  auth.logout({ token: remote.token });
  assert.equal(auth.status({ token: remote.token, ip: '192.168.3.109' }).authenticated, false);
  assert.throws(() => auth.authorize({ token: remote.token, ip: '192.168.3.109' }), { status: 401 });
});

test('remote controls and login are disabled by default', async t => {
  const { auth } = await fixture(t);
  const session = await auth.setup({ password, ip: '::1' });
  await assert.rejects(auth.login({ password, ip: '192.168.3.107' }), { status: 403 });
  assert.throws(() => auth.authorize({ token: session.token, ip: '192.168.3.107' }), { status: 403 });
  assert.equal(auth.status({ token: session.token, ip: '192.168.3.107' }).authenticated, false);
});

test('wrong passwords and malformed inputs are limited per IP for fifteen minutes', async t => {
  let time = 1_000_000;
  const { auth } = await fixture(t, { now: () => time });
  await auth.setup({ password, ip: local });
  for (const bad of ['invalid-long-password', null, {}, 'x'.repeat(257), 'short']) {
    await assert.rejects(auth.login({ password: bad, ip: local }), { status: 401, code: 'INVALID_CREDENTIALS' });
  }
  await assert.rejects(auth.login({ password, ip: local }), { status: 429 });
  time += 15 * 60 * 1000;
  const session = await auth.login({ password, ip: local });
  assert.equal(auth.status({ token: session.token, ip: local }).authenticated, true);
});

test('concurrent successful login clears only its own attempt, preserving failures', async t => {
  const { auth } = await fixture(t);
  await auth.setup({ password, ip: local });
  for (let index = 0; index < 3; index++) await assert.rejects(auth.login({ password: 'incorrect-password', ip: local }), { status: 401 });
  const results = await Promise.allSettled([
    auth.login({ password, ip: local }),
    auth.login({ password: 'incorrect-password', ip: local }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.status, 401);
  await assert.rejects(auth.login({ password: 'incorrect-password', ip: local }), { status: 401 });
  await assert.rejects(auth.login({ password, ip: local }), { status: 429 });
});

test('global limit caps attempts across different remote addresses', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  await auth.setup({ password, ip: local });
  for (let index = 1; index <= 20; index++) {
    assert.throws(() => auth.pair({ code: 'incorrect', ip: `192.168.3.${index}` }), { status: 401 });
  }
  await assert.rejects(auth.login({ password, ip: local }), { status: 429 });
});

test('session expires after thirty minutes without sliding extension', async t => {
  let time = 1000;
  const { auth } = await fixture(t, { now: () => time });
  const session = await auth.setup({ password, ip: local });
  assert.equal(session.expiresAt, time + 30 * 60 * 1000);
  time = session.expiresAt - 1;
  assert.equal(auth.authorize({ token: session.token, ip: local }).expiresAt, session.expiresAt);
  time += 1;
  assert.throws(() => auth.authorize({ token: session.token, ip: local }), { status: 401 });
  assert.equal(auth.status({ token: session.token, ip: local }).expiresAt, null);
});

test('only three active sessions per IP; oldest session is evicted', async t => {
  const { auth } = await fixture(t);
  const first = await auth.setup({ password, ip: local });
  const sessions = [first];
  for (let index = 0; index < 3; index++) sessions.push(await auth.login({ password, ip: local }));
  assert.equal(auth.status({ token: first.token, ip: local }).authenticated, false);
  for (const session of sessions.slice(1)) assert.equal(auth.status({ token: session.token, ip: local }).authenticated, true);
});

test('concurrent setup and other instances cannot overwrite stored hash', async t => {
  const { auth, root } = await fixture(t);
  const other = await createControlAuth({ root });
  const first = auth.setup({ password, ip: local });
  await assert.rejects(auth.setup({ password: 'different-password', ip: local }), { status: 409 });
  await first;
  const before = await readFile(join(root, 'data', 'control-auth.json'), 'utf8');
  await assert.rejects(other.setup({ password: 'different-password', ip: local }), { status: 409 });
  assert.equal(await readFile(join(root, 'data', 'control-auth.json'), 'utf8'), before);
});

test('corrupt credential storage fails closed instead of allowing fresh setup', async t => {
  const { auth, root } = await fixture(t);
  await auth.setup({ password, ip: local });
  await writeFile(join(root, 'data', 'control-auth.json'), '{"version":1,"salt":"broken","hash":"broken"}');
  await assert.rejects(createControlAuth({ root }), { status: 503, code: 'AUTH_STORAGE_INVALID' });
});

test('pairing must be issued locally with write authorization; remote password login always forbidden', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  await assert.rejects(auth.login({ password, ip: '192.168.3.109' }), { status: 403 });
  assert.throws(() => auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: '192.168.3.109' }), { status: 403 });
  assert.throws(() => auth.issuePairing({ token: admin.token, ip: local }), { status: 403 });
  assert.throws(() => auth.issuePairing({ csrf: admin.csrf, ip: local }), { status: 401 });
  const pair = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  assert.match(pair.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
  assert.equal(pair.expiresAt - Date.now() <= 120000, true);
  assert.equal(JSON.stringify(auth.status({ token: admin.token, ip: local })).includes(pair.code), false);
  const remote = auth.pair({ code: pair.code, ip: '192.168.3.109' });
  assert.equal(auth.authorize({ token: remote.token, csrf: remote.csrf, ip: '192.168.3.109', write: true }).authenticated, true);
  assert.throws(() => auth.issuePairing({ token: remote.token, csrf: remote.csrf, ip: '192.168.3.109' }), { status: 403 });
  assert.throws(() => auth.pair({ code: pair.code, ip: '192.168.3.110' }), { status: 401 });
});

test('pairing expires in two minutes and new issuance revokes the earlier code', async t => {
  let time = 1000;
  const { auth } = await fixture(t, { now: () => time, remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  const first = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  const second = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  assert.notEqual(first.code, second.code);
  assert.equal(second.expiresAt, time + 120000);
  assert.throws(() => auth.pair({ code: first.code, ip: '192.168.3.109' }), { status: 401 });
  time += 120000;
  assert.throws(() => auth.pair({ code: second.code, ip: '192.168.3.109' }), { status: 401 });
});

test('issuer logout revokes its pending code and paired sessions', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  const first = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  const remote = auth.pair({ code: first.code, ip: '192.168.3.109' });
  const pending = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  auth.logout({ token: admin.token });
  assert.throws(() => auth.pair({ code: pending.code, ip: '192.168.3.110' }), { status: 401 });
  assert.equal(auth.status({ token: remote.token, ip: '192.168.3.109' }).authenticated, false);
});

test('paired sessions expire with issuer and pairing remains disabled without opt-in', async t => {
  let time = 1000;
  const { auth } = await fixture(t, { now: () => time, remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  time = admin.expiresAt - 1000;
  const pairing = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  assert.equal(pairing.expiresAt, admin.expiresAt);
  const remote = auth.pair({ code: pairing.code, ip: '192.168.3.109' });
  assert.equal(remote.expiresAt, admin.expiresAt);
  time += 1000;
  assert.equal(auth.status({ token: remote.token, ip: '192.168.3.109' }).authenticated, false);
  const disabled = await fixture(t);
  const session = await disabled.auth.setup({ password, ip: local });
  assert.throws(() => disabled.auth.issuePairing({ token: session.token, csrf: session.csrf, ip: local }), { status: 403 });
  assert.throws(() => disabled.auth.pair({ code: '123', ip: local }), { status: 403 });
});

test('invalid pairing attempts are rate limited per remote IP', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  const { code } = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local });
  for (let index = 0; index < 5; index++) assert.throws(() => auth.pair({ code: 'bad', ip: '192.168.3.109' }), { status: 401 });
  assert.throws(() => auth.pair({ code, ip: '192.168.3.109' }), { status: 429 });
  const session = auth.pair({ code, ip: '192.168.3.110' });
  assert.equal(auth.status({ token: session.token, ip: '192.168.3.110' }).authenticated, true);
});

test('locally selected protected MAC follows pairing into the NAT session', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  const protectedMac = 'AA:BB:CC:DD:EE:01';
  const { code } = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local, protectedMac: protectedMac.toLowerCase() });
  const remote = auth.pair({ code, ip: '10.231.2.45' });
  assert.equal(remote.protectedMac, protectedMac);
  assert.equal(auth.authorize({ token: remote.token, csrf: remote.csrf, ip: '10.231.2.45', write: true }).protectedMac, protectedMac);
  assert.equal(auth.status({ token: remote.token, ip: '10.231.2.45' }).protectedMac, protectedMac);
  assert.equal('protectedMac' in auth.status(), false);
  assert.equal('protectedMac' in auth.status({ token: remote.token, ip: '192.168.88.254' }), false);
  assert.throws(() => auth.authorize({ token: remote.token, csrf: remote.csrf, ip: '192.168.88.254', write: true }), { status: 401 });
  assert.throws(() => auth.authorize({ token: remote.token, ip: '10.231.2.45', write: true }), { status: 403 });
  assert.throws(() => auth.pair({ code, ip: '10.231.2.45' }), { status: 401 });
  auth.logout({ token: admin.token });
  assert.equal(auth.status({ token: remote.token, ip: '10.231.2.45' }).authenticated, false);
});

test('redemption cannot override or introduce a protected MAC', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  for (const protectedMac of ['AA:BB:CC:DD:EE:01', undefined]) {
    const { code } = auth.issuePairing({ token: admin.token, csrf: admin.csrf, ip: local, protectedMac });
    assert.throws(() => auth.pair({ code, ip: '10.231.2.45', protectedMac: 'AA:BB:CC:DD:EE:02' }), { status: 400, code: 'INVALID_PROTECTED_MAC' });
    const remote = auth.pair({ code, ip: '10.231.2.45' });
    assert.equal(remote.protectedMac, protectedMac);
    const requestSession = auth.authorize({ token: remote.token, csrf: remote.csrf, ip: '10.231.2.45', write: true, protectedMac: 'AA:BB:CC:DD:EE:02' });
    assert.equal(requestSession.protectedMac, protectedMac);
    if (protectedMac === undefined) {
      assert.equal('protectedMac' in remote, false);
      assert.equal('protectedMac' in requestSession, false);
      assert.equal('protectedMac' in auth.status({ token: remote.token, ip: '10.231.2.45' }), false);
    }
  }
  await assert.rejects(auth.login({ password, ip: '10.231.2.45', protectedMac: 'AA:BB:CC:DD:EE:02' }), { status: 403 });
});

test('invalid protected MACs are rejected before replacing a valid pairing code', async t => {
  const { auth } = await fixture(t, { remoteAllowed: true });
  const admin = await auth.setup({ password, ip: local });
  const issuer = { token: admin.token, csrf: admin.csrf, ip: local };
  const { code } = auth.issuePairing({ ...issuer, protectedMac: 'AA:BB:CC:DD:EE:01' });
  for (const protectedMac of [null, '', {}, 1, 'AA:BB:CC:DD:EE', 'AA:BB:CC:DD:EE:GG', 'AABBCCDDEE01', ' AA:BB:CC:DD:EE:01']) {
    assert.throws(() => auth.issuePairing({ ...issuer, protectedMac }), { status: 400, code: 'INVALID_PROTECTED_MAC' });
  }
  assert.throws(() => auth.issuePairing({ ...issuer, ip: '10.231.2.45', protectedMac: 'AA:BB:CC:DD:EE:01' }), { status: 403 });
  assert.equal(auth.pair({ code, ip: '10.231.2.45' }).protectedMac, 'AA:BB:CC:DD:EE:01');
});
