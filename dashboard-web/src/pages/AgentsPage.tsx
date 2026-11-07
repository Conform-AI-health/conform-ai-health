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
  Plus,
  Trash2,
  BookOpen,
  X,
  FileCode,
  Sparkles,
  Activity,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';

export const AgentsPage: React.FC = () => {
  const [modules, setModules] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [catalogNorms, setCatalogNorms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentProvider, setCurrentProvider] = useState('gemini');
  const [togglingProvider, setTogglingProvider] = useState(false);

  // Paginação dos Módulos de Agente
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [totalModules, setTotalModules] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Teste de Conectividade do Modelo de IA
  const [testingModel, setTestingModel] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Modal de Execução de Agente
  const [activeModule, setActiveModule] = useState<any>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [running, setRunning] = useState(false);

  // Modal de Cadastro de Novo Agente
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAgentData, setNewAgentData] = useState({
    name: '',
    code: '',
    description: '',
    category: 'DEONTOLOGIA_MEDICA',
    extractionMode: 'CHEERIO',
    tags: ['CFM'] as string[],
    targetNorms: [] as string[],
    systemPrompt: '',
  });
  const [creatingAgent, setCreatingAgent] = useState(false);

  const fetchData = async (page = currentPage, limit = pageSize) => {
    try {
      setLoading(true);
      const [modulesRes, clientsRes, systemRes, normsRes] = await Promise.all([
        api.get(`/agents?page=${page}&limit=${limit}`),
        api.get('/clients?limit=100'),
        api.get('/system/status'),
        api.get('/norms/catalog'),
      ]);

      if (modulesRes.data?.data && modulesRes.data?.pagination) {
        setModules(modulesRes.data.data);
        setTotalModules(modulesRes.data.pagination.total);
        setTotalPages(modulesRes.data.pagination.totalPages);
        setCurrentPage(modulesRes.data.pagination.page);
      } else if (Array.isArray(modulesRes.data)) {
        setModules(modulesRes.data);
        setTotalModules(modulesRes.data.length);
        setTotalPages(Math.ceil(modulesRes.data.length / limit) || 1);
      } else {
        setModules([]);
        setTotalModules(0);
        setTotalPages(1);
      }

      setClients(clientsRes.data?.data || []);
      setCatalogNorms(normsRes.data?.norms || []);
      if (systemRes.data?.aiProvider) {
        setCurrentProvider(systemRes.data.aiProvider);
      }
      if (clientsRes.data?.data?.[0]?.id && !selectedClientId) {
        setSelectedClientId(clientsRes.data.data[0].id);
        setTargetUrl(clientsRes.data.data[0].websiteUrl || '');
      }
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(currentPage, pageSize);
  }, [currentPage, pageSize]);

  const handleTestModel = async () => {
    try {
      setTestingModel(true);
      const res = await api.post('/system/test-ai');
      setTestResult(res.data);
      setShowTestModal(true);
    } catch (err: any) {
      setTestResult({
        provider: currentProvider,
        model: 'indisponível',
        status: 'OFFLINE',
        latencyMs: 0,
        response: `Falha na requisição ao endpoint de diagnóstico: ${err.response?.data?.error || err.message}`,
        testedAt: new Date().toISOString(),
      });
      setShowTestModal(true);
    } finally {
      setTestingModel(false);
    }
  };

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
      alert(`Auditoria disparada com sucesso utilizando o agente ${activeModule.name}!`);
      setActiveModule(null);
    } catch (err: any) {
      alert(`Falha ao executar agente: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const handleCreateAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreatingAgent(true);
      await api.post('/agents', newAgentData);
      setShowCreateModal(false);
      setNewAgentData({
        name: '',
        code: '',
        description: '',
        category: 'DEONTOLOGIA_MEDICA',
        extractionMode: 'CHEERIO',
        tags: ['CFM'],
        targetNorms: [],
        systemPrompt: '',
      });
      fetchData();
      alert('Novo agente cadastrado com sucesso!');
    } catch (err: any) {
      alert(`Erro ao cadastrar agente: ${err.response?.data?.error || err.message}`);
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleDeleteModule = async (id: string, name: string) => {
    if (!window.confirm(`Deseja realmente remover o agente "${name}"?`)) return;
    try {
      await api.delete(`/agents/${id}`);
      fetchData();
    } catch (err: any) {
      alert(`Erro ao remover agente: ${err.message}`);
    }
  };

  const toggleNormSelection = (normId: string) => {
    setNewAgentData((prev) => {
      const exists = prev.targetNorms.includes(normId);
      return {
        ...prev,
        targetNorms: exists
          ? prev.targetNorms.filter((id) => id !== normId)
          : [...prev.targetNorms, normId],
      };
    });
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Bot className="h-7 w-7 text-emerald-400" />
            <span>Módulos de Agente & Auditoria Deontológica</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Cadastre novos agentes e vincule diretamente às normas regulatórias cadastradas na base de dados.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Provedor de IA em Runtime */}
          <div className="bg-[#0b1329] border border-slate-800 rounded-xl p-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 pl-2 flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-purple-400" />
              <span>Motor IA:</span>
            </span>
            <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
              <button
                onClick={() => handleProviderToggle('gemini')}
                disabled={togglingProvider}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
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
                className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
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
                className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
                  currentProvider === 'heuristic'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Heurística
              </button>
            </div>
          </div>

          {/* Botão de Teste de Integridade do Modelo de IA */}
          <button
            onClick={handleTestModel}
            disabled={testingModel}
            className="bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/40 text-purple-200 font-semibold text-xs py-2 px-3.5 rounded-xl shadow-lg shadow-purple-950/40 flex items-center gap-2 transition disabled:opacity-50"
            title="Testar conectividade e tempo de resposta do modelo ativo"
          >
            {testingModel ? (
              <RefreshCw className="h-4 w-4 animate-spin text-purple-300" />
            ) : (
              <Sparkles className="h-4 w-4 text-purple-400" />
            )}
            <span>{testingModel ? 'Testando...' : 'Testar Modelo de IA'}</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition"
          >
            <Plus className="h-4 w-4" />
            <span>Cadastrar Novo Agente</span>
          </button>
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
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-mono">v{mod.version}</span>
                  <button
                    onClick={() => handleDeleteModule(mod.id, mod.name)}
                    className="text-slate-600 hover:text-red-400 p-1 rounded transition"
                    title="Remover agente"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <h2 className="text-lg font-bold text-white mb-1">{mod.name}</h2>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[10px] text-slate-500 uppercase font-bold">Contexto:</span>
                {(mod.tags || ['CFM']).map((t: string) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono font-bold text-emerald-400 border border-slate-700"
                  >
                    {t === 'CFM' ? '🩺' : t === 'LGPD' ? '🔒' : t === 'ANVISA' ? '💊' : '🏥'} {t}
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{mod.description}</p>

              {mod.systemPrompt && (
                <div className="mt-3 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 italic">
                  <span className="font-semibold text-slate-300 not-italic block mb-0.5">Diretriz do Prompt:</span>
                  "{mod.systemPrompt}"
                </div>
              )}

              {/* Normas Vinculadas */}
              <div className="mt-4 pt-3 border-t border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-2">
                  Normas & Dispositivos Vinculados:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {mod.targetNorms && mod.targetNorms.length > 0 ? (
                    mod.targetNorms.map((normId: string) => {
                      const matched = catalogNorms.find((n) => n.id === normId);
                      return (
                        <span
                          key={normId}
                          className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-300 text-[10px] font-mono border border-emerald-800/30"
                        >
                          {matched?.normCode || normId}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      Todas as normas do CFM 2.336/23 e LGPD ({mod.rulesCount} regras)
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/80">
                <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Regras no Escopo
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
                <span>Auditar com Este Agente</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Paginação dos Módulos */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalModules}
        itemsPerPage={pageSize}
        onPageChange={(p) => setCurrentPage(p)}
        onLimitChange={(l) => setPageSize(l)}
        limitOptions={[4, 6, 12, 24]}
        itemLabel="módulos de agente"
      />

      {/* Modal de Cadastro de Novo Agente */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Bot className="h-5 w-5 text-emerald-400" />
                <span>Cadastrar Novo Agente de Auditoria</span>
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mt-2">
              Defina as características do agente e selecione os artigos normativos da base que ele deve auditar no site.
            </p>

            <form onSubmit={handleCreateAgentSubmit} className="space-y-4 mt-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nome do Agente *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAgentData.name}
                    onChange={(e) => setNewAgentData({ ...newAgentData, name: e.target.value })}
                    placeholder="Ex: Auditor de Telemedicina & Prescrição"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Código Identificador Único *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAgentData.code}
                    onChange={(e) =>
                      setNewAgentData({ ...newAgentData, code: e.target.value.toUpperCase() })
                    }
                    placeholder="Ex: CFM-TELEMED-2454"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Descrição dos Objetivos *
                </label>
                <input
                  type="text"
                  required
                  value={newAgentData.description}
                  onChange={(e) =>
                    setNewAgentData({ ...newAgentData, description: e.target.value })
                  }
                  placeholder="Verificação de consentimento informado, segurança de prontuário e assinatura digital."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Categoria Deontológica
                  </label>
                  <select
                    value={newAgentData.category}
                    onChange={(e) => setNewAgentData({ ...newAgentData, category: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="DEONTOLOGIA_MEDICA">Deontologia Médica (CFM)</option>
                    <option value="PRIVACIDADE_DADOS">Privacidade & Dados Sensíveis (LGPD)</option>
                    <option value="SAUDE_SUPLEMENTAR">Saúde Suplementar (ANS)</option>
                    <option value="VIGILANCIA_SANITARIA">Vigilância Sanitária (ANVISA)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Modo de Extração Web
                  </label>
                  <select
                    value={newAgentData.extractionMode}
                    onChange={(e) =>
                      setNewAgentData({ ...newAgentData, extractionMode: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    <option value="CHEERIO">CHEERIO (HTML Estático Ultrarrápido)</option>
                    <option value="PUPPETEER">PUPPETEER (SPA Dinâmica / Headless)</option>
                    <option value="FIRECRAWL">FIRECRAWL (API de Markdown Limpo)</option>
                    <option value="MCP">MCP (Model Context Protocol)</option>
                  </select>
                </div>
              </div>

              {/* Tags de Contexto do Agente */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Tags de Contexto do Agente (Escopo de Varredura):</span>
                  <span className="text-[11px] text-emerald-400 font-mono">
                    {newAgentData.tags.join(', ')}
                  </span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {['CFM', 'LGPD', 'ANVISA', 'ANS'].map((tag) => {
                    const isSelected = newAgentData.tags.includes(tag);
                    return (
                      <button
                        type="button"
                        key={tag}
                        onClick={() => {
                          setNewAgentData((prev) => ({
                            ...prev,
                            tags: prev.tags.includes(tag)
                              ? prev.tags.filter((t) => t !== tag)
                              : [...prev.tags, tag],
                          }));
                        }}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition ${
                          isSelected
                            ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                            : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {tag === 'CFM' ? '🩺' : tag === 'LGPD' ? '🔒' : tag === 'ANVISA' ? '💊' : '🏥'} {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Seleção de Normas da Base */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Selecione as Normas da Base a serem Utilizadas pelo Agente:</span>
                  </span>
                  <span className="text-[11px] text-emerald-400 font-mono">
                    {newAgentData.targetNorms.length} selecionada(s)
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-900/80 rounded-xl border border-slate-800">
                  {catalogNorms.map((norm) => {
                    const isSelected = newAgentData.targetNorms.includes(norm.id);
                    return (
                      <div
                        key={norm.id}
                        onClick={() => toggleNormSelection(norm.id)}
                        className={`p-2.5 rounded-lg border text-left cursor-pointer transition flex items-start gap-2.5 ${
                          isSelected
                            ? 'bg-emerald-950/40 border-emerald-600 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                        />
                        <div className="overflow-hidden">
                          <span className="text-[11px] font-bold block text-emerald-300 truncate">
                            {norm.normCode} — {norm.article}
                          </span>
                          <span className="text-[10px] text-slate-300 line-clamp-1">
                            {norm.title}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Prompt de Sistema / Regra Personalizada */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                  <FileCode className="h-3.5 w-3.5 text-purple-400" />
                  <span>Diretrizes Deontológicas / Prompt Adicional do Agente</span>
                </label>
                <textarea
                  rows={2}
                  value={newAgentData.systemPrompt}
                  onChange={(e) =>
                    setNewAgentData({ ...newAgentData, systemPrompt: e.target.value })
                  }
                  placeholder="Instruções deontológicas específicas para calibração do modelo..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingAgent}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-5 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {creatingAgent ? 'Salvando...' : 'Salvar Novo Agente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Disparar Auditoria com o Agente */}
      {activeModule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-emerald-400 fill-emerald-400" />
              <span>Disparar {activeModule.name}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure a clínica e canal para execução da auditoria com o modo {activeModule.extractionMode}.
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

      {/* Modal de Diagnóstico do Modelo de IA */}
      {showTestModal && testResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-950/60 border border-purple-800/40">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Diagnóstico do Modelo de IA</h3>
                  <span className="text-xs text-slate-400">Verificação de integridade e resposta em tempo real</span>
                </div>
              </div>
              <button
                onClick={() => setShowTestModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {/* Badges de Status e Métricas */}
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Status</span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                      testResult.status === 'ONLINE'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                        : testResult.status === 'DEGRADED'
                        ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                        : 'bg-red-950 text-red-400 border border-red-800/60'
                    }`}
                  >
                    {testResult.status === 'ONLINE' && <CheckCircle2 className="h-3 w-3" />}
                    {testResult.status === 'DEGRADED' && <AlertCircle className="h-3 w-3" />}
                    {testResult.status === 'OFFLINE' && <X className="h-3 w-3" />}
                    {testResult.status}
                  </span>
                </div>

                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Latência</span>
                  <span className="text-xs font-mono font-bold text-white flex items-center justify-center gap-1">
                    <Clock className="h-3 w-3 text-purple-400" />
                    {testResult.latencyMs} ms
                  </span>
                </div>

                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Motor</span>
                  <span className="text-xs font-mono font-bold text-slate-200 truncate block">
                    {testResult.provider?.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Detalhes do Modelo */}
              <div className="p-3.5 bg-slate-900/50 border border-slate-800 rounded-xl text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Modelo Utilizado:</span>
                  <span className="text-slate-200 font-semibold">{testResult.model}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Data/Hora do Teste:</span>
                  <span className="text-slate-300">
                    {testResult.testedAt ? new Date(testResult.testedAt).toLocaleTimeString('pt-BR') : '-'}
                  </span>
                </div>
              </div>

              {/* Resposta do Modelo */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Resposta Retornada pelo Modelo:</span>
                </label>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 max-h-48 overflow-y-auto leading-relaxed">
                  {testResult.response || 'Sem resposta.'}
                </div>
              </div>

              {/* Ações */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleTestModel}
                  disabled={testingModel}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition flex items-center gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testingModel ? 'animate-spin' : ''}`} />
                  <span>Testar Novamente</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowTestModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-xl shadow-lg shadow-purple-950/40 transition"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
