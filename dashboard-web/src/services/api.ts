import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para injetar o token JWT em cada requisição
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('conformia_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Controle de concorrência: single-flight para renovação de refresh token (T06)
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

      const refreshToken = localStorage.getItem('conformia_refresh_token');
      if (!refreshToken) {
        localStorage.removeItem('conformia_token');
        localStorage.removeItem('conformia_user');
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      // Se já houver uma renovação em andamento, enfileira a requisição concorrente
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
        const refreshRes = await axios.post('/api/v1/auth/refresh', { refreshToken });
        const { token: newAccessToken, refreshToken: newRefreshToken } = refreshRes.data;

        if (newAccessToken) {
          localStorage.setItem('conformia_token', newAccessToken);
          if (newRefreshToken) {
            localStorage.setItem('conformia_refresh_token', newRefreshToken);
          }

          processQueue(null, newAccessToken);
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(originalRequest);
        } else {
          throw new Error('Novo token não retornado pelo servidor.');
        }
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.removeItem('conformia_token');
        localStorage.removeItem('conformia_refresh_token');
        localStorage.removeItem('conformia_user');
        if (!window.location.pathname.includes('/login')) {
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
