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

  // Forgot password state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState('');

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login', { email, password });
      const { token, user, refreshToken } = res.data;
      login(token, user, refreshToken);

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

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);

    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      setForgotSuccess(true);
    } catch (err: any) {
      setForgotError(
        err.response?.data?.error || 'Erro ao processar solicitação de recuperação.'
      );
    } finally {
      setForgotLoading(false);
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Senha Segura
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotSuccess(false);
                    setForgotError('');
                    setShowForgotModal(true);
                  }}
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition"
                >
                  Esqueceu a senha?
                </button>
              </div>
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

        {/* Modal Esqueci Minha Senha */}
        {showForgotModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#0e172e] border border-slate-700/80 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
              <div className="text-center mb-6">
                <div className="inline-flex h-12 w-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 items-center justify-center mb-3">
                  <Mail className="h-6 w-6 text-emerald-400" />
                </div>
                <h2 className="text-lg font-bold text-white">Recuperação de Senha</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Informe o e-mail cadastrado para receber instruções seguras de redefinição via Resend API.
                </p>
              </div>

              {forgotError && (
                <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl flex items-start gap-2.5 text-red-300 text-xs">
                  <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <span>{forgotError}</span>
                </div>
              )}

              {forgotSuccess ? (
                <div className="space-y-4">
                  <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-xl flex flex-col items-center gap-2 text-emerald-300 text-xs text-center">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                    <span className="font-semibold text-sm">E-mail de recuperação enviado!</span>
                    <span className="text-slate-400">
                      Se o e-mail estiver cadastrado em nossa base, um link com validade de 1 hora foi enviado. Verifique sua caixa de entrada e spam.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 px-4 rounded-xl text-xs font-semibold transition"
                  >
                    Fechar
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      E-mail Cadastrado
                    </label>
                    <div className="relative">
                      <Mail className="h-4 w-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="seu.nome@clinica.med.br"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowForgotModal(false)}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 px-3 rounded-xl text-xs font-semibold transition"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={forgotLoading}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-3 rounded-xl text-xs font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {forgotLoading ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <span>Enviar Link</span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Footer info */}
        <p className="text-center text-xs text-slate-500 mt-6 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>Isolamento Multi-tenant & Criptografia Ponta a Ponta</span>
        </p>
      </div>
    </div>
  );
};

