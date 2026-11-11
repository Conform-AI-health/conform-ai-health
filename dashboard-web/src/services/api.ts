import axios from 'axios';

// Limpeza preventiva de chave legada de refresh token no localStorage (C06 - SEC)
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem('conformia_refresh_token');
  }
} catch {
  // Ignora erros de acesso a storage em ambientes restritos
}

/**
 * Gerenciador em memória do Refresh Token (C06)
 * Impede exfiltração de sessão permanente via ataques de Cross-Site Scripting (XSS).
 * Em conjunto com o cookie HttpOnly emitido pelo backend, garante dupla camada defensiva.
 */
let inMemoryRefreshToken: string | null = null;

export const getInMemoryRefreshToken = (): string | null => inMemoryRefreshToken;

export const setInMemoryRefreshToken = (token: string | null): void => {
  inMemoryRefreshToken = token;
};

export const clearInMemoryRefreshToken = (): void => {
  inMemoryRefreshToken = null;
};

// Canal seguro de comunicação entre abas sem expor tokens no storage
const authChannel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('conformia_auth_channel')
    : null;

export const notifyAuthEvent = (event: 'LOGOUT' | 'REFRESH_SUCCESS') => {
  if (authChannel) {
    try {
      authChannel.postMessage({ type: event, timestamp: Date.now() });
    } catch {
      // Ignora erro em navegadores que bloqueiem o canal
    }
  }
};

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // Permite envio transparente de cookies HttpOnly SameSite=Strict
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest', // Proteção padrão anti-CSRF para endpoints de API
  },
});

// Interceptor para injetar o Access Token JWT (armazenado em storage/memória de sessão)
api.interceptors.request.use((config) => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('conformia_token') : null;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Controle de concorrência: single-flight mutex para renovação de refresh token (T06 / C06)
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Interceptor para renovação automática via Refresh Token no status 401 com fila única
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Se receber 401 e não for requisição de autenticação
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      // Se a requisição atual já foi tentada após refresh, encerra a sessão
      if (originalRequest._retry) {
        return Promise.reject(error);
      }

      const activeRefreshToken = getInMemoryRefreshToken();

      // Se já houver uma renovação em andamento, enfileira a requisição concorrente (Single Flight)
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Instância limpa do axios para evitar interceptores recursivos
        // Envia o refresh token em memória (se disponível) ou delega ao cookie HttpOnly via withCredentials
        const refreshRes = await axios.post(
          '/api/v1/auth/refresh',
          activeRefreshToken ? { refreshToken: activeRefreshToken } : {},
          {
            withCredentials: true,
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
          }
        );

        const { token: newAccessToken, refreshToken: newRefreshToken } = refreshRes.data;

        if (newAccessToken) {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('conformia_token', newAccessToken);
          }
          if (newRefreshToken) {
            setInMemoryRefreshToken(newRefreshToken);
          }

          notifyAuthEvent('REFRESH_SUCCESS');
          processQueue(null, newAccessToken);
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(originalRequest);
        } else {
          throw new Error('Novo access token não retornado pelo servidor.');
        }
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        clearInMemoryRefreshToken();

        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('conformia_token');
          localStorage.removeItem('conformia_user');
          localStorage.removeItem('conformia_refresh_token');
        }

        notifyAuthEvent('LOGOUT');

        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
