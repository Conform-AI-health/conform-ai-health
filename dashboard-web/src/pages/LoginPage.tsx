import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Mail, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login', { email, password });
      const { token, user } = res.data;
      login(token, user);

      if (user.role === 'CLIENT') {
        navigate('/portal');
      } else {
        navigate('/cockpit');
      }
    } catch (err: any) {
      setErrorMessage(
        err.response?.data?.error || 'Falha ao autenticar. Verifique e-mail e senha.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070d1e] flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Background Glows */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        {/* Card */}
        <div className="bg-[#0b1329]/95 border border-slate-800/90 rounded-3xl shadow-2xl p-8 backdrop-blur-2xl relative overflow-hidden">
          {/* Subtle top glow bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600"></div>

          {/* Logo & Headline */}
          <div className="text-center mb-7">
            <div className="relative inline-flex mb-4 group">
              <div className="absolute -inset-2 bg-gradient-to-tr from-cyan-500/30 to-blue-600/30 rounded-3xl blur-md opacity-70 group-hover:opacity-100 transition duration-500"></div>
              <img
                src="/img/be3f9839-118d-4ea9-bc7f-66d57b8d1b20.jpg"
                alt="Conform.AI Logo"
                className="relative h-20 w-20 rounded-2xl object-cover border-2 border-cyan-400/40 shadow-xl shadow-cyan-950/70"
              />
            </div>
            <h1 className="text-2xl font-black text-white tracking-wider flex items-center justify-center gap-1">
              CONFORM<span className="text-cyan-400">.AI</span>
            </h1>
            <p className="text-xs text-slate-300 font-medium mt-1">
              Governança Regulatória & Inteligência Deontológica em Saúde
            </p>
            <div className="flex items-center justify-center gap-1.5 mt-2.5 flex-wrap">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/70 border border-cyan-800/60 text-cyan-300 font-bold">#CFM-2336</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950/70 border border-purple-800/60 text-purple-300 font-bold">#LGPD</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950/70 border border-blue-800/60 text-blue-300 font-bold">#ANVISA</span>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-6 p-3.5 bg-red-950/50 border border-red-800/70 rounded-xl flex items-start gap-3 text-red-300 text-xs">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                E-mail Profissional
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.nome@clinica.med.br"
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 transition font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Senha Segura
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 transition font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-cyan-950/60 flex items-center justify-center gap-2 transition duration-200 disabled:opacity-50"
            >
              {loading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              ) : (
                <>
                  <span>Acessar Plataforma</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-slate-500 mt-6 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>Isolamento Multi-tenant & Criptografia Ponta a Ponta</span>
        </p>
      </div>
    </div>
  );
};

