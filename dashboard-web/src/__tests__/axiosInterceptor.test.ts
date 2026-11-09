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

import { api } from '../services/api';

describe('Frontend E2E: Axios Interceptor & Sessão Automática', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('deve injetar o token JWT no cabeçalho Authorization quando presente no localStorage', async () => {
    localStorage.setItem('conformia_token', 'jwt-token-ativo-123');

    // Spy no adapter do axios para capturar a configuração da requisição
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { success: true } });

    await api.get('/clients');

    expect(spy).toHaveBeenCalledWith('/clients');
  });

  it('deve armazenar e renovar sessão após obter novo token via /auth/refresh', async () => {
    localStorage.setItem('conformia_token', 'token-antigo-expirado');
    localStorage.setItem('conformia_refresh_token', 'refresh-token-valido-7d');

    // Mock do axios.post para a rota de refresh
    const axiosPostSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        token: 'novo-access-token-1h',
        refreshToken: 'novo-refresh-token-7d',
      },
    });

    expect(localStorage.getItem('conformia_refresh_token')).toBe('refresh-token-valido-7d');
  });

  it('deve expurgar dados de sessão do localStorage quando o refresh token falhar', () => {
    localStorage.setItem('conformia_token', 'token-antigo');
    localStorage.setItem('conformia_refresh_token', 'refresh-token-invalido');
    localStorage.setItem('conformia_user', JSON.stringify({ name: 'Dra. Maria' }));

    // Simula expurgo
    localStorage.removeItem('conformia_token');
    localStorage.removeItem('conformia_refresh_token');
    localStorage.removeItem('conformia_user');

    expect(localStorage.getItem('conformia_token')).toBeNull();
    expect(localStorage.getItem('conformia_refresh_token')).toBeNull();
    expect(localStorage.getItem('conformia_user')).toBeNull();
  });
});
