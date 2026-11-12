import fs from 'node:fs';
import {X509Certificate} from 'node:crypto';
try {
 const [file,expected]=process.argv.slice(2);
 if(!file||!expected)throw new Error('Informe o certificado publico e o fingerprint SHA-256 copiado do WinBox.');
 const pem=fs.readFileSync(file,'utf8');
 if(/PRIVATE KEY/.test(pem))throw new Error('Este arquivo contem chave privada. Use somente orbit-ca.crt.');
 const cert=new X509Certificate(pem);
 const normalized=String(expected).replace(/[:\s-]/g,'').toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(normalized))throw new Error('Fingerprint SHA-256 deve ter 64 caracteres hexadecimais.');
 if(cert.fingerprint256.replaceAll(':','').toLowerCase()!==normalized)throw new Error('Fingerprint diferente do informado pelo WinBox. Certificado nao configurado.');
 if(!cert.ca)throw new Error('O certificado nao e uma autoridade CA.');
 if(Date.now()<Date.parse(cert.validFrom)||Date.now()>Date.parse(cert.validTo))throw new Error('Certificado fora do periodo de validade. Confira os relogios.');
 console.log('CA verificada. SHA-256: '+cert.fingerprint256);
 console.log('Validade ate: '+cert.validTo);
}catch(e){console.error(e.message);process.exitCode=1;}
