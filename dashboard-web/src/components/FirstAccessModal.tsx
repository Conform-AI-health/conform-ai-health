import React, { useState } from 'react';
import { KeyRound, ShieldAlert, CheckCircle2, Lock, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { useToast } from '../context/ToastContext';

export const FirstAccessModal: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const toast = useToast();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Se o usuário não precisa alterar senha, não exibe nada
  if (!user || !user.mustChangePassword) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword.length < 8) {
      setErrorMsg('A nova senha deve possuir pelo menos 8 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('A confirmação de senha não confere com a nova senha digitada.');
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/auth/first-access-password', { newPassword });
      toast.success('Senha definitiva configurada com sucesso! Bem-vindo ao Portal da Clínica.');
      await refreshUser();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Falha ao redefinir a senha inicial.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in">
      <div className="bg-[#0b132b] border border-cyan-800/60 rounded-3xl w-full max-w-md p-6 lg:p-8 shadow-2xl relative text-left space-y-6">
        {/* Cabeçalho */}
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-950/80 to-blue-950/80 border border-cyan-700/60 text-cyan-400 flex-shrink-0 shadow-lg shadow-cyan-950/50">
            <KeyRound className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-700/60">
                Primeiro Acesso Obrigatório
              </span>
            </div>
            <h2 className="text-lg font-black text-white tracking-tight mt-1">
              Defina sua Nova Senha Institucional
            </h2>
          </div>
        </div>

        {/* Mensagem explicativa */}
        <div className="p-3.5 rounded-2xl bg-[#080e22] border border-slate-800 text-xs text-slate-300 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-cyan-300">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Segurança & Governança em Saúde</span>
          </div>
          <p className="leading-relaxed text-slate-400">
            Olá, <strong className="text-white">{user.name || user.email}</strong>. Sua conta institucional foi
            configurada com uma senha provisória. Por conformidade com a LGPD e governança deontológica, defina sua nova
            senha pessoal para liberar o acesso ao Portal.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Nova Senha Pessoal *
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
                className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-white transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Confirmar Nova Senha *
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite a mesma senha novamente"
              className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-950/60 disabled:opacity-50 transition"
            >
              {submitting ? (
                <span>Salvando Nova Senha...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Definir Senha & Liberar Portal</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
