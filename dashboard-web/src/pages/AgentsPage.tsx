import React, { useState, useEffect } from 'react';
import {
  Bot,
  Play,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Zap,
  Sliders,
} from 'lucide-react';
import { api } from '../services/api';

export const AgentsPage: React.FC = () => {
  const [modules, setModules] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentProvider, setCurrentProvider] = useState('gemini');
  const [togglingProvider, setTogglingProvider] = useState(false);

  // Modal de execução
  const [activeModule, setActiveModule] = useState<any>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [running, setRunning] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [modulesRes, clientsRes, systemRes] = await Promise.all([
        api.get('/agents'),
        api.get('/clients?limit=100'),
        api.get('/system/status'),
      ]);

      setModules(modulesRes.data || []);
      setClients(clientsRes.data?.data || []);
      if (systemRes.data?.aiProvider) {
        setCurrentProvider(systemRes.data.aiProvider);
      }
      if (clientsRes.data?.data?.[0]?.id) {
        setSelectedClientId(clientsRes.data.data[0].id);
        setTargetUrl(clientsRes.data.data[0].websiteUrl || '');
      }
    } catch (err) {
      console.error('Erro ao buscar módulos de agente:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleProviderToggle = async (newProvider: 'gemini' | 'ollama' | 'heuristic') => {
    try {
      setTogglingProvider(true);
      await api.post('/system/toggle-provider', { provider: newProvider });
      setCurrentProvider(newProvider);
    } catch (err: any) {
      alert(`Erro ao alternar provedor: ${err.message}`);
    } finally {
      setTogglingProvider(false);
    }
  };

  const handleRunModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeModule) return;

    try {
      setRunning(true);
      await api.post(`/agents/${activeModule.id}/run`, {
        clientId: selectedClientId,
        targetUrl,
        extractionMode: activeModule.extractionMode,
      });
      alert(`Auditoria disparada com o agente ${activeModule.name}!`);
      setActiveModule(null);
    } catch (err: any) {
      alert(`Falha ao executar agente: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Bot className="h-7 w-7 text-emerald-400" />
            <span>Módulos de Auditoria Especializados</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Agentes virtuais autônomos calibrados para varredura e conciliação normativa de saúde.
          </p>
        </div>

        {/* Provedor de IA em Runtime */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-xl p-2 flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 pl-2 flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-purple-400" />
            <span>Motor de IA:</span>
          </span>
          <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
            <button
              onClick={() => handleProviderToggle('gemini')}
              disabled={togglingProvider}
              className={`px-3 py-1 rounded text-xs font-semibold transition ${
                currentProvider === 'gemini'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Gemini 2.0 Flash
            </button>
            <button
              onClick={() => handleProviderToggle('ollama')}
              disabled={togglingProvider}
              className={`px-3 py-1 rounded text-xs font-semibold transition ${
                currentProvider === 'ollama'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Ollama Local
            </button>
            <button
              onClick={() => handleProviderToggle('heuristic')}
              disabled={togglingProvider}
              className={`px-3 py-1 rounded text-xs font-semibold transition ${
                currentProvider === 'heuristic'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Heurística Regex
            </button>
          </div>
        </div>
      </div>

      {/* Grid de Agentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {modules.map((mod) => (
          <div
            key={mod.id}
            className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg hover:border-slate-700 transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono font-bold text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-800/40">
                  {mod.code}
                </span>
                <span className="text-xs text-slate-500 font-mono">v{mod.version}</span>
              </div>

              <h2 className="text-lg font-bold text-white mb-2">{mod.name}</h2>
              <p className="text-xs text-slate-400 leading-relaxed">{mod.description}</p>

              <div className="mt-5 grid grid-cols-2 gap-3 pt-4 border-t border-slate-800/80">
                <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Regras Verificadas
                  </span>
                  <span className="text-base font-extrabold text-slate-200 mt-0.5 block">
                    {mod.rulesCount} artigos
                  </span>
                </div>
                <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Modo de Extração
                  </span>
                  <span className="text-base font-extrabold text-emerald-400 mt-0.5 block font-mono">
                    {mod.extractionMode}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-emerald-400/80 flex items-center gap-1 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> Prontidão Ativa
              </span>
              <button
                onClick={() => {
                  setActiveModule(mod);
                  const firstClient = clients[0];
                  if (firstClient) {
                    setSelectedClientId(firstClient.id);
                    setTargetUrl(firstClient.websiteUrl || '');
                  }
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition shadow-sm"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>Executar Este Agente</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Executar Agente */}
      {activeModule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-emerald-400 fill-emerald-400" />
              <span>Disparar {activeModule.name}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure o canal da clínica para execução da auditoria com o modo {activeModule.extractionMode}.
            </p>

            <form onSubmit={handleRunModule} className="space-y-4 mt-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Clínica Alvo
                </label>
                <select
                  value={selectedClientId}
                  onChange={(e) => {
                    setSelectedClientId(e.target.value);
                    const selected = clients.find((c) => c.id === e.target.value);
                    if (selected?.websiteUrl) setTargetUrl(selected.websiteUrl);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (CRM/{c.crmUf} {c.crmResponsavel})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  URL / Canal a Auditar
                </label>
                <input
                  type="url"
                  required
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModule(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={running}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-4 rounded-xl transition"
                >
                  {running ? 'Processando...' : 'Iniciar Varredura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

