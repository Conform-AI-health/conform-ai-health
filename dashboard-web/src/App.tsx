import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { MainLayout } from './components/MainLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CustomerDashboardPage } from './pages/CustomerDashboardPage';
import { ClientsPage } from './pages/ClientsPage';
import { AgentsPage } from './pages/AgentsPage';
import { ReportsPage } from './pages/ReportsPage';
import { LogsTelemetryPage } from './pages/LogsTelemetryPage';
import { ScrapingPage } from './pages/ScrapingPage';

const RootRedirect: React.FC = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'CLIENT') return <Navigate to="/portal" replace />;
  return <Navigate to="/cockpit" replace />;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Rotas Autenticadas compartilhando MainLayout */}
            <Route element={<ProtectedRoute />}>
              <Route element={<MainLayout />}>
                {/* Cockpit do Auditor (Apenas ADMIN e AUDITOR) */}
                <Route element={<ProtectedRoute allowedRoles={['ADMIN', 'AUDITOR']} />}>
                  <Route path="/cockpit" element={<DashboardPage />} />
                  <Route path="/scraping" element={<ScrapingPage />} />
                  <Route path="/clients" element={<ClientsPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/logs" element={<LogsTelemetryPage />} />
                </Route>

                {/* Portal do Cliente (Apenas CLIENT) */}
                <Route element={<ProtectedRoute allowedRoles={['CLIENT']} />}>
                  <Route path="/portal" element={<CustomerDashboardPage />} />
                </Route>

                {/* Rotas Comuns */}
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/norms" element={<Navigate to="/cockpit" replace />} />

                {/* Redirect Raiz */}
                <Route path="/" element={<RootRedirect />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
};

