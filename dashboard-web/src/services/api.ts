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

// Interceptor para renovação automática via Refresh Token no status 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Se receber 401 e não for requisição de autenticação e ainda não tiver tentado retry
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('conformia_refresh_token');

      if (refreshToken) {
        try {
          // Utiliza instância limpa do axios para evitar interceptores em loop
          const refreshRes = await axios.post('/api/v1/auth/refresh', { refreshToken });
          const { token: newAccessToken, refreshToken: newRefreshToken } = refreshRes.data;

          if (newAccessToken) {
            localStorage.setItem('conformia_token', newAccessToken);
            if (newRefreshToken) {
              localStorage.setItem('conformia_refresh_token', newRefreshToken);
            }

            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return api(originalRequest);
          }
        } catch {
          // Refresh token expirado ou inválido
          localStorage.removeItem('conformia_token');
          localStorage.removeItem('conformia_refresh_token');
          localStorage.removeItem('conformia_user');
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }
        }
      } else {
        localStorage.removeItem('conformia_token');
        localStorage.removeItem('conformia_user');
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

