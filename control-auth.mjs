import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';

const derive = promisify(scrypt);
const TTL_MS = 30 * 60 * 1000;
const PAIRING_TTL_MS = 2 * 60 * 1000;
const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const WINDOW_MS = 15 * 60 * 1000;
const MAX_IP_FAILURES = 5;
const MAX_GLOBAL_FAILURES = 20;
const MAX_SESSIONS = 20;
const MAX_IP_SESSIONS = 3;
const HASH_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function denied(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  return error;
}

function normalizeIP(ip) {
  if (typeof ip !== 'string' || ip.length > 64) return '';
  const normalized = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip.toLowerCase();
  return isIP(normalized) ? normalized : '';
}

function isLocal(ip) {
  return ip === '::1' || (isIP(ip) === 4 && ip.startsWith('127.'));
}

function passwordValid(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 256;
}

function normalizeProtectedMac(mac) {
  if (mac === undefined) return undefined;
  if (typeof mac !== 'string' || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) {
    throw denied(400, 'INVALID_PROTECTED_MAC', 'MAC do aparelho administrador invalido.');
  }
  return mac.toUpperCase();
}

function equalOpaque(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (actual.length !== expected.length) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Administrative authentication only. The caller must additionally enforce
 * same-origin requests and use the returned token in an HttpOnly,
 * SameSite=Strict cookie. Never pass an IP supplied by an untrusted header.
 * LAN HTTP is unencrypted; remote administration is an explicit opt-in.
 */
export async function createControlAuth({ root, dataDir, now = Date.now, remoteAllowed = false, allowPasswordLogin = false, sessionTtlMs = TTL_MS }) {
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 60000 || sessionTtlMs > 7*86400000) throw new TypeError('Duração de sessão inválida.');
  if (typeof root !== 'string' || !root || typeof now !== 'function') {
    throw new TypeError('Root e relogio de autenticacao invalidos.');
  }
  const directory = dataDir ?? join(root, 'data');
  const file = join(directory, 'control-auth.json');
  async function readAccount(){
    try {
      const stored = JSON.parse(await readFile(file, 'utf8'));
      if (stored.version !== 1 || !/^[a-f0-9]{64}$/.test(stored.salt) || !/^[a-f0-9]{128}$/.test(stored.hash)) throw new Error('Invalid authentication record');
      return {version:1,salt:stored.salt,hash:stored.hash};
    } catch(error){
      if(error.code==='ENOENT')return null;
      throw denied(503, 'AUTH_STORAGE_INVALID', 'Configuracao administrativa indisponivel.');
    }
  }
  let account=await readAccount();

  const sessions = new Map();
  let pairing = null;
  const failures = new Map();
  let globalFailures = [];
  let setupPending = false;
  let pendingLogins = 0;

  function prune() {
    const time = now();
    for (const [token, session] of sessions) if (session.expiresAt <= time) sessions.delete(token);
    for (const [token, session] of sessions) if (session.issuerToken && !sessions.has(session.issuerToken)) sessions.delete(token);
    if (pairing && (pairing.expiresAt <= time || !sessions.has(pairing.issuerToken))) pairing = null;
    for (const [ip, times] of failures) {
      const recent = times.filter(value => value.time > time - WINDOW_MS);
      if (recent.length) failures.set(ip, recent);
      else failures.delete(ip);
    }
    globalFailures = globalFailures.filter(value => value.time > time - WINDOW_MS);
  }

  function acceptedIP(rawIP, setup = false) {
    const ip = normalizeIP(rawIP);
    if (!ip || (!isLocal(ip) && (setup || remoteAllowed !== true))) {
      throw denied(403, 'LOCAL_CONTROL_REQUIRED', 'Use o ORBIT neste computador para administrar.');
    }
    return ip;
  }

  function issue(ip, issuerToken = null, protectedMac = undefined) {
    prune();
    const matching = [...sessions.entries()].filter(([token, session]) => session.ip === ip && token !== issuerToken);
    while (matching.length >= MAX_IP_SESSIONS) sessions.delete(matching.shift()[0]);
    while (sessions.size >= MAX_SESSIONS) sessions.delete([...sessions.keys()].find(token => token !== issuerToken));
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(now() + sessionTtlMs, issuerToken ? sessions.get(issuerToken).expiresAt : Infinity);
    sessions.set(token, { ip, csrf, expiresAt, issuerToken, ...(protectedMac ? { protectedMac } : {}) });
    prune();
    return { token, csrf, expiresAt, ...(protectedMac ? { protectedMac } : {}) };
  }

  function failure(ip) {
    const attempt = { time: now() };
    const times = failures.get(ip) || [];
    times.push(attempt);
    failures.set(ip, times);
    globalFailures.push(attempt);
    return attempt;
  }

  function sessionFor(token, rawIP) {
    prune();
    if (typeof token !== 'string' || token.length !== 43) return null;
    const ip = normalizeIP(rawIP);
    if (!ip || (!isLocal(ip) && remoteAllowed !== true)) return null;
    const session = sessions.get(token);
    return session && session.ip === ip ? session : null;
  }

  function authorize({ token, ip, csrf, write = false } = {}) {
    acceptedIP(ip);
    const session = sessionFor(token, ip);
    if (!session) throw denied(401, 'ADMIN_LOGIN_REQUIRED', 'Entre como administrador do ORBIT.');
    if (write && !equalOpaque(csrf, session.csrf)) throw denied(403, 'INVALID_CSRF', 'Solicitacao administrativa invalida.');
    return { authenticated: true, expiresAt: session.expiresAt, ...(session.protectedMac ? { protectedMac: session.protectedMac } : {}) };
  }

  function rateLimit(ip) {
    prune();
    if ((failures.get(ip)?.length || 0) >= MAX_IP_FAILURES || globalFailures.length >= MAX_GLOBAL_FAILURES || pendingLogins >= 4) {
      throw denied(429, 'LOGIN_RATE_LIMIT', 'Muitas tentativas. Aguarde antes de tentar novamente.');
    }
  }

  function clearAttempt(ip, attempt) {
    const times = failures.get(ip) || [];
    const position = times.indexOf(attempt);
    if (position >= 0) times.splice(position, 1);
    if (!times.length) failures.delete(ip);
    else failures.set(ip, times);
    globalFailures = globalFailures.filter(value => value !== attempt);
  }

  return {
    status({ token, ip } = {}) {
      const session = sessionFor(token, ip);
      return {
        configured: account !== null,
        authenticated: Boolean(session),
        remoteAllowed: remoteAllowed === true,
        expiresAt: session ? session.expiresAt : null,
        // Same-origin, cookie-authenticated clients need this after a reload or
        // when opening another tab. Anonymous/IP-mismatched callers receive none.
        ...(session ? { csrf: session.csrf } : {}),
        ...(session?.protectedMac ? { protectedMac: session.protectedMac } : {}),
      };
    },

    async setup({ password, ip } = {}) {
      const normalizedIP = acceptedIP(ip, true);
      if (account || setupPending) throw denied(409, 'ALREADY_CONFIGURED', 'A senha administrativa ja foi configurada.');
      if (!passwordValid(password)) throw denied(400, 'INVALID_PASSWORD_LENGTH', 'Use uma senha de 12 a 256 caracteres.');
      setupPending = true;
      try {
        const salt = randomBytes(32).toString('hex');
        const hash = (await derive(password, Buffer.from(salt, 'hex'), HASH_BYTES, SCRYPT_OPTIONS)).toString('hex');
        const stored = { version: 1, salt, hash };
        await mkdir(directory, { recursive: true });
        try {
          // Exclusive creation also prevents overwriting another instance's setup.
          await writeFile(file, JSON.stringify(stored) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        } catch (error) {
          if (error.code === 'EEXIST') throw denied(409, 'ALREADY_CONFIGURED', 'A senha administrativa ja foi configurada.');
          throw denied(503, 'AUTH_STORAGE_UNAVAILABLE', 'Nao foi possivel salvar a configuracao administrativa.');
        }
        account = stored;
        return issue(normalizedIP);
      } finally {
        setupPending = false;
      }
    },

    async login({ password, ip } = {}) {
      // Permanent credentials must never be sent through the LAN HTTP gateway.
      const normalizedIP = acceptedIP(ip, !allowPasswordLogin);
      if(!account&&allowPasswordLogin)account=await readAccount();
      if (!account) throw denied(409, 'SETUP_REQUIRED', 'Configure a senha administrativa neste computador.');
      rateLimit(normalizedIP);
      // Reserve an attempt before awaiting hashing to bound concurrent attempts.
      const attempt = failure(normalizedIP);
      pendingLogins += 1;
      try {
        const candidate = await derive(passwordValid(password) ? password : '', Buffer.from(account.salt, 'hex'), HASH_BYTES, SCRYPT_OPTIONS);
        if (!passwordValid(password) || !timingSafeEqual(candidate, Buffer.from(account.hash, 'hex'))) {
          throw denied(401, 'INVALID_CREDENTIALS', 'Senha administrativa incorreta.');
        }
        // Successful attempts do not erase prior failed attempts in the window.
        clearAttempt(normalizedIP, attempt);
        return issue(normalizedIP);
      } finally {
        pendingLogins -= 1;
      }
    },

    issuePairing({ token, ip, csrf, protectedMac } = {}) {
      acceptedIP(ip, true);
      if (remoteAllowed !== true) throw denied(403, 'REMOTE_CONTROL_DISABLED', 'O controle por outros aparelhos esta desabilitado.');
      const admin = authorize({ token, ip, csrf, write: true });
      const administratorMac = normalizeProtectedMac(protectedMac);
      const bytes = randomBytes(12);
      const code = [...bytes].map(value => PAIRING_ALPHABET[value & 31]).join('');
      const expiresAt = Math.min(now() + PAIRING_TTL_MS, admin.expiresAt);
      // A new code supersedes the previous one; store its digest only in memory.
      pairing = { digest: createHash('sha256').update(code).digest(), expiresAt, issuerToken: token, ...(administratorMac ? { protectedMac: administratorMac } : {}) };
      return { code, expiresAt };
    },

    pair({ code, ip, protectedMac } = {}) {
      if (remoteAllowed !== true) throw denied(403, 'REMOTE_CONTROL_DISABLED', 'O controle por outros aparelhos esta desabilitado.');
      const normalizedIP = acceptedIP(ip);
      // Device protection is selected by the local issuer, never by redemption.
      if (protectedMac !== undefined) throw denied(400, 'INVALID_PROTECTED_MAC', 'O aparelho administrador deve ser definido neste computador.');
      rateLimit(normalizedIP);
      const attempt = failure(normalizedIP);
      const normalizedCode = typeof code === 'string' && code.length <= 32 ? code.replace(/[\s-]/g, '').toUpperCase() : '';
      const digest = createHash('sha256').update(normalizedCode).digest();
      if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(normalizedCode) || !pairing || !timingSafeEqual(digest, pairing.digest)) {
        throw denied(401, 'INVALID_PAIRING_CODE', 'Codigo invalido ou expirado. Gere outro codigo no PC.');
      }
      const issuerToken = pairing.issuerToken;
      const administratorMac = pairing.protectedMac;
      // Consume before issuing so replay cannot create another session.
      pairing = null;
      clearAttempt(normalizedIP, attempt);
      return issue(normalizedIP, issuerToken, administratorMac);
    },

    logout({ token } = {}) {
      if (typeof token === 'string') sessions.delete(token);
      prune();
      return { loggedOut: true };
    },

    authorize,
  };
}
