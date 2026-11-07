import React, { useState, useEffect } from 'react';
import {
  Bot,
  Play,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Plus,
  Trash2,
  X,
  FileCode,
  Sparkles,
  Activity,
  Clock,
  AlertCircle,
  ExternalLink,
  Layers,
  Settings2,
  Globe,
  Radio,
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';

export const AgentsPage: React.FC = () => {
  // Aba Ativa: 'agents' | 'models' | 'run'
  const [activeTab, setActiveTab] = useState<'agents' | 'models' | 'run'>('agents');

  // Dados
  const [modules, setModules] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [catalogNorms, setCatalogNorms] = useState<any[]>([]);
  const [aiModels, setAiModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Paginação dos Módulos de Agente
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [totalModules, setTotalModules] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Teste de Conectividade do Modelo de IA
  const [testingModel, setTestingModel] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [selectedModelIdForTest, setSelectedModelIdForTest] = useState<string>('');

  // Execução de Agente
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedMode, setSelectedMode] = useState('CHEERIO');
  const [running, setRunning] = useState(false);

  // Modal de Cadastro de Novo Agente
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);
  const [newAgentData, setNewAgentData] = useState({
    clientId: '',
    regulatoryFramework: 'CFM (Resolução 2.336/2023)',
    name: '',
    code: '',
    description: '',
    cronSchedule: '0 */6 * * *',
    enabled: true,
    extractionMode: 'CHEERIO',
    targetUrl: '',
    apiEndpoint: '',
    mcpUri: '',
    targetNorms: [] as string[],
  });
  const [creatingAgent, setCreatingAgent] = useState(false);

  // Modal de Cadastro de Novo Modelo de IA no Banco
  const [showCreateModelModal, setShowCreateModelModal] = useState(false);
  const [newModelData, setNewModelData] = useState({
    name: '',
    provider: 'gemini',
    modelId: '',
    baseUrl: '',
    apiKey: '',
    temperature: 0.2,
    maxTokens: 2048,
    description: '',
    isActive: false,
  });
  const [creatingModel, setCreatingModel] = useState(false);
  const [activatingModelId, setActivatingModelId] = useState('');

  const fetchData = async (page = currentPage, limit = pageSize) => {
    try {
      setLoading(true);
      const [modulesRes, clientsRes, normsRes, modelsRes] = await Promise.all([
        api.get(`/agents?page=${page}&limit=${limit}`),
        api.get('/clients?limit=100'),
        api.get('/norms/catalog'),
        api.get('/models?limit=50').catch(() => ({ data: { data: [] } })),
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
      setAiModels(modelsRes.data?.data || []);

      if (modulesRes.data?.data?.[0]?.id && !selectedModuleId) {
        setSelectedModuleId(modulesRes.data.data[0].id);
      } else if (Array.isArray(modulesRes.data) && modulesRes.data[0]?.id && !selectedModuleId) {
        setSelectedModuleId(modulesRes.data[0].id);
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

  // Abrir Modal de Teste de Modelo com seleção de modelos do banco
  const handleOpenTestModal = (modelId?: string) => {
    const active = aiModels.find((m) => m.isActive);
    const initialId = modelId || active?.id || aiModels[0]?.id || '';
    setSelectedModelIdForTest(initialId);
    setShowTestModal(true);
    handleRunModelTest(initialId);
  };

  // Testar Modelo de IA
  const handleRunModelTest = async (modelIdToTest?: string) => {
    const targetId = modelIdToTest || selectedModelIdForTest;
    try {
      setTestingModel(true);
      const res = await api.post('/system/test-ai', { modelConfigId: targetId });
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({
        provider: 'desconhecido',
        model: 'indisponível',
        status: 'OFFLINE',
        latencyMs: 0,
        response: `Falha na requisição ao endpoint de diagnóstico: ${err.response?.data?.error || err.message}`,
        testedAt: new Date().toISOString(),
      });
    } finally {
      setTestingModel(false);
    }
  };

  // Ativar Modelo no Banco
  const handleActivateModel = async (modelId: string) => {
    try {
      setActivatingModelId(modelId);
      await api.post(`/models/${modelId}/activate`);
      await fetchData(currentPage, pageSize);
    } catch (err: any) {
      alert(`Erro ao ativar modelo: ${err.response?.data?.error || err.message}`);
    } finally {
      setActivatingModelId('');
    }
  };

  // Excluir Modelo do Banco
  const handleDeleteModel = async (modelId: string, modelName: string) => {
    if (!window.confirm(`Deseja realmente remover o modelo "${modelName}" do banco?`)) return;
    try {
      await api.delete(`/models/${modelId}`);
      await fetchData(currentPage, pageSize);
    } catch (err: any) {
      alert(`Erro ao remover modelo: ${err.response?.data?.error || err.message}`);
    }
  };

  // Criar Modelo de IA no Banco
  const handleCreateModelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreatingModel(true);
      await api.post('/models', newModelData);
      setShowCreateModelModal(false);
      setNewModelData({
        name: '',
        provider: 'gemini',
        modelId: '',
        baseUrl: '',
        apiKey: '',
        temperature: 0.2,
        maxTokens: 2048,
        description: '',
        isActive: false,
      });
      await fetchData(currentPage, pageSize);
      alert('Novo modelo de IA cadastrado com sucesso no banco de dados!');
    } catch (err: any) {
      alert(`Erro ao cadastrar modelo: ${err.response?.data?.error || err.message}`);
    } finally {
      setCreatingModel(false);
    }
  };

  // Criar Agente
  const handleCreateAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreatingAgent(true);
      await api.post('/agents', {
        name: newAgentData.name,
        code: newAgentData.code,
        description: newAgentData.description,
        clientId: newAgentData.clientId || null,
        regulatoryFramework: newAgentData.regulatoryFramework,
        cronSchedule: newAgentData.cronSchedule,
        enabled: newAgentData.enabled,
        extractionMode: newAgentData.extractionMode,
        targetUrl: newAgentData.targetUrl || null,
      });
      setShowCreateAgentModal(false);
      setNewAgentData({
        clientId: '',
        regulatoryFramework: 'CFM (Resolução 2.336/2023)',
        name: '',
        code: '',
        description: '',
        cronSchedule: '0 */6 * * *',
        enabled: true,
        extractionMode: 'CHEERIO',
        targetUrl: '',
        apiEndpoint: '',
        mcpUri: '',
        targetNorms: [],
      });
      fetchData(currentPage, pageSize);
      alert('Módulo de agente cadastrado com sucesso!');
    } catch (err: any) {
      alert(`Erro ao cadastrar agente: ${err.response?.data?.error || err.message}`);
    } finally {
      setCreatingAgent(false);
    }
  };

  // Excluir Agente
  const handleDeleteModule = async (id: string, name: string) => {
    if (!window.confirm(`Deseja realmente remover o agente "${name}"?`)) return;
    try {
      await api.delete(`/agents/${id}`);
      fetchData(currentPage, pageSize);
    } catch (err: any) {
      alert(`Erro ao remover agente: ${err.message}`);
    }
  };

  // Disparar Auditoria
  const handleRunAuditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModuleId) {
      alert('Selecione um agente de auditoria.');
      return;
    }

    try {
      setRunning(true);
      await api.post(`/agents/${selectedModuleId}/run`, {
        clientId: selectedClientId,
        targetUrl,
        extractionMode: selectedMode,
      });
      alert('Auditoria deontológica disparada com sucesso! Acompanhe o processamento no Cockpit ou Laudos.');
    } catch (err: any) {
      alert(`Falha ao disparar auditoria: ${err.response?.data?.error || err.message}`);
    } finally {
      setRunning(false);
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

  const activeModel = aiModels.find((m) => m.isActive);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Consolidado */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Bot className="h-7 w-7 text-emerald-400" />
            <span>Módulos de Agente & Governança de IA</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Gestão de módulos deontológicos (CFM 2.336/23, LGPD) e controle de modelos de linguagem persistidos no MongoDB.
          </p>
        </div>

        {/* Modelo Ativo & Botão de Teste */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="bg-[#0b1329] border border-slate-800 rounded-xl px-3.5 py-2 flex items-center gap-2 text-xs">
            <span className="text-slate-400 flex items-center gap-1.5 font-semibold">
              <Cpu className="h-4 w-4 text-purple-400" />
              <span>Motor Ativo:</span>
            </span>
            <span className="font-mono font-bold text-white px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/40 text-[11px]">
              {activeModel ? `${activeModel.name} (${activeModel.provider})` : 'Gemini 2.0 Flash'}
            </span>
          </div>

          <button
            onClick={() => handleOpenTestModal()}
            disabled={testingModel}
            className="bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/40 text-purple-200 font-semibold text-xs py-2 px-3.5 rounded-xl shadow-lg shadow-purple-950/40 flex items-center gap-2 transition disabled:opacity-50"
            title="Testar conectividade e tempo de resposta dos modelos de IA"
          >
            {testingModel ? (
              <RefreshCw className="h-4 w-4 animate-spin text-purple-300" />
            ) : (
              <Sparkles className="h-4 w-4 text-purple-400" />
            )}
            <span>{testingModel ? 'Testando...' : 'Testar Modelo de IA'}</span>
          </button>
        </div>
      </div>

      {/* Navegação por Abas Ergonômicas */}
      <div className="border-b border-slate-800 flex items-center gap-2">
        <button
          onClick={() => setActiveTab('agents')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
            activeTab === 'agents'
              ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          <Bot className="h-4 w-4" />
          <span>Módulos de Auditoria</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
            {totalModules}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('models')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
            activeTab === 'models'
              ? 'border-purple-500 text-purple-400 bg-purple-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          <Cpu className="h-4 w-4" />
          <span>Modelos de IA & Conexões (CRUD)</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-950 border border-purple-800/40 text-purple-300 font-mono">
            {aiModels.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('run')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
            activeTab === 'run'
              ? 'border-blue-500 text-blue-400 bg-blue-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          <Play className="h-4 w-4" />
          <span>Disparar Auditoria Imediata</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* ABA 1: MÓDULOS DE AUDITORIA */}
      {/* ============================================================== */}
      {activeTab === 'agents' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Agentes especialistas configurados com regras de extração e artigos normativos vinculados.
            </p>
            <button
              onClick={() => setShowCreateAgentModal(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition"
            >
              <Plus className="h-4 w-4" />
              <span>Cadastrar Novo Agente</span>
            </button>
          </div>

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
                    <span className="text-[10px] uppercase font-bold text-slate-500">Extração:</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {mod.extractionMode}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed mb-4">{mod.description}</p>

                  <div className="space-y-2 mb-4">
                    <span className="text-[11px] font-semibold text-slate-300 block">
                      Normas e Artigos Regulados ({mod.targetNorms?.length || mod.rulesCount || 0}):
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                      {mod.targetNorms && mod.targetNorms.length > 0 ? (
                        mod.targetNorms.map((normId: string) => {
                          const catalogItem = catalogNorms.find((cn) => cn.id === normId);
                          return (
                            <span
                              key={normId}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-slate-300"
                              title={catalogItem?.description || normId}
                            >
                              {catalogItem ? `${catalogItem.normCode} (${catalogItem.article})` : normId}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-[10px] text-slate-500 italic">
                          Regras gerais do catálogo de deontologia médica.
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Última sincronização: {new Date(mod.updatedAt).toLocaleDateString('pt-BR')}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedModuleId(mod.id);
                      setActiveTab('run');
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-1.5 transition shadow-sm"
                  >
                    <Play className="h-3.5 w-3.5 fill-white" />
                    <span>Auditar com Este Agente</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

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
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: MODELOS DE IA & CONEXÕES (CRUD NO MONGO) */}
      {/* ============================================================== */}
      {activeTab === 'models' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Cpu className="h-5 w-5 text-purple-400" />
                <span>Modelos de Inteligência Artificial Persistidos no Banco</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Alterne em tempo real o motor utilizado para reconciliação deontológica sem reiniciar a aplicação.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setShowCreateModelModal(true)}
                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl shadow-lg shadow-purple-950/40 flex items-center gap-2 transition"
              >
                <Plus className="h-4 w-4" />
                <span>Cadastrar Novo Modelo</span>
              </button>
            </div>
          </div>

          {/* Grid de Modelos Cadastrados no Banco */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {aiModels.map((model) => {
              const isCurrentActive = model.isActive;

              return (
                <div
                  key={model.id}
                  className={`bg-[#0b1329] border rounded-2xl p-5 shadow-lg flex flex-col justify-between transition ${
                    isCurrentActive
                      ? 'border-purple-500/80 shadow-purple-950/30'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          model.provider === 'gemini'
                            ? 'bg-purple-950/80 text-purple-400 border border-purple-800/60'
                            : model.provider === 'ollama'
                            ? 'bg-blue-950/80 text-blue-400 border border-blue-800/60'
                            : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                        }`}
                      >
                        {model.provider}
                      </span>

                      {isCurrentActive ? (
                        <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Ativo em Produção</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => handleDeleteModel(model.id, model.name)}
                          className="text-slate-600 hover:text-red-400 p-1 rounded transition"
                          title="Remover modelo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-white mb-1">{model.name}</h3>
                    <span className="text-xs font-mono text-slate-400 block mb-3">{model.modelId}</span>

                    <p className="text-xs text-slate-400 mb-4 line-clamp-2">
                      {model.description || 'Configuração customizada de inferência de IA.'}
                    </p>

                    <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800 text-[11px] space-y-1.5 font-mono mb-4">
                      <div className="flex justify-between text-slate-400">
                        <span>Temperatura:</span>
                        <span className="text-white font-semibold">{model.temperature}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Max Tokens:</span>
                        <span className="text-white font-semibold">{model.maxTokens}</span>
                      </div>
                      {model.baseUrl && (
                        <div className="flex justify-between text-slate-400 truncate">
                          <span>Endpoint:</span>
                          <span className="text-slate-300 truncate max-w-[140px]">{model.baseUrl}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleOpenTestModal(model.id)}
                      className="text-xs text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1 transition px-2.5 py-1.5 rounded-lg hover:bg-purple-950/40 border border-purple-900/30"
                      title="Testar resposta deste modelo"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Testar</span>
                    </button>

                    {isCurrentActive ? (
                      <span className="text-xs text-emerald-400 font-semibold italic flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Ativo</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => handleActivateModel(model.id)}
                        disabled={activatingModelId === model.id}
                        className="bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
                      >
                        {activatingModelId === model.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Radio className="h-3.5 w-3.5" />
                        )}
                        <span>Ativar</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 3: DISPARAR AUDITORIA IMEDIATA */}
      {/* ============================================================== */}
      {activeTab === 'run' && (
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl max-w-3xl mx-auto">
          <div className="pb-4 border-b border-slate-800 mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-emerald-400" />
              <span>Executar Auditoria Deontológica Imediata</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Dispare uma varredura completa da página web informada utilizando o agente selecionado e o motor ativo de IA.
            </p>
          </div>

          <form onSubmit={handleRunAuditSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Módulo de Agente Especialista *
              </label>
              <select
                value={selectedModuleId}
                onChange={(e) => setSelectedModuleId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} - {m.name} ({m.extractionMode})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Instituição Médica / Clínica Auditada *
              </label>
              <select
                value={selectedClientId}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  const cl = clients.find((c) => c.id === e.target.value);
                  if (cl?.websiteUrl) setTargetUrl(cl.websiteUrl);
                }}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.crmResponsavel ? `CRM ${c.crmResponsavel}/${c.crmUf}` : c.cnpj})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                URL Oficial do Website ou Canal Digital *
              </label>
              <input
                type="url"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://clinicaexemplo.med.br"
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Modo de Extração de Conteúdo Web
              </label>
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="CHEERIO">CHEERIO (Alta velocidade, sanitização HTML/Markdown)</option>
                <option value="PUPPETEER">PUPPETEER (Renderização dinâmica de Single Page Apps)</option>
                <option value="FIRECRAWL">FIRECRAWL (API profunda de extração de markdown)</option>
                <option value="FALLBACK_AI">FALLBACK_AI (Análise direta por IA)</option>
              </select>
            </div>

            <div className="pt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('agents')}
                className="px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition"
              >
                Voltar aos Agentes
              </button>
              <button
                type="submit"
                disabled={running}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 px-6 rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition disabled:opacity-50"
              >
                {running ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Enviando para Fila de Auditoria...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-white" />
                    <span>Iniciar Auditoria Deontológica</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Cadastro de Novo Módulo de Agente */}
      {showCreateAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#0b132b] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <h2 className="text-base font-bold text-white flex items-center gap-2.5">
                <Bot className="h-5 w-5 text-cyan-400" />
                <span>Cadastrar Módulo de Agente</span>
              </h2>
              <button
                onClick={() => setShowCreateAgentModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAgentSubmit} className="space-y-4 mt-5">
              {/* Linha 1: Cliente Vinculado & Marco Regulatório */}
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Cliente Vinculado *
                  </label>
                  <select
                    value={newAgentData.clientId}
                    onChange={(e) => setNewAgentData({ ...newAgentData, clientId: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Selecione um cliente...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.tradeName ? `(${c.tradeName})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Marco Regulatório *
                  </label>
                  <select
                    value={newAgentData.regulatoryFramework}
                    onChange={(e) =>
                      setNewAgentData({ ...newAgentData, regulatoryFramework: e.target.value })
                    }
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="CFM (Resolução 2.336/2023)">CFM (Resolução 2.336/2023)</option>
                    <option value="CFM (Resolução 2.314/2022)">CFM (Resolução 2.314/2022)</option>
                    <option value="LGPD em Saúde (Lei 13.709/18)">LGPD em Saúde (Lei 13.709/18)</option>
                    <option value="ANS (Padrão TISS / Diretrizes)">ANS (Padrão TISS / Diretrizes)</option>
                    <option value="ANVISA (RDC Sanitária)">ANVISA (RDC Sanitária)</option>
                  </select>
                </div>
              </div>

              {/* Linha 2: Nome do Agente & Código Identificador (Slug) */}
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nome do Agente *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAgentData.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      const autoSlug = name
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-+|-+$/g, '');
                      setNewAgentData({
                        ...newAgentData,
                        name,
                        code: newAgentData.code ? newAgentData.code : autoSlug,
                      });
                    }}
                    placeholder="Ex: Auditor Deontológico CFM"
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Código Identificador (Slug) *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAgentData.code}
                    onChange={(e) =>
                      setNewAgentData({
                        ...newAgentData,
                        code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                      })
                    }
                    placeholder="cfm-publicidade-prontomed"
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Linha 3: Descrição e Escopo */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Descrição e Escopo
                </label>
                <textarea
                  rows={2}
                  value={newAgentData.description}
                  onChange={(e) => setNewAgentData({ ...newAgentData, description: e.target.value })}
                  placeholder="Finalidade da varredura, escopo das regras auditadas..."
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                ></textarea>
              </div>

              {/* Linha 4: Frequência Cron & Status do Agente */}
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Frequência de Execução (Cron) *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAgentData.cronSchedule}
                    onChange={(e) =>
                      setNewAgentData({ ...newAgentData, cronSchedule: e.target.value })
                    }
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                  {/* Sugestões de Cron */}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap text-[11px]">
                    <span className="text-slate-500">Sugestões:</span>
                    <button
                      type="button"
                      onClick={() =>
                        setNewAgentData({ ...newAgentData, cronSchedule: '0 * * * *' })
                      }
                      className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
                    >
                      1 hora
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNewAgentData({ ...newAgentData, cronSchedule: '0 */6 * * *' })
                      }
                      className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/80 text-cyan-300 font-semibold"
                    >
                      6 horas (Padrão)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNewAgentData({ ...newAgentData, cronSchedule: '*/10 * * * *' })
                      }
                      className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
                    >
                      10 minutos
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNewAgentData({ ...newAgentData, cronSchedule: '*/5 * * * * *' })
                      }
                      className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
                    >
                      5 segundos (Teste)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Status do Agente
                  </label>
                  <select
                    value={newAgentData.enabled ? 'Ativo' : 'Inativo'}
                    onChange={(e) =>
                      setNewAgentData({
                        ...newAgentData,
                        enabled: e.target.value === 'Ativo',
                      })
                    }
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Ativo">Ativo</option>
                    <option value="Inativo">Inativo</option>
                  </select>
                </div>
              </div>

              {/* Seção MODO DE EXTRAÇÃO POLIMÓRFICO */}
              <div className="pt-2">
                <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider block mb-2">
                  MODO DE EXTRAÇÃO POLIMÓRFICO
                </span>
                <div className="grid grid-cols-3 gap-3">
                  <div
                    onClick={() => setNewAgentData({ ...newAgentData, extractionMode: 'CHEERIO' })}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      newAgentData.extractionMode === 'CHEERIO' || newAgentData.extractionMode === 'PUPPETEER'
                        ? 'bg-cyan-950/30 border-cyan-500 text-white'
                        : 'bg-[#080d1a] border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Globe className={`h-4 w-4 ${newAgentData.extractionMode === 'CHEERIO' ? 'text-cyan-400' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-white">Scraping Web</span>
                    </div>
                    <span className="text-[11px] text-slate-400">DOM, Seletores e URLs</span>
                  </div>

                  <div
                    onClick={() => setNewAgentData({ ...newAgentData, extractionMode: 'DATALINK' })}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      newAgentData.extractionMode === 'DATALINK'
                        ? 'bg-cyan-950/30 border-cyan-500 text-white'
                        : 'bg-[#080d1a] border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Layers className={`h-4 w-4 ${newAgentData.extractionMode === 'DATALINK' ? 'text-cyan-400' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-white">Datalink / API</span>
                    </div>
                    <span className="text-[11px] text-slate-400">Bancos ou APIs REST</span>
                  </div>

                  <div
                    onClick={() => setNewAgentData({ ...newAgentData, extractionMode: 'MCP' })}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      newAgentData.extractionMode === 'MCP'
                        ? 'bg-cyan-950/30 border-cyan-500 text-white'
                        : 'bg-[#080d1a] border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Cpu className={`h-4 w-4 ${newAgentData.extractionMode === 'MCP' ? 'text-cyan-400' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-white">MCP Server</span>
                    </div>
                    <span className="text-[11px] text-slate-400">Model Context Protocol</span>
                  </div>
                </div>
              </div>

              {/* Sub-bloco condicional baseado no modo de extração */}
              <div className="bg-[#080d1a] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                <span className="text-xs font-semibold text-slate-300 block">
                  {newAgentData.extractionMode === 'DATALINK'
                    ? 'Parâmetros de Extração Datalink / API'
                    : newAgentData.extractionMode === 'MCP'
                    ? 'Parâmetros de Extração MCP (Model Context Protocol)'
                    : 'Parâmetros de Extração Web (Scraping)'}
                </span>

                {newAgentData.extractionMode === 'DATALINK' ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Endpoint da API REST / Query *
                    </label>
                    <input
                      type="text"
                      placeholder="https://api.clinica.com.br/v1/auditoria"
                      value={newAgentData.apiEndpoint}
                      onChange={(e) =>
                        setNewAgentData({ ...newAgentData, apiEndpoint: e.target.value })
                      }
                      className="w-full bg-[#0b132b] border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                ) : newAgentData.extractionMode === 'MCP' ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      URI do Servidor MCP *
                    </label>
                    <input
                      type="text"
                      placeholder="mcp://localhost:8080 ou https://mcp.clinica.com.br"
                      value={newAgentData.mcpUri}
                      onChange={(e) => setNewAgentData({ ...newAgentData, mcpUri: e.target.value })}
                      className="w-full bg-[#0b132b] border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      URL Alvo (Target URL) *
                    </label>
                    <input
                      type="text"
                      placeholder="https://clinica.med.br/servicos"
                      value={newAgentData.targetUrl}
                      onChange={(e) =>
                        setNewAgentData({ ...newAgentData, targetUrl: e.target.value })
                      }
                      className="w-full bg-[#0b132b] border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Botões do Rodapé */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateAgentModal(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingAgent}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs py-2.5 px-6 rounded-xl transition shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {creatingAgent ? 'Cadastrando...' : 'Cadastrar Módulo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Cadastro de Novo Modelo de IA no Banco */}
      {showCreateModelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="h-5 w-5 text-purple-400" />
                <span>Cadastrar Novo Modelo de IA no Banco</span>
              </h2>
              <button
                onClick={() => setShowCreateModelModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateModelSubmit} className="space-y-3.5 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nome Amigável do Modelo *
                </label>
                <input
                  type="text"
                  required
                  value={newModelData.name}
                  onChange={(e) => setNewModelData({ ...newModelData, name: e.target.value })}
                  placeholder="Ex: Gemini 1.5 Pro ou Ollama Llama 3.1"
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Provedor / Engine *
                  </label>
                  <select
                    value={newModelData.provider}
                    onChange={(e) => setNewModelData({ ...newModelData, provider: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="ollama">Ollama Local / Remoto</option>
                    <option value="heuristic">Motor Heurístico</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Model ID Técnico *
                  </label>
                  <input
                    type="text"
                    required
                    value={newModelData.modelId}
                    onChange={(e) => setNewModelData({ ...newModelData, modelId: e.target.value })}
                    placeholder="Ex: gemini-1.5-pro ou llama3.1:8b"
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {newModelData.provider === 'ollama' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    URL Base do Ollama
                  </label>
                  <input
                    type="url"
                    value={newModelData.baseUrl}
                    onChange={(e) => setNewModelData({ ...newModelData, baseUrl: e.target.value })}
                    placeholder="http://localhost:11434"
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              )}

              {newModelData.provider === 'gemini' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Chave de API Customizada (Opcional - usa a padrão se vazio)
                  </label>
                  <input
                    type="password"
                    value={newModelData.apiKey}
                    onChange={(e) => setNewModelData({ ...newModelData, apiKey: e.target.value })}
                    placeholder="AIzaSy..."
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Temperatura (0.0 a 2.0)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="2"
                    value={newModelData.temperature}
                    onChange={(e) => setNewModelData({ ...newModelData, temperature: parseFloat(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Limite Máximo de Tokens
                  </label>
                  <input
                    type="number"
                    step="256"
                    min="256"
                    max="32768"
                    value={newModelData.maxTokens}
                    onChange={(e) => setNewModelData({ ...newModelData, maxTokens: parseInt(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Descrição
                </label>
                <textarea
                  rows={2}
                  value={newModelData.description}
                  onChange={(e) => setNewModelData({ ...newModelData, description: e.target.value })}
                  placeholder="Finalidade ou detalhes de benchmark do modelo..."
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                ></textarea>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="activateNow"
                  checked={newModelData.isActive}
                  onChange={(e) => setNewModelData({ ...newModelData, isActive: e.target.checked })}
                  className="rounded border-slate-700 text-purple-600 focus:ring-0"
                />
                <label htmlFor="activateNow" className="text-xs text-slate-300 font-medium cursor-pointer">
                  Ativar este modelo imediatamente após a criação
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModelModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingModel}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs py-2 px-4 rounded-xl transition"
                >
                  {creatingModel ? 'Salvando...' : 'Salvar no Banco'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Diagnóstico do Modelo de IA com Seleção e Ativação */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0b132b] border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-950/60 border border-purple-800/40">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Diagnóstico & Teste de Modelos de IA</h3>
                  <span className="text-xs text-slate-400">
                    Selecione um modelo cadastrado no banco para testar resposta, latência e ativar em tempo real.
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowTestModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Seleção do Modelo Cadastrado */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Modelo Cadastrado no Banco (MongoDB) *
                  </label>
                  {(() => {
                    const selModel = aiModels.find((m) => m.id === selectedModelIdForTest);
                    if (selModel?.isActive) {
                      return (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Atualmente Ativo</span>
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedModelIdForTest}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setSelectedModelIdForTest(newId);
                      handleRunModelTest(newId);
                    }}
                    className="flex-1 bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500 font-medium"
                  >
                    {aiModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.provider} - {m.modelId}) {m.isActive ? '⭐ [ATIVO]' : ''}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleRunModelTest()}
                    disabled={testingModel}
                    className="bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/40 text-purple-200 font-semibold text-xs py-2.5 px-3 rounded-xl shadow-lg transition flex items-center gap-1.5 disabled:opacity-50"
                    title="Executar teste neste modelo"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${testingModel ? 'animate-spin' : ''}`} />
                    <span>{testingModel ? 'Testando...' : 'Testar'}</span>
                  </button>
                </div>
              </div>

              {/* Resultado do Teste */}
              {testResult ? (
                <>
                  <div className="grid grid-cols-3 gap-2.5 text-center">
                    <div className="p-3 bg-[#080d1a] border border-slate-800 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Status
                      </span>
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

                    <div className="p-3 bg-[#080d1a] border border-slate-800 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Latência
                      </span>
                      <span className="text-xs font-mono font-bold text-white flex items-center justify-center gap-1">
                        <Clock className="h-3 w-3 text-purple-400" />
                        {testResult.latencyMs} ms
                      </span>
                    </div>

                    <div className="p-3 bg-[#080d1a] border border-slate-800 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Motor
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-200 truncate block">
                        {testResult.provider?.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-[#080d1a] border border-slate-800 rounded-xl text-xs space-y-1.5 font-mono">
                    <div className="flex justify-between text-slate-400">
                      <span>Modelo Auditado:</span>
                      <span className="text-slate-200 font-semibold">{testResult.model}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Data/Hora do Teste:</span>
                      <span className="text-slate-300">
                        {testResult.testedAt
                          ? new Date(testResult.testedAt).toLocaleTimeString('pt-BR')
                          : '-'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Diagnóstico Retornado pelo Modelo:</span>
                    </label>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 max-h-36 overflow-y-auto leading-relaxed">
                      {testResult.response || 'Sem resposta.'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-6 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-purple-400" />
                  <span>Conectando e realizando teste deontológico no modelo...</span>
                </div>
              )}

              {/* Ações do Rodapé: Ativar Modelo e Fechar */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                <div>
                  {(() => {
                    const selModel = aiModels.find((m) => m.id === selectedModelIdForTest);
                    if (selModel && !selModel.isActive) {
                      return (
                        <button
                          type="button"
                          onClick={async () => {
                            await handleActivateModel(selectedModelIdForTest);
                          }}
                          disabled={activatingModelId === selectedModelIdForTest}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-4 rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 disabled:opacity-50"
                        >
                          {activatingModelId === selectedModelIdForTest ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Radio className="h-3.5 w-3.5" />
                          )}
                          <span>Ativar Este Modelo</span>
                        </button>
                      );
                    }
                    if (selModel && selModel.isActive) {
                      return (
                        <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Este já é o motor ativo de produção</span>
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTestModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
