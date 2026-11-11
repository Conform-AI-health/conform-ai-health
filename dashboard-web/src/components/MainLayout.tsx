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
          <div className="p-4 border-b border-slate-800/80 flex items-center gap-3 bg-[#080e22]/60">
            <div className="relative group flex-shrink-0">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/40 to-blue-600/40 rounded-2xl blur-sm opacity-50 group-hover:opacity-90 transition duration-300"></div>
              <img
                src="/img/be3f9839-118d-4ea9-bc7f-66d57b8d1b20.jpg"
                alt="Conform.AI Logo"
                className="relative h-11 w-11 rounded-xl object-cover border border-cyan-500/30 shadow-md shadow-cyan-950/60"
              />
            </div>
            <div className="flex flex-col overflow-hidden">
              <div className="flex items-center gap-1.5">
                <span className="font-black text-lg tracking-wider bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent truncate">
                  CONFORM<span className="text-cyan-400">.AI</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0"></span>
                <p className="text-[9.5px] text-cyan-300/80 font-semibold tracking-wider uppercase truncate">
                  Saúde & Deontologia
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3.5 space-y-1.5">
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400/90 flex items-center justify-between">
              <span>{isClient ? 'Ambiente da Clínica' : 'Governança & Auditoria'}</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-cyan-400 border border-slate-700/60">v1.2</span>
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-950/70 to-blue-950/40 text-cyan-300 border border-cyan-700/50 shadow-sm shadow-cyan-950/40'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 hover:border hover:border-slate-700/40'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 bg-cyan-400 rounded-r-full shadow-sm shadow-cyan-400"></span>
                      )}
                      <Icon className={`h-4 w-4 transition-colors ${isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-cyan-300'}`} />
                      <span>{item.label}</span>
                    </>
                  )}
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
        <header className="h-16 border-b border-slate-800/80 bg-[#090f22]/85 backdrop-blur-xl px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
              <Stethoscope className="h-4 w-4 text-cyan-400 shrink-0" />
              <span className="text-slate-400">Vigilância Deontológica:</span>
              <span className="px-2 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 font-mono text-[11px]">Catálogo Normativo Ativo</span>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span className="px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-800/60 text-purple-300 font-mono text-[11px] hidden sm:inline">Multiescopo Regulatório</span>
              <span className="text-slate-600 hidden md:inline">•</span>
              <span className="px-2 py-0.5 rounded-md bg-blue-950/60 border border-blue-800/60 text-blue-300 font-mono text-[11px] hidden md:inline">Vigência Dinâmica</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0b142c] border border-cyan-900/50 text-xs text-cyan-300 shadow-sm shadow-cyan-950/40">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              <span className="font-semibold text-[11px]">Motor de Auditoria & Cron Ativo</span>
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

