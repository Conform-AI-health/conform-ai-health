import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Shield,
  LayoutDashboard,
  Building2,
  Bot,
  FileCheck2,
  BookOpen,
  LogOut,
  User as UserIcon,
  ChevronRight,
  Stethoscope,
  Activity,
  Sparkles,
  Terminal,
  Globe,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export const MainLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const isClient = user?.role === 'CLIENT';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = isClient
    ? [
        { label: 'Portal da Clínica', path: '/portal', icon: Shield },
        { label: 'Laudos Técnicos', path: '/reports', icon: FileCheck2 },
      ]
    : [
        { label: 'Cockpit do Auditor', path: '/cockpit', icon: LayoutDashboard },
        { label: 'Varredura & Tags', path: '/scraping', icon: Globe },
        { label: 'Clínicas & Clientes', path: '/clients', icon: Building2 },
        { label: 'Módulos de Auditoria', path: '/agents', icon: Bot },
        { label: 'Laudos Deontológicos', path: '/reports', icon: FileCheck2 },
        { label: 'Logs & Telemetria IA', path: '/logs', icon: Terminal },
      ];

  return (
    <div className="flex h-screen bg-[#070d1e] text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-[#0b1329] flex flex-col justify-between flex-shrink-0">
        <div>
          {/* Logo Header */}
          <div className="p-5 border-b border-slate-800 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/40">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-emerald-400 bg-clip-text text-transparent">
                ConformIA
              </span>
              <p className="text-[10px] text-emerald-400 font-semibold tracking-wider uppercase">
                Saúde & Deontologia
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {isClient ? 'Ambiente da Clínica' : 'Governança & Auditoria'}
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/20 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* User Card & Profile Footer */}
        <div className="p-4 border-t border-slate-800 bg-[#090f22] space-y-3">
          {/* User profile */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="h-9 w-9 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 border border-slate-700 flex-shrink-0">
                <UserIcon className="h-4 w-4" />
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-slate-200 truncate">{user?.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`inline-block px-1.5 py-0.2 text-[9px] font-bold rounded ${
                      user?.role === 'ADMIN'
                        ? 'bg-purple-500/20 text-purple-400'
                        : user?.role === 'AUDITOR'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {user?.role}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate">
                    {user?.client ? user.client.tradeName || user.client.name : user?.email}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Encerrar sessão"
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-[#070d1e] flex flex-col">
        {/* Top Navbar */}
        <header className="h-16 border-b border-slate-800/80 bg-[#090f22]/70 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Stethoscope className="h-4 w-4 text-emerald-400" />
              <span>Resolução CFM nº</span>
              <span className="text-slate-600">•</span>
              <span>ANS RN 509/395</span>
              <span className="text-slate-600">•</span>
              <span>LGPD Art. 11</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-xs text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Motor de Reconciliação Operacional</span>
            </div>
          </div>
        </header>

        {/* Page Content View */}
        <div className="p-8 flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

