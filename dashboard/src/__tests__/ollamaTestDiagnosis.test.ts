import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../services/ai/ollamaProvider.js';
import { AIProviderFactory, resolveOllamaBaseUrl } from '../services/ai/aiProviderFactory.js';
import { prisma } from '../config/prisma.js';
import * as security from '../shared/security.js';

describe('Diagnóstico e Teste de Modelos de IA — Ollama Provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveOllamaBaseUrl', () => {
    const originalHost = process.env.OLLAMA_HOST;
    const originalBaseUrl = process.env.OLLAMA_BASE_URL;

    beforeEach(() => {
      delete process.env.OLLAMA_HOST;
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.IS_DOCKER;
    });

    afterEach(() => {
      if (originalHost) process.env.OLLAMA_HOST = originalHost;
      else delete process.env.OLLAMA_HOST;
      if (originalBaseUrl) process.env.OLLAMA_BASE_URL = originalBaseUrl;
      else delete process.env.OLLAMA_BASE_URL;
      delete process.env.IS_DOCKER;
    });

    it('deve manter URL padrão se não houver docker e nenhuma url customizada', () => {
      const url = resolveOllamaBaseUrl();
      expect(url).toBeDefined();
    });

    it('deve substituir localhost por host.docker.internal se estiver em ambiente docker', () => {
      process.env.IS_DOCKER = 'true';
      const resolved = resolveOllamaBaseUrl('http://localhost:11434');
      expect(resolved).toBe('http://host.docker.internal:11434');
      delete process.env.IS_DOCKER;
    });

    it('deve substituir 127.0.0.1 por host.docker.internal se estiver em ambiente docker', () => {
      process.env.IS_DOCKER = 'true';
      const resolved = resolveOllamaBaseUrl('http://127.0.0.1:11434');
      expect(resolved).toBe('http://host.docker.internal:11434');
      delete process.env.IS_DOCKER;
    });

    it('deve priorizar OLLAMA_HOST configurado no ambiente quando o banco tiver o default localhost', () => {
      process.env.OLLAMA_HOST = 'http://192.168.1.100:11434';
      const resolved = resolveOllamaBaseUrl('http://localhost:11434');
      expect(resolved).toBe('http://192.168.1.100:11434');
      delete process.env.OLLAMA_HOST;
    });

    it('deve adicionar protocolo http:// se OLLAMA_HOST for definido sem protocolo', () => {
      process.env.OLLAMA_HOST = '192.168.1.100:11434';
      const resolved = resolveOllamaBaseUrl('http://localhost:11434');
      expect(resolved).toBe('http://192.168.1.100:11434');
      delete process.env.OLLAMA_HOST;
    });
  });

  describe('isAllowedLocalhostBaseUrl anti-SSRF para Ollama', () => {
    it('deve permitir host customizado configurado em OLLAMA_HOST sem bloquear como SSRF', () => {
      process.env.OLLAMA_HOST = '192.168.1.100:11434';
      const isAllowed = security.isAllowedLocalhostBaseUrl('http://192.168.1.100:11434/api/generate');
      expect(isAllowed).toBe(true);
      delete process.env.OLLAMA_HOST;
    });
  });

  describe('OllamaProvider.testConnection', () => {
    it('deve responder ONLINE com status 200, latência e diagnóstico quando o Ollama responder com sucesso', async () => {
      const provider = new OllamaProvider();
      vi.spyOn(security, 'safeHttpPostJson').mockResolvedValueOnce({
        status: 200,
        data: {
          model: 'qwen2.5:7b',
          response: 'OK, motor operacional',
          done: true,
        },
      });

      const result = await provider.testConnection('Ping de teste', {
        baseUrl: 'http://localhost:11434',
        modelId: 'qwen2.5:7b',
      });

      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('qwen2.5:7b');
      expect(result.status).toBe('ONLINE');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.response).toBe('OK, motor operacional');
      expect(result.testedAt).toBeDefined();
    });

    it('deve responder OFFLINE de forma resiliente quando a conexão com o Ollama falhar (ex: ECONNREFUSED)', async () => {
      const provider = new OllamaProvider();
      vi.spyOn(security, 'safeHttpPostJson').mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:11434')
      );

      const result = await provider.testConnection(undefined, {
        baseUrl: 'http://localhost:11434',
        modelId: 'qwen2.5:7b',
      });

      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('qwen2.5:7b');
      expect(result.status).toBe('OFFLINE');
      expect(result.response).toContain('Falha ao conectar com o Ollama');
      expect(result.response).toContain('ECONNREFUSED');
    });

    it('deve responder OFFLINE detalhando a mensagem do servidor se o modelo não for encontrado no Ollama (HTTP 404)', async () => {
      const provider = new OllamaProvider();
      const notFoundErr: any = new Error('Request failed with status code 404');
      notFoundErr.response = {
        data: {
          error: "model 'qwen2.5:7b' not found, try pulling it first",
        },
      };
      vi.spyOn(security, 'safeHttpPostJson').mockRejectedValueOnce(notFoundErr);

      const result = await provider.testConnection(undefined, {
        baseUrl: 'http://localhost:11434',
        modelId: 'qwen2.5:7b',
      });

      expect(result.status).toBe('OFFLINE');
      expect(result.response).toContain("model 'qwen2.5:7b' not found, try pulling it first");
    });
  });

  describe('AIProviderFactory.testModelResponse com targetModelId Ollama', () => {
    it('deve carregar o modelo Ollama do banco, resolver a URL e delegar para o OllamaProvider', async () => {
      vi.spyOn(prisma.aiModelConfig, 'findUnique').mockResolvedValueOnce({
        id: 'ollama-db-id',
        name: 'Ollama Local (Qwen 2.5)',
        provider: 'ollama',
        modelId: 'qwen2.5:7b',
        baseUrl: 'http://localhost:11434',
        isActive: false,
        isDefault: false,
        temperature: 0.2,
        maxTokens: 2048,
        description: 'Modelo local',
        apiKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.spyOn(security, 'safeHttpPostJson').mockResolvedValueOnce({
        status: 200,
        data: {
          model: 'qwen2.5:7b',
          response: 'OK Deontológico',
        },
      });

      const result = await AIProviderFactory.testModelResponse('Verificação rápida', 'ollama-db-id');

      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('qwen2.5:7b');
      expect(result.status).toBe('ONLINE');
      expect(result.response).toBe('OK Deontológico');
    });
  });
});
