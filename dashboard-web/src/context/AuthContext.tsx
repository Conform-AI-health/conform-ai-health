import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  api,
  getInMemoryRefreshToken,
  setInMemoryRefreshToken,
  clearInMemoryRefreshToken,
} from '../services/api';

export type UserRole = 'ADMIN' | 'AUDITOR' | 'CLIENT' | 'VIEWER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  clientId?: string | null;
  client?: {
    id: string;
    name: string;
    tradeName?: string;
    crmResponsavel: string;
    crmUf: string;
    status: string;
  } | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User, refreshToken?: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    const savedUser = localStorage.getItem('conformia_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const [token, setToken] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('conformia_token');
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const login = (newToken: string, newUser: User, refreshToken?: string) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('conformia_token', newToken);
      localStorage.setItem('conformia_user', JSON.stringify(newUser));
      // Garante que o refresh token NUNCA seja armazenado em localStorage (C06 - SEC)
      localStorage.removeItem('conformia_refresh_token');
    }

    if (refreshToken) {
      setInMemoryRefreshToken(refreshToken);
    }

    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    const refreshToken = getInMemoryRefreshToken();

    // Notifica backend para invalidar refresh token e limpar cookies HttpOnly
    api.post('/auth/logout', refreshToken ? { refreshToken } : {}).catch(() => {});

    clearInMemoryRefreshToken();

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('conformia_token');
      localStorage.removeItem('conformia_refresh_token');
      localStorage.removeItem('conformia_user');
    }

    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      if (token) {
        const res = await api.get('/auth/me');
        if (res.data?.user) {
          setUser(res.data.user);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('conformia_user', JSON.stringify(res.data.user));
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar usuário:', err);
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      const savedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('conformia_token') : null;
      if (savedToken) {
        try {
          const res = await api.get('/auth/me');
          if (res.data?.user) {
            setUser(res.data.user);
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('conformia_user', JSON.stringify(res.data.user));
            }
          }
        } catch (err) {
          logout();
        }
      } else {
        // Tenta silenciosamente renovar sessão ativa via cookie HttpOnly (C06)
        try {
          const refreshRes = await api.post('/auth/refresh', {});
          if (refreshRes.data?.token && refreshRes.data?.user) {
            login(refreshRes.data.token, refreshRes.data.user, refreshRes.data.refreshToken);
          }
        } catch {
          // Sessão não existente ou expirada
        }
      }
      setIsLoading(false);
    };

    checkAuth();

    // Sincronização entre múltiplas abas via BroadcastChannel (C06)
    let channel: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        channel = new BroadcastChannel('conformia_auth_channel');
        channel.onmessage = (event) => {
          if (event.data?.type === 'LOGOUT') {
            clearInMemoryRefreshToken();
            setToken(null);
            setUser(null);
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('conformia_token');
              localStorage.removeItem('conformia_user');
            }
          }
        };
      } catch {
        // Falha tolerável de suporte a broadcast
      }
    }

    return () => {
      if (channel) {
        channel.close();
      }
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};
