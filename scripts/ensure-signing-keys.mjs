import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const keysPath = path.resolve('supabase/signing_keys.json');

if (!fs.existsSync(keysPath)) {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  jwk.kid = crypto.randomUUID();
  jwk.use = 'sig';
  jwk.alg = 'ES256';
  fs.writeFileSync(keysPath, JSON.stringify([jwk], null, 2));
  console.log('supabase/signing_keys.json creado con clave ES256.');
}
