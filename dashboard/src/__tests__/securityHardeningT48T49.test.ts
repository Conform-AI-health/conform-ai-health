import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, maskSecret, maskPassword } from '../shared/encryption.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import { env } from '../config/env.js';

describe('T48: Cifragem AES-256-GCM e Mascaramento de Credenciais de Agente', () => {
  const plainPassword = 'SecretP@ssw0rd!#2026';

  it('deve cifrar a senha com envelope criptográfico enc:v1: contendo IV, Tag e Ciphertext', () => {
    const encrypted = encryptSecret(plainPassword);
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(plainPassword);
    expect(encrypted?.startsWith('enc:v1:')).toBe(true);

    const parts = encrypted!.slice('enc:v1:'.length).split(':');
    expect(parts.length).toBe(3);
    const [iv, tag, cipher] = parts;
    expect(iv.length).toBe(24); // 12 bytes = 24 hex chars
    expect(tag.length).toBe(32); // 16 bytes = 32 hex chars
    expect(cipher.length).toBeGreaterThan(0);
  });

  it('deve decifrar a senha perfeitamente retornando o valor original em runtime', () => {
    const encrypted = encryptSecret(plainPassword);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plainPassword);
  });

  it('deve ser idempotente evitando cifrar duplamente uma senha já cifrada', () => {
    const encryptedOnce = encryptSecret(plainPassword);
    const encryptedTwice = encryptSecret(encryptedOnce);
    expect(encryptedTwice).toBe(encryptedOnce);
  });

  it('deve decifrar senhas legadas em texto plano para retrocompatibilidade', () => {
    const legacyPlain = 'legacy_system_password_123';
    const result = decryptSecret(legacyPlain);
    expect(result).toBe(legacyPlain);
  });

  it('deve mascarar a senha para exibição pública na API REST sem expor nenhum caractere', () => {
    expect(maskPassword(plainPassword)).toBe('••••••••');
    expect(maskSecret(plainPassword)).toBe('••••••••');
    expect(maskSecret('enc:v1:dummyiv:dummytag:dummycipher')).toBe('••••••••');
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret(undefined)).toBeNull();
    expect(maskSecret('')).toBeNull();
  });
});

describe('T49: Blindagem do ErrorHandler Global contra Vazamento de Dados em Produção', () => {
  let originalNodeEnv: string | undefined;
  let mockConsoleError: any;

  beforeEach(() => {
    originalNodeEnv = env.NODE_ENV;
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (env as any).NODE_ENV = originalNodeEnv;
    mockConsoleError.mockRestore();
  });

  function createMockResponse() {
    const res: any = {};
    res.statusCode = 200;
    res.body = null;
    res.status = vi.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = vi.fn().mockImplementation((payload: any) => {
      res.body = payload;
      return res;
    });
    return res;
  }

  it('em produção: erro interno 500 deve ocultar detalhes de banco e retornar mensagem genérica segura', () => {
    (env as any).NODE_ENV = 'production';

    const req: any = {};
    const res = createMockResponse();
    const next = vi.fn();

    const sensitiveError = new Error('MongoServerError: Authentication failed for user root on cluster-prod.internal');
    (sensitiveError as any).status = 500;
    (sensitiveError as any).code = 'MONGO_AUTH_FAIL';

    errorHandler(sensitiveError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body).toEqual({
      error: 'Ocorreu um erro interno no servidor.',
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(res.body.stack).toBeUndefined();
    expect(mockConsoleError).toHaveBeenCalledWith('[Unhandled Error]:', sensitiveError);
  });

  it('em produção: erros de cliente (400, 404, 409) devem manter mensagem informativa legítima', () => {
    (env as any).NODE_ENV = 'production';

    const req: any = {};
    const res = createMockResponse();
    const next = vi.fn();

    const clientError = new Error('CNPJ inválido ou já associado a outra clínica.');
    (clientError as any).status = 400;
    (clientError as any).code = 'INVALID_CNPJ';

    errorHandler(clientError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({
      error: 'CNPJ inválido ou já associado a outra clínica.',
      code: 'INVALID_CNPJ',
    });
    expect(res.body.stack).toBeUndefined();
  });

  it('fora de produção: erro interno 500 expõe mensagem e stack trace para debug pelo desenvolvedor', () => {
    (env as any).NODE_ENV = 'development';

    const req: any = {};
    const res = createMockResponse();
    const next = vi.fn();

    const devError = new Error('Null pointer exception at line 42 in moduleResolver.ts');
    (devError as any).status = 500;
    (devError as any).code = 'MODULE_RESOLVER_ERROR';

    errorHandler(devError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toBe('Null pointer exception at line 42 in moduleResolver.ts');
    expect(res.body.code).toBe('MODULE_RESOLVER_ERROR');
    expect(res.body.stack).toBeDefined();
  });
});
