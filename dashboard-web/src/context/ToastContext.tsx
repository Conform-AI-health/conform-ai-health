import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message: string;
}

interface ToastContextData {
  showToast: (message: string, type?: ToastType, title?: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextData>({} as ToastContextData);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', customTitle?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const defaultTitle =
        type === 'success'
          ? 'Sucesso'
          : type === 'error'
          ? 'Erro do Sistema'
          : type === 'warning'
          ? 'Atenção'
          : 'Notificação';

      const title = customTitle || defaultTitle;
      const newToast: ToastItem = { id, type, title, message };

      setToasts((prev) => [...prev, newToast]);

      // Auto dismiss após 4.5 segundos
      setTimeout(() => {
        removeToast(id);
      }, 4500);
    },
    [removeToast]
  );

  const success = useCallback((message: string, title?: string) => showToast(message, 'success', title), [showToast]);
  const error = useCallback((message: string, title?: string) => showToast(message, 'error', title), [showToast]);
  const warning = useCallback((message: string, title?: string) => showToast(message, 'warning', title), [showToast]);
  const info = useCallback((message: string, title?: string) => showToast(message, 'info', title), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info, removeToast }}>
      {children}

      {/* Contêiner de Toasts fixado no canto superior direito (Estilo Bootstrap Toast Moderno) */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed top-6 right-6 z-[99999] flex flex-col gap-3 max-w-sm w-full pointer-events-none"
      >
        {toasts.map((toast) => {
          const isSuccess = toast.type === 'success';
          const isError = toast.type === 'error';
          const isWarning = toast.type === 'warning';

          const borderColor = isSuccess
            ? 'border-emerald-500/50 bg-[#061e14]/95 shadow-emerald-950/50'
            : isError
            ? 'border-red-500/50 bg-[#1e0808]/95 shadow-red-950/50'
            : isWarning
            ? 'border-amber-500/50 bg-[#1e1506]/95 shadow-amber-950/50'
            : 'border-cyan-500/50 bg-[#061826]/95 shadow-cyan-950/50';

          const iconColor = isSuccess
            ? 'text-emerald-400'
            : isError
            ? 'text-red-400'
            : isWarning
            ? 'text-amber-400'
            : 'text-cyan-400';

          const titleColor = isSuccess
            ? 'text-emerald-300'
            : isError
            ? 'text-red-300'
            : isWarning
            ? 'text-amber-300'
            : 'text-cyan-300';

          return (
            <div
              key={toast.id}
              role="alert"
              className={`pointer-events-auto rounded-xl border p-4 shadow-2xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-4 ${borderColor}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className={`mt-0.5 shrink-0 ${iconColor}`}>
                    {isSuccess && <CheckCircle2 className="h-5 w-5" />}
                    {isError && <AlertCircle className="h-5 w-5" />}
                    {isWarning && <AlertTriangle className="h-5 w-5" />}
                    {toast.type === 'info' && <Info className="h-5 w-5" />}
                  </div>
                  <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider ${titleColor}`}>
                      {toast.title}
                    </h4>
                    <p className="text-xs text-slate-200 mt-1 leading-relaxed whitespace-pre-wrap">
                      {toast.message}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition shrink-0"
                  title="Fechar notificação"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
