import crypto from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recomendado para GCM
const PREFIX = 'enc:v1:';

function getDerivedKey(): Buffer {
  const secret = env.JWT_SECRET || 'conformia-default-fallback-encryption-secret-key-32b';
  return crypto.scryptSync(secret, 'conformia-model-keys-salt-v1', 32);
}

/**
 * T32: Cifra em repouso a chave de API de modelos de IA utilizando AES-256-GCM
 */
export function encryptModelApiKey(plainKey: string | null | undefined): string | null {
  if (!plainKey || typeof plainKey !== 'string' || plainKey.trim() === '') {
    return null;
  }

  // Se já estiver cifrado, evita dupla cifragem
  if (plainKey.startsWith(PREFIX)) {
    return plainKey;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getDerivedKey(), iv);
  
  let ciphertext = cipher.update(plainKey.trim(), 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${ciphertext}`;
}

/**
 * T32: Decifra a chave de API em repouso para uso em runtime
 */
export function decryptModelApiKey(storedValue: string | null | undefined): string | null {
  if (!storedValue || typeof storedValue !== 'string' || storedValue.trim() === '') {
    return null;
  }

  // Se não possuir o prefixo do envelope criptográfico, retorna o valor direto (suporte a dados legados)
  if (!storedValue.startsWith(PREFIX)) {
    return storedValue;
  }

  try {
    const parts = storedValue.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      return null;
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, getDerivedKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('❌ [Encryption] Falha ao decifrar apiKey do modelo de IA (Integridade/AuthTag corrompida).');
    return null;
  }
}

/**
 * Mascara a chave de API para exibição segura em APIs REST (OWASP)
 */
export function maskApiKey(rawKey: string | null | undefined): string | null {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const decrypted = decryptModelApiKey(rawKey) || rawKey;
  if (decrypted.length > 4) {
    return `••••••••${decrypted.slice(-4)}`;
  }
  return '••••••••';
}
