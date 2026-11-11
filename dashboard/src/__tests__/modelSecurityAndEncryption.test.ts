import { describe, it, expect } from 'vitest';
import { isAllowedLocalhostBaseUrl } from '../shared/security.js';
import {
  encryptModelApiKey,
  decryptModelApiKey,
  maskApiKey,
} from '../shared/encryption.js';

describe('T26 & T32 — Segurança de Modelos de IA: BaseUrl e Cifragem AES-256-GCM', () => {
  describe('T26: Validação estrita anti-SSRF de baseUrl (Bypass de localhost mitigado)', () => {
    it('deve aceitar localhost e 127.0.0.1 legítimos', () => {
      expect(isAllowedLocalhostBaseUrl('http://localhost:11434')).toBe(true);
      expect(isAllowedLocalhostBaseUrl('http://127.0.0.1:11434')).toBe(true);
      expect(isAllowedLocalhostBaseUrl('http://[::1]:11434')).toBe(true);
    });

    it('deve rejeitar categoricamente bypasses maliciosos contendo substring localhost em domínios externos', () => {
      // Subdomínios externos fingindo ser localhost
      expect(isAllowedLocalhostBaseUrl('http://localhost.evil.com:11434')).toBe(false);
      expect(isAllowedLocalhostBaseUrl('http://evil-localhost.com')).toBe(false);
      expect(isAllowedLocalhostBaseUrl('http://notlocalhost:8080')).toBe(false);

      // Query string ou path contendo localhost
      expect(isAllowedLocalhostBaseUrl('http://attacker.com/?q=localhost')).toBe(false);
      expect(isAllowedLocalhostBaseUrl('http://attacker.com/localhost')).toBe(false);

      // Credenciais embutidas na URL
      expect(isAllowedLocalhostBaseUrl('http://admin:secret@localhost:11434')).toBe(false);

      // Protocolos inseguros
      expect(isAllowedLocalhostBaseUrl('file:///localhost/etc/passwd')).toBe(false);
      expect(isAllowedLocalhostBaseUrl('gopher://localhost:11434')).toBe(false);
    });
  });

  describe('T32: Cifragem AES-256-GCM em repouso da apiKey de Modelos de IA', () => {
    const rawApiKey = 'sk-proj-super-secret-production-gemini-key-1234567890';

    it('deve cifrar a chave em repouso com envelope enc:v1 e jamais expor o texto plano', () => {
      const encrypted = encryptModelApiKey(rawApiKey);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBeNull();
      expect(encrypted).toContain('enc:v1:');
      expect(encrypted).not.toContain(rawApiKey);
      expect(encrypted).not.toContain('super-secret');

      // Formato esperado: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
      const parts = encrypted!.split(':');
      expect(parts.length).toBe(5); // 'enc', 'v1', iv, authTag, ciphertext
    });

    it('deve decifrar a chave corretamente em runtime preservando o conteúdo original', () => {
      const encrypted = encryptModelApiKey(rawApiKey);
      const decrypted = decryptModelApiKey(encrypted);

      expect(decrypted).toBe(rawApiKey);
    });

    it('deve rejeitar e retornar null se o authTag ou ciphertext forem corrompidos (integridade GCM)', () => {
      const encrypted = encryptModelApiKey(rawApiKey)!;
      const parts = encrypted.split(':');
      // Adultera o último caractere do ciphertext
      parts[4] = parts[4].slice(0, -2) + 'ff';
      const tampered = parts.join(':');

      const decrypted = decryptModelApiKey(tampered);
      expect(decrypted).toBeNull();
    });

    it('deve mascarar a chave de API na saída de APIs REST', () => {
      const masked = maskApiKey(rawApiKey);
      expect(masked).toBe('••••••••7890');

      const maskedEncrypted = maskApiKey(encryptModelApiKey(rawApiKey));
      expect(maskedEncrypted).toBe('••••••••7890');
    });
  });
});
