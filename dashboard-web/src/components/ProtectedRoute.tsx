import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { user, token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
          <span className="text-sm text-slate-400 font-medium">Validando credenciais éticas...</span>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redireciona dinamicamente para a home apropriada do papel
    if (user.role === 'CLIENT') {
      return <Navigate to="/portal" replace />;
    }
    return <Navigate to="/cockpit" replace />;
  }

  return <Outlet />;
};

