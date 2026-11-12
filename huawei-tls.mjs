import https from 'node:https';
import tls from 'node:tls';
import { createHash, timingSafeEqual } from 'node:crypto';

const failure = (code, message) => Object.assign(new Error(message), { code });

/** A preverified leaf-certificate pin replaces CA/hostname identity validation. */
export function createPinnedHuaweiAgent({ fingerprint, now = Date.now, connect = tls.connect, timeoutMs = 7000 } = {}) {
  if (typeof fingerprint !== 'string' || !/^(?:[a-f0-9]{64}|(?:[a-f0-9]{2}:){31}[a-f0-9]{2})$/i.test(fingerprint)) {
    throw failure('HUAWEI_TLS_PIN_INVALID', 'Configure o SHA256 completo do certificado Huawei verificado.');
  }
  if (typeof now !== 'function' || typeof connect !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new TypeError('Configuracao TLS Huawei invalida.');
  }
  const expected = Buffer.from(fingerprint.replace(/:/g, ''), 'hex');
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1, maxCachedSessions: 0 });
  const pending = new Set();
  agent.createConnection = (options, callback) => {
    if (typeof callback !== 'function') throw new TypeError('TLS Huawei exige callback assincrono.');
    let socket, timer, settled = false;
    const release = () => {
      clearTimeout(timer);
      pending.delete(abort);
      socket?.removeListener('secureConnect', onSecure);
      socket?.removeListener('timeout', onTimeout);
    };
    const reject = error => {
      if (settled) return;
      settled = true;
      release();
      // Retain the error listener until close: a failed socket is never owned by HTTP.
      socket?.destroy();
      callback(error);
    };
    const onError = error => reject(error);
    const onTimeout = () => reject(failure('HUAWEI_TLS_TIMEOUT', 'Tempo limite na verificacao TLS Huawei.'));
    const onClose = () => {
      reject(failure('HUAWEI_TLS_CLOSED', 'Huawei fechou a conexao antes da verificacao TLS.'));
      socket?.removeListener('error', onError);
    };
    const abort = () => reject(failure('HUAWEI_TLS_CLOSED', 'Agente TLS Huawei encerrado.'));
    const onSecure = () => {
      if (settled) return;
      try {
        const cert = socket.getPeerCertificate();
        if (!Buffer.isBuffer(cert?.raw) || !cert.raw.length) throw failure('HUAWEI_TLS_CERT_INVALID', 'Certificado Huawei indisponivel.');
        const actual = createHash('sha256').update(cert.raw).digest();
        if (!timingSafeEqual(actual, expected)) throw failure('HUAWEI_TLS_PIN_MISMATCH', 'Certificado Huawei difere do certificado verificado.');
        const from = Date.parse(cert.valid_from), to = Date.parse(cert.valid_to), time = now();
        if (![from, to, time].every(Number.isFinite) || to <= from || time < from || time >= to) {
          throw failure('HUAWEI_TLS_CERT_INVALID', 'Certificado Huawei fora do periodo de validade.');
        }
      } catch (error) {
        reject(error);
        return;
      }
      settled = true;
      release();
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      callback(null, socket);
    };
    pending.add(abort);
    try {
      // No application socket is returned or passed to HTTP before pin/date checks.
      // CA trust is deliberately replaced by the explicit leaf pin above.
      socket = connect({ ...options, minVersion: 'TLSv1.2', rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
      socket.on('error', onError);
      socket.once('close', onClose);
      socket.once('timeout', onTimeout);
      socket.once('secureConnect', onSecure);
      timer = setTimeout(onTimeout, timeoutMs);
    } catch (error) {
      reject(error);
    }
    return undefined;
  };
  const destroy = agent.destroy.bind(agent);
  agent.destroy = () => {
    for (const abort of [...pending]) abort();
    destroy();
  };
  return agent;
}
