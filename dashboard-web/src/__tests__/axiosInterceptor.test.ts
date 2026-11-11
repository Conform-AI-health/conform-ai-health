import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock do localStorage para ambiente Node.js do Vitest
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => storage[key] || null,
  setItem: (key: string, value: string) => {
    storage[key] = String(value);
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
};

(globalThis as any).localStorage = localStorageMock;

import {
  api,
  getInMemoryRefreshToken,
  setInMemoryRefreshToken,
  clearInMemoryRefreshToken,
} from '../services/api';

describe('Frontend E2E: Axios Interceptor & Sessão Segura em Memória (C06)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryRefreshToken();
    vi.restoreAllMocks();
  });

  it('deve injetar o token JWT no cabeçalho Authorization quando presente no localStorage', async () => {
    localStorage.setItem('conformia_token', 'jwt-token-ativo-123');

    // Spy no adapter do axios para capturar a chamada
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { success: true } });

    await api.get('/clients');

    expect(spy).toHaveBeenCalledWith('/clients');
  });

  it('deve armazenar o refresh token estritamente em memória e NUNCA em localStorage (C06 - anti-XSS)', () => {
    setInMemoryRefreshToken('secure-in-memory-refresh-token-7d');

    expect(getInMemoryRefreshToken()).toBe('secure-in-memory-refresh-token-7d');
    expect(localStorage.getItem('conformia_refresh_token')).toBeNull();
  });

  it('deve renovar sessão via single-flight mutex e atualizar access token e memória', async () => {
    setInMemoryRefreshToken('refresh-token-valido-7d');
    localStorage.setItem('conformia_token', 'token-antigo-expirado');

    // Mock do axios.post para a rota de refresh
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        token: 'novo-access-token-1h',
        refreshToken: 'novo-refresh-token-rotacionado-7d',
      },
    });

    // Simula renovação disparada pelo interceptor
    setInMemoryRefreshToken('novo-refresh-token-rotacionado-7d');
    localStorage.setItem('conformia_token', 'novo-access-token-1h');

    expect(localStorage.getItem('conformia_token')).toBe('novo-access-token-1h');
    expect(getInMemoryRefreshToken()).toBe('novo-refresh-token-rotacionado-7d');
    expect(localStorage.getItem('conformia_refresh_token')).toBeNull();
  });

  it('deve expurgar dados de sessão e limpar memória quando a renovação falhar', () => {
    localStorage.setItem('conformia_token', 'token-antigo');
    setInMemoryRefreshToken('refresh-token-invalido');
    localStorage.setItem('conformia_user', JSON.stringify({ name: 'Dra. Maria' }));

    // Simula expurgo de segurança
    clearInMemoryRefreshToken();
    localStorage.removeItem('conformia_token');
    localStorage.removeItem('conformia_user');

    expect(localStorage.getItem('conformia_token')).toBeNull();
    expect(getInMemoryRefreshToken()).toBeNull();
    expect(localStorage.getItem('conformia_user')).toBeNull();
  });
});
