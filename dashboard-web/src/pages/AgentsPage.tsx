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
  Pencil,
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
import { useToast } from '../context/ToastContext';

export const SKILL_PERSONA_TEMPLATES = [
  {
    id: 'cfm',
    name: '🩺 Deontologia Médica CFM (Res. 2.336/23)',
    shortName: 'CFM 2.336/23',
    badge: 'CFM / Ética Médica',
    tag: 'cfm',
    description:
      'Você é o Auditor Deontológico Sênior em Saúde da ConformIA, especialista na Resolução CFM 2.336/2023 e Código de Ética Médica. Sua missão é auditar com rigor: presença obrigatória de CRM com UF e RQE para anúncio de especialidades; identificação de imagens de antes e depois sem caráter educativo ou com promessa de resultado idêntico; proibição de expressões sensacionalistas ("o melhor", "cura garantida"); e vedação à mercantilização (descontos, black friday, cupons, consórcios e sorteios).',
  },
  {
    id: 'lgpd',
    name: '🔒 Privacidade LGPD em Saúde (Art. 11)',
    shortName: 'LGPD Saúde',
    badge: 'LGPD em Saúde',
    tag: 'lgpd',
    description:
      'Você é o Encarregado de Proteção de Dados (DPO) e Auditor de Privacidade em Saúde da ConformIA, especialista na LGPD (Lei 13.709/2018). Sua missão é auditar a proteção de dados sensíveis de saúde em canais digitais: presença visível de links para Termos de Consentimento e Política de Privacidade em formulários de agendamento e contato online; verificação da base legal para tratamento de dados pessoais sensíveis; e vedação ao compartilhamento indevido de dados clínicos com terceiros.',
  },
  {
    id: 'anvisa',
    name: '💊 Vigilância Sanitária ANVISA (RDC 727)',
    shortName: 'ANVISA RDC 727',
    badge: 'ANVISA Sanitária',
    tag: 'anvisa',
    description:
      'Você é o Auditor Fiscal Sanitário da ConformIA, especialista nas resoluções da ANVISA (RDC nº 727/2022 e Lei 6.360/76). Sua missão é fiscalizar a propaganda de produtos sujeitos à vigilância sanitária: proibição estrita de publicidade direta ao público leigo de medicamentos de venda sob prescrição médica (tarja vermelha e preta, como toxina botulínica e preenchedores injetáveis com fins promocionais); e vedação de atribuição de propriedades curativas ou terapêuticas a cosméticos e suplementos.',
  },
  {
    id: 'ans',
    name: '🏥 Transparência ANS (RN 509)',
    shortName: 'ANS RN 509',
    badge: 'ANS Suplementar',
    tag: 'ans',
    description:
      'Você é o Auditor de Saúde Suplementar da ConformIA, especialista nas resoluções normativas da ANS (RN nº 509/2022 e RN 395/2016). Sua missão é auditar a clareza e fidedignidade na veiculação de redes credenciadas, carências, abrangência geográfica e direitos do beneficiário, prevenindo a indução a erro quanto à segmentação de planos de saúde e cobertura assistencial.',
  },
  {
    id: 'multidisciplinar',
    name: '⚖️ Auditoria Multidisciplinar Integrada',
    shortName: 'Multidisciplinar',
    badge: 'CFM / LGPD / ANVISA',
    tag: 'cfm',
    description:
      'Você é o Auditor Regulatório Integral da ConformIA, encarregado da reconciliação deontológica multidisciplinar abrangendo os marcos regulatórios do CFM, ANVISA, ANS e LGPD. Sua missão é realizar um escrutínio minucioso cruzando todas as resoluções ativas com o conteúdo digital da instituição, identificando qualquer infração ética, mercantil, sanitária ou de privacidade.',
  },
];

// Compatibilidade retroativa para rotas legadas
export const AVAILABLE_SKILLS = SKILL_PERSONA_TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  role: t.badge,
  description: t.description,
  badge: t.badge,
}));

export const AgentsPage: React.FC = () => {
  const toast = useToast();
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

  // Cockpit & Governança Unificada do Módulo (Corpo Único de Configuração & Disparo)
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [cockpitData, setCockpitData] = useState({
    id: '',
    name: '',
    targetUrl: '',
    description: '',
    tags: ['cfm'] as string[],
    clientId: '',
  });
  const [cockpitTagInput, setCockpitTagInput] = useState('');
  const [savingModule, setSavingModule] = useState(false);
  const [running, setRunning] = useState(false);

  // Modal de Cadastro de Novo Módulo de Agente (Estritamente Manual)
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);
  const [newAgentData, setNewAgentData] = useState({
    name: '',
    targetUrl: '',
    description: '',
    tags: ['cfm'] as string[],
  });
  const [newTagInput, setNewTagInput] = useState('');
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
      const [modulesResult, clientsResult, normsResult, modelsResult] = await Promise.allSettled([
        api.get(`/agents?page=${page}&limit=${limit}`),
        api.get('/clients?limit=100'),
        api.get('/norms/catalog'),
        api.get('/models?limit=50'),
      ]);

      if (modulesResult.status === 'fulfilled') {
        const modulesRes = modulesResult.value;
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

        if (modulesRes.data?.data?.[0]?.id && !selectedModuleId) {
          setSelectedModuleId(modulesRes.data.data[0].id);
        } else if (Array.isArray(modulesRes.data) && modulesRes.data[0]?.id && !selectedModuleId) {
          setSelectedModuleId(modulesRes.data[0].id);
        }
      } else {
        console.warn('⚠️ [AgentsPage] Não foi possível carregar módulos de agente:', modulesResult.reason);
      }

      if (clientsResult.status === 'fulfilled') {
        const clientsRes = clientsResult.value;
        const list = clientsRes.data?.data || (Array.isArray(clientsRes.data) ? clientsRes.data : []);
        setClients(list);
      } else {
        console.warn('⚠️ [AgentsPage] Não foi possível carregar clientes:', clientsResult.reason);
      }

      if (normsResult.status === 'fulfilled') {
        setCatalogNorms(normsResult.value.data?.norms || []);
      }

      if (modelsResult.status === 'fulfilled') {
        const modelsRes = modelsResult.value;
        const modelsList = Array.isArray(modelsRes.data?.data)
          ? modelsRes.data.data
          : Array.isArray(modelsRes.data)
          ? modelsRes.data
          : [];
        setAiModels(modelsList);
      } else {
        console.warn('⚠️ [AgentsPage] Não foi possível carregar modelos do banco:', modelsResult.reason);
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

  // Sincroniza o Cockpit com o Módulo Selecionado apenas na carga inicial se ainda não houver módulo ativo
  useEffect(() => {
    if (modules.length > 0 && !cockpitData.id) {
      const targetId = selectedModuleId || modules[0]?.id;
      const mod = modules.find((m) => m.id === targetId) || modules[0];
      if (mod) {
        setSelectedModuleId(mod.id);
        setCockpitData({
          id: mod.id,
          name: mod.name || '',
          targetUrl: mod.targetUrl || '',
          description: mod.description || mod.systemPrompt || '',
          tags: mod.tags && mod.tags.length > 0 ? mod.tags : ['cfm'],
          clientId: mod.clientId || '',
        });
      }
    }
  }, [modules, cockpitData.id]);

  // Selecionar Módulo para Configuração e Auditoria Imediata (busca dados mais recentes do banco)
  const handleSelectModuleForCockpit = async (mod: any) => {
    setSelectedModuleId(mod.id);
    setCockpitTagInput('');
    setActiveTab('run');

    try {
      const res = await api.get(`/agents/${mod.id}`);
      const freshMod = res.data;
      if (freshMod) {
        setCockpitData({
          id: freshMod.id,
          name: freshMod.name || '',
          targetUrl: freshMod.targetUrl || '',
          description: freshMod.description || freshMod.systemPrompt || '',
          tags: freshMod.tags && freshMod.tags.length > 0 ? freshMod.tags : ['cfm'],
          clientId: freshMod.clientId || '',
        });
        return;
      }
    } catch {
      // Fallback seguro caso endpoint pontual falhe
    }

    setCockpitData({
      id: mod.id,
      name: mod.name || '',
      targetUrl: mod.targetUrl || '',
      description: mod.description || mod.systemPrompt || '',
      tags: mod.tags && mod.tags.length > 0 ? mod.tags : ['cfm'],
      clientId: mod.clientId || '',
    });
  };

  // Aplica Template Deontológico à Persona/Skill Unificada do Módulo no Cockpit
  const handleApplyPersonaTemplate = (template: typeof SKILL_PERSONA_TEMPLATES[0]) => {
    const updatedTags = cockpitData.tags.includes(template.tag)
      ? cockpitData.tags
      : [...cockpitData.tags, template.tag];

    setCockpitData({
      ...cockpitData,
      description: template.description,
      tags: updatedTags,
    });
    toast.success(`Template "${template.shortName}" aplicado à Persona da IA!`);
  };

  // Aplica Template ao Modal de Criação Rápida de Agente
  const handleApplyPersonaTemplateToNew = (template: typeof SKILL_PERSONA_TEMPLATES[0]) => {
    const updatedTags = newAgentData.tags.includes(template.tag)
      ? newAgentData.tags
      : [...newAgentData.tags, template.tag];

    setNewAgentData({
      ...newAgentData,
      description: template.description,
      tags: updatedTags,
    });
    toast.success(`Template "${template.shortName}" aplicado!`);
  };

  // Salvar Alterações de Configuração do Módulo no Cockpit
  const handleSaveModuleConfig = async () => {
    if (!cockpitData.id) {
      toast.warning('Nenhum módulo selecionado para edição.');
      return;
    }
    const cleanName = cockpitData.name.trim();
    const cleanUrl = cockpitData.targetUrl.trim();
    const cleanDescription = cockpitData.description.trim();

    if (!cleanName || !cleanUrl || !cleanDescription) {
      toast.error('Preencha os campos obrigatórios: Nome do Módulo, URL Alvo Oficial e Skill/Persona.');
      return;
    }
    if (cockpitData.tags.length === 0) {
      toast.error('Selecione ou adicione ao menos uma Tag regulatória.');
      return;
    }
    try {
      setSavingModule(true);
      const res = await api.put(`/agents/${cockpitData.id}`, {
        name: cleanName,
        targetUrl: cleanUrl,
        description: cleanDescription,
        systemPrompt: cleanDescription,
        clientId: cockpitData.clientId && cockpitData.clientId.trim().length > 0 ? cockpitData.clientId.trim() : null,
        tags: cockpitData.tags,
      });

      const updatedAgent = res.data?.agent;
      if (updatedAgent) {
        // Atualiza imediatamente a lista local de módulos
        setModules((prev) =>
          prev.map((m) => (m.id === updatedAgent.id ? { ...m, ...updatedAgent } : m))
        );
        // Atualiza o estado do Cockpit com os dados persistidos
        setCockpitData({
          id: updatedAgent.id,
          name: updatedAgent.name || '',
          targetUrl: updatedAgent.targetUrl || '',
          description: updatedAgent.description || updatedAgent.systemPrompt || '',
          tags: updatedAgent.tags && updatedAgent.tags.length > 0 ? updatedAgent.tags : ['cfm'],
          clientId: updatedAgent.clientId || '',
        });
      }

      await fetchData(currentPage, pageSize);
      toast.success('Diretrizes da Persona & Configuração do Módulo atualizadas com sucesso no MongoDB!');
    } catch (err: any) {
      toast.error(`Erro ao salvar alterações: ${err.response?.data?.error || err.message}`);
    } finally {
      setSavingModule(false);
    }
  };

  // Disparar Auditoria Deontológica Imediata (Salva e Executa com URL Alvo Única e Skill)
  const handleRunAuditSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedModuleId) {
      toast.warning('Selecione um agente de auditoria.');
      return;
    }
    const currentMod = modules.find((m) => m.id === selectedModuleId);
    const effectiveUrl = cockpitData.targetUrl?.trim() || currentMod?.targetUrl;
    if (!effectiveUrl) {
      toast.warning('Informe a URL Alvo Oficial para a realização da auditoria.');
      return;
    }

    try {
      setRunning(true);
      // Salva qualquer alteração recente no módulo de forma transparente
      await api.put(`/agents/${selectedModuleId}`, {
        name: cockpitData.name?.trim() || currentMod?.name,
        targetUrl: effectiveUrl,
        description: cockpitData.description?.trim() || currentMod?.description,
        systemPrompt: cockpitData.description?.trim() || currentMod?.description,
        clientId: cockpitData.clientId && cockpitData.clientId.trim().length > 0 ? cockpitData.clientId.trim() : null,
        tags: cockpitData.tags && cockpitData.tags.length > 0 ? cockpitData.tags : currentMod?.tags,
      });

      // Dispara a auditoria usando o corpo unificado de URL Alvo Oficial e Persona/Skill
      await api.post(`/agents/${selectedModuleId}/run`, {
        clientId: cockpitData.clientId || clients[0]?.id || currentMod?.clientId,
        targetUrl: effectiveUrl,
        skill: cockpitData.description?.trim() || currentMod?.description,
        extractionMode: 'FIRECRAWL',
      });

      toast.success('Auditoria deontológica disparada com sucesso! Acompanhe o processamento no Cockpit ou Laudos.');
      await fetchData(currentPage, pageSize);
    } catch (err: any) {
      toast.error(`Falha ao disparar auditoria: ${err.response?.data?.error || err.message}`);
    } finally {
      setRunning(false);
    }
  };

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
      const res = await api.post(`/models/${modelId}/activate`);
      // Atualiza o estado da lista localmente IMEDIATAMENTE (reatividade instantânea)
      setAiModels((prev) =>
        prev.map((m) => ({
          ...m,
          isActive: m.id === modelId,
        }))
      );
      await fetchData(currentPage, pageSize);
      toast.success(res.data?.message || 'Modelo ativado com sucesso como motor ativo de auditoria!');
    } catch (err: any) {
      toast.error(`Erro ao ativar modelo: ${err.response?.data?.error || err.message}`);
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
      toast.success(`Modelo "${modelName}" removido com sucesso.`);
    } catch (err: any) {
      toast.error(`Erro ao remover modelo: ${err.response?.data?.error || err.message}`);
    }
  };

  // Criar Modelo de IA no Banco
  const handleCreateModelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreatingModel(true);
      const payload: any = {
        name: newModelData.name.trim(),
        provider: newModelData.provider,
        modelId: newModelData.modelId.trim(),
        temperature: Number(newModelData.temperature) || 0.2,
        maxTokens: Number(newModelData.maxTokens) || 2048,
        isActive: Boolean(newModelData.isActive),
      };
      if (newModelData.baseUrl?.trim()) payload.baseUrl = newModelData.baseUrl.trim();
      if (newModelData.apiKey?.trim()) payload.apiKey = newModelData.apiKey.trim();
      if (newModelData.description?.trim()) payload.description = newModelData.description.trim();

      const res = await api.post('/models', payload);
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

      // Recarrega lista e atualiza o estado imediatamente
      const modelsRes = await api.get('/models?limit=50');
      const list = Array.isArray(modelsRes.data?.data)
        ? modelsRes.data.data
        : Array.isArray(modelsRes.data)
        ? modelsRes.data
        : [];
      setAiModels(list);

      toast.success(`Modelo "${res.data?.name || payload.name}" cadastrado e persistido com sucesso no MongoDB!`);
    } catch (err: any) {
      toast.error(`Erro ao cadastrar modelo: ${err.response?.data?.error || err.message}`);
    } finally {
      setCreatingModel(false);
    }
  };

  // Criar Módulo de Agente (Estritamente Manual)
  const handleCreateAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentData.name.trim() || !newAgentData.targetUrl.trim() || !newAgentData.description.trim()) {
      toast.error('Preencha os campos obrigatórios: Nome do Módulo, URL Alvo e Descrição/Skill.');
      return;
    }
    if (newAgentData.tags.length === 0) {
      toast.error('Selecione ou adicione ao menos uma Tag regulatória (ex: cfm, lgpd, anvisa).');
      return;
    }
    try {
      setCreatingAgent(true);
      await api.post('/agents', {
        name: newAgentData.name.trim(),
        targetUrl: newAgentData.targetUrl.trim(),
        description: newAgentData.description.trim(),
        systemPrompt: newAgentData.description.trim(),
        tags: newAgentData.tags,
      });
      setShowCreateAgentModal(false);
      setNewAgentData({
        name: '',
        targetUrl: '',
        description: '',
        tags: ['cfm'],
      });
      fetchData(currentPage, pageSize);
      toast.success('Módulo de agente cadastrado com sucesso!');
    } catch (err: any) {
      toast.error(`Erro ao cadastrar agente: ${err.response?.data?.error || err.message}`);
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
      toast.success(`Agente "${name}" removido com sucesso.`);
    } catch (err: any) {
      toast.error(`Erro ao remover agente: ${err.message}`);
    }
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
          onClick={() => setActiveTab('run')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
            activeTab === 'run'
              ? 'border-cyan-500 text-cyan-400 bg-cyan-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          <Play className="h-4 w-4 fill-current" />
          <span>Cockpit & Disparo Imediato</span>
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
                        onClick={() => handleSelectModuleForCockpit(mod)}
                        className="text-slate-400 hover:text-cyan-400 p-1 rounded transition"
                        title="Configurar e editar módulo no cockpit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
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
                  
                  {mod.targetUrl && (
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-cyan-400 font-mono truncate">
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{mod.targetUrl}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[10px] uppercase font-bold text-slate-500">Extração:</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {mod.extractionMode}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed mb-4 line-clamp-3">{mod.description}</p>

                  <div className="space-y-2 mb-4">
                    <span className="text-[11px] font-semibold text-slate-300 block">
                      Tags Regulatórias & Normas Ativas:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {mod.tags && mod.tags.length > 0 ? (
                        mod.tags.map((tag: string) => (
                          <span
                            key={tag}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 font-bold"
                          >
                            #{tag.toUpperCase()}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-500 italic">
                          #CFM
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Última atualização: {new Date(mod.updatedAt).toLocaleDateString('pt-BR')}
                  </span>
                  <button
                    onClick={() => handleSelectModuleForCockpit(mod)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-1.5 transition shadow-sm"
                  >
                    <Play className="h-3.5 w-3.5 fill-white" />
                    <span>Configurar & Auditar</span>
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
          {aiModels.length === 0 ? (
            <div className="p-12 text-center bg-[#0b1329] border border-slate-800 rounded-2xl">
              <Cpu className="h-10 w-10 text-purple-400 mx-auto mb-3 opacity-60" />
              <h3 className="text-base font-bold text-white mb-1">Nenhum Modelo de IA Encontrado no Banco</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
                Cadastre um novo modelo de IA para persistir no MongoDB e alternar o motor em tempo de execução.
              </p>
              <button
                onClick={() => setShowCreateModelModal(true)}
                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs py-2 px-4 rounded-xl transition shadow-lg shadow-purple-950/40"
              >
                Cadastrar Primeiro Modelo
              </button>
            </div>
          ) : (
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
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: COCKPIT UNIFICADO & DISPARO IMEDIATO DO MÓDULO */}
      {/* ============================================================== */}
      {activeTab === 'run' && (
        <div className="w-full space-y-6">
          {/* Header do Cockpit Unificado */}
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
                <Play className="h-6 w-6 text-emerald-400 fill-emerald-400" />
                <span>Cockpit de Auditoria & Governança do Módulo</span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Configure a Persona/Skill deontológica, a URL alvo canônica e dispare a varredura com reconciliação normativa em um único painel.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Motor de IA Ativo:</span>
              <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-purple-950/70 border border-purple-800/60 text-purple-300 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-purple-400" />
                <span>{activeModel?.name || 'Google Gemini 3.5 Flash'}</span>
              </span>
            </div>
          </div>

          <form onSubmit={handleRunAuditSubmit}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Coluna Principal: Parâmetros Canônicos & Corpo Único de Skill/Persona */}
              <div className="lg:col-span-2 space-y-6">
                {/* Bloco 1: Seleção do Módulo & Alvo Oficial Canônico (Sem duplicidade) */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Settings2 className="h-4 w-4 text-emerald-400" />
                      <span>1. Identificação do Agente & Alvo Oficial</span>
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400">
                      ID: {cockpitData.id || selectedModuleId || 'novo'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Módulo de Agente Selecionado *
                      </label>
                      <select
                        value={selectedModuleId}
                        onChange={async (e) => {
                          const id = e.target.value;
                          setSelectedModuleId(id);
                          try {
                            const res = await api.get(`/agents/${id}`);
                            const freshMod = res.data;
                            if (freshMod) {
                              setCockpitData({
                                id: freshMod.id,
                                name: freshMod.name || '',
                                targetUrl: freshMod.targetUrl || '',
                                description: freshMod.description || freshMod.systemPrompt || '',
                                tags: freshMod.tags && freshMod.tags.length > 0 ? freshMod.tags : ['cfm'],
                                clientId: freshMod.clientId || '',
                              });
                              return;
                            }
                          } catch {
                            // Fallback seguro caso endpoint pontual falhe
                          }
                          const mod = modules.find((m) => m.id === id);
                          if (mod) {
                            setCockpitData({
                              id: mod.id,
                              name: mod.name || '',
                              targetUrl: mod.targetUrl || '',
                              description: mod.description || mod.systemPrompt || '',
                              tags: mod.tags && mod.tags.length > 0 ? mod.tags : ['cfm'],
                              clientId: mod.clientId || '',
                            });
                          }
                        }}
                        className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium"
                      >
                        {modules.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code || 'MOD'} — {m.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Nome do Módulo de Agente *
                      </label>
                      <input
                        type="text"
                        required
                        value={cockpitData.name}
                        onChange={(e) => setCockpitData({ ...cockpitData, name: e.target.value })}
                        placeholder="Ex: Auditor Deontológico Dermatológico"
                        className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        URL Alvo Oficial do Website ou Canal Digital * <span className="text-[10px] text-cyan-400 font-normal">(Canônica & Única)</span>
                      </label>
                      <div className="relative">
                        <input
                          type="url"
                          required
                          value={cockpitData.targetUrl}
                          onChange={(e) => setCockpitData({ ...cockpitData, targetUrl: e.target.value })}
                          placeholder="https://clinicaexemplo.med.br"
                          className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 pl-9 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                        />
                        <Globe className="h-4 w-4 text-cyan-400 absolute left-3 top-3" />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Esta é a única URL de auditoria vinculada ao módulo. A raspagem limpa é executada via Firecrawl com hash SHA-256 e sem conflitos de múltiplos endereços.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Instituição Médica / Clínica Vinculada
                      </label>
                      <select
                        value={cockpitData.clientId}
                        onChange={(e) => setCockpitData({ ...cockpitData, clientId: e.target.value })}
                        className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium"
                      >
                        <option value="">Auditoria Direta / Avulsa (Sem clínica fixa)</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.tradeName || c.name} ({c.crmResponsavel ? `CRM ${c.crmResponsavel}/${c.crmUf}` : c.cnpj || 'Cadastrado'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Modo de Extração de Conteúdo Web
                      </label>
                      <div className="w-full bg-[#080d1a] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-emerald-400 font-mono flex items-center justify-between">
                        <span>FIRECRAWL (Markdown Nativo + SHA-256)</span>
                        <span className="text-[10px] bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded font-bold">Oficial</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bloco 2: 🧠 Corpo Único: Persona & Skill Deontológica da IA */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-400" />
                        <span>2. Skill & Persona Deontológica da IA</span>
                        <span className="text-[10px] font-bold text-purple-300 bg-purple-950/80 border border-purple-800/60 px-2 py-0.5 rounded-full">
                          Corpo Único
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Defina a persona e as diretrizes comportamentais que guiarão o raciocínio da IA durante a auditoria regulatória.
                      </p>
                    </div>
                  </div>

                  {/* Seletor Rápido de Templates Deontológicos */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                      Aplicar Template Rápido de Persona:
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {SKILL_PERSONA_TEMPLATES.map((tmpl) => (
                        <button
                          key={tmpl.id}
                          type="button"
                          onClick={() => handleApplyPersonaTemplate(tmpl)}
                          className="px-3 py-1.5 bg-[#080d1a] hover:bg-purple-950/40 border border-slate-800 hover:border-purple-600/60 rounded-xl text-xs text-slate-300 hover:text-white transition flex items-center gap-1.5"
                          title={tmpl.name}
                        >
                          <span className="font-semibold">{tmpl.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Editor da Skill Comportamental (Corpo Único) */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Diretrizes da Persona & Escopo da IA * <span className="text-[10px] text-slate-400 font-normal">(Prompt de Sistema do Agente)</span>
                    </label>
                    <textarea
                      required
                      rows={6}
                      value={cockpitData.description}
                      onChange={(e) => setCockpitData({ ...cockpitData, description: e.target.value })}
                      placeholder="Descreva a persona, atribuições éticas e postura regulatória do agente..."
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl p-3.5 text-xs text-white focus:outline-none focus:border-purple-500 font-mono leading-relaxed resize-y"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      A IA assume esta persona de forma soberana, cruzando as normas associadas com o Markdown extraído da página.
                    </p>
                  </div>

                  {/* Bloco 3: Tags Regulatórias & Normas Dinâmicas */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      3. Tags Regulatórias * <span className="text-[10px] text-cyan-400 font-normal">(Resolução Dinâmica de Normas no Banco)</span>
                    </label>

                    <div className="flex flex-wrap gap-2 mb-2.5">
                      {['cfm', 'lgpd', 'anvisa', 'ans'].map((tag) => {
                        const isSelected = cockpitData.tags.includes(tag);
                        return (
                          <button
                            type="button"
                            key={tag}
                            onClick={() => {
                              if (isSelected) {
                                setCockpitData({
                                  ...cockpitData,
                                  tags: cockpitData.tags.filter((t) => t !== tag),
                                });
                              } else {
                                setCockpitData({
                                  ...cockpitData,
                                  tags: [...cockpitData.tags, tag],
                                });
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                              isSelected
                                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                            }`}
                          >
                            <span>#{tag.toUpperCase()}</span>
                            {isSelected ? '✓' : '+'}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Adicionar outra tag regulatória..."
                        value={cockpitTagInput}
                        onChange={(e) => setCockpitTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const tag = cockpitTagInput.trim().toLowerCase();
                            if (tag && !cockpitData.tags.includes(tag)) {
                              setCockpitData({ ...cockpitData, tags: [...cockpitData.tags, tag] });
                              setCockpitTagInput('');
                            }
                          }
                        }}
                        className="flex-1 bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const tag = cockpitTagInput.trim().toLowerCase();
                          if (tag && !cockpitData.tags.includes(tag)) {
                            setCockpitData({ ...cockpitData, tags: [...cockpitData.tags, tag] });
                            setCockpitTagInput('');
                          }
                        }}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold text-xs rounded-xl border border-slate-700 transition"
                      >
                        + Tag
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {cockpitData.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-cyan-950/80 border border-cyan-800 text-cyan-300 rounded-md text-[11px] font-mono"
                        >
                          #{tag}
                          <button
                            type="button"
                            onClick={() =>
                              setCockpitData({
                                ...cockpitData,
                                tags: cockpitData.tags.filter((t) => t !== tag),
                              })
                            }
                            className="hover:text-red-400 ml-1 font-bold"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 p-3 bg-cyan-950/30 border border-cyan-900/50 rounded-xl text-[11px] text-cyan-300/90 leading-relaxed">
                      🛡️ <strong>Governança de Normas:</strong> O motor carregará dinamicamente todas as resoluções da base MongoDB mapeadas para <strong>[{cockpitData.tags.join(', ')}]</strong> no instante da auditoria.
                    </div>
                  </div>
                </div>
              </div>

              {/* Coluna Lateral: Cockpit de Ação & Prontidão */}
              <div className="space-y-5">
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800/80 pb-3">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    <span>Cockpit de Disparo</span>
                  </h3>

                  <div className="space-y-3 text-xs">
                    <div className="bg-[#080d1a] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                      <div className="flex justify-between items-center text-slate-400">
                        <span>Módulo Ativo:</span>
                        <span className="text-white font-mono font-semibold truncate max-w-[130px]">
                          {cockpitData.name || '-'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-slate-400">
                        <span>URL Alvo Canônica:</span>
                        <span className="text-cyan-400 font-mono font-semibold truncate max-w-[130px]" title={cockpitData.targetUrl}>
                          {(() => {
                            if (!cockpitData.targetUrl) return 'Não informada';
                            try {
                              return new URL(cockpitData.targetUrl).hostname;
                            } catch {
                              return cockpitData.targetUrl;
                            }
                          })()}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-slate-400">
                        <span>Persona / Prompt:</span>
                        <span className="text-purple-300 font-mono font-semibold truncate max-w-[130px]" title={cockpitData.description}>
                          {cockpitData.description ? `${cockpitData.description.length} caracteres` : 'Pendente'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-slate-400">
                        <span>Tags Regulatórias:</span>
                        <span className="text-white font-mono font-semibold">
                          {cockpitData.tags.length} selecionada(s)
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-slate-400">
                        <span>Motor de IA:</span>
                        <span className="text-purple-300 font-mono font-semibold">
                          {activeModel?.name?.split(' ')[0] || 'Gemini'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 space-y-2.5">
                      {/* Botão Primário: Disparar Auditoria Imediata */}
                      <button
                        type="submit"
                        disabled={running || savingModule}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm py-3.5 px-4 rounded-xl shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition disabled:opacity-50"
                      >
                        {running ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span>Processando Auditoria...</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 fill-white" />
                            <span>Disparar Auditoria Imediata</span>
                          </>
                        )}
                      </button>

                      {/* Botão Secundário: Salvar Alterações sem Rodar */}
                      <button
                        type="button"
                        onClick={handleSaveModuleConfig}
                        disabled={savingModule || running}
                        className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                      >
                        {savingModule ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>Salvando Alterações...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />
                            <span>Salvar Configuração do Módulo</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('agents')}
                        className="w-full text-xs font-semibold text-slate-400 hover:text-white py-1.5 text-center transition"
                      >
                        Voltar à Lista de Módulos
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card de Governança & Integridade Forense */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-xl text-xs space-y-2.5">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Integridade Forense & SHA-256</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    O conteúdo da página é convertido diretamente para Markdown (.md), tem seu hash criptográfico calculado e é confrontado com o rol de resoluções vigentes pela IA.
                  </p>
                </div>
              </div>
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
              {/* 1. Nome do Módulo */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome do Módulo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Auditor Deontológico Dermatológico"
                  value={newAgentData.name}
                  onChange={(e) => setNewAgentData({ ...newAgentData, name: e.target.value })}
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* 2. URL Alvo */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  URL Alvo Oficial *
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://exemplo-clinica.com.br"
                  value={newAgentData.targetUrl}
                  onChange={(e) => setNewAgentData({ ...newAgentData, targetUrl: e.target.value })}
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  A página será extraída exclusivamente em formato Markdown limpo via motor Firecrawl com verificação criptográfica SHA-256.
                </p>
              </div>

              {/* 3. Skill & Persona Deontológica da IA (Corpo Único) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Skill & Persona Deontológica da IA * <span className="text-[10px] text-purple-400 font-normal">(Corpo Único de Diretrizes)</span>
                  </label>
                </div>

                {/* Templates Rápidos para Criação */}
                <div className="mb-2">
                  <span className="text-[10px] text-slate-400 block mb-1.5 font-semibold uppercase">
                    Templates rápidos:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {SKILL_PERSONA_TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => handleApplyPersonaTemplateToNew(tmpl)}
                        className="px-2.5 py-1 bg-slate-900 hover:bg-purple-950/40 border border-slate-700/80 hover:border-purple-600/60 rounded-lg text-[11px] text-slate-300 hover:text-white transition"
                      >
                        {tmpl.shortName}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  required
                  rows={5}
                  placeholder="Descreva detalhadamente a persona, atribuições deontológicas e diretrizes comportamentais que guiarão a IA na auditoria deste módulo..."
                  value={newAgentData.description}
                  onChange={(e) => setNewAgentData({ ...newAgentData, description: e.target.value })}
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none font-mono leading-relaxed"
                />
              </div>

              {/* 4. Seletor de Tags Regulatórias (Vínculo Dinâmico no Banco) */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Tags Regulatórias * (Resolução Dinâmica de Normas no Banco)
                </label>
                
                {/* Badges rápidos de órgãos regulatórios */}
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {['cfm', 'lgpd', 'anvisa', 'ans'].map((tag) => {
                    const isSelected = newAgentData.tags.includes(tag);
                    return (
                      <button
                        type="button"
                        key={tag}
                        onClick={() => {
                          if (isSelected) {
                            setNewAgentData({
                              ...newAgentData,
                              tags: newAgentData.tags.filter((t) => t !== tag),
                            });
                          } else {
                            setNewAgentData({
                              ...newAgentData,
                              tags: [...newAgentData.tags, tag],
                            });
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        }`}
                      >
                        <span>{tag.toUpperCase()}</span>
                        {isSelected ? '✓' : '+'}
                      </button>
                    );
                  })}
                </div>

                {/* Input para Tags Livres Adicionais */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Adicionar outra tag (ex: telemedicina, rdc67)..."
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const tag = newTagInput.trim().toLowerCase();
                        if (tag && !newAgentData.tags.includes(tag)) {
                          setNewAgentData({ ...newAgentData, tags: [...newAgentData.tags, tag] });
                          setNewTagInput('');
                        }
                      }
                    }}
                    className="flex-1 bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const tag = newTagInput.trim().toLowerCase();
                      if (tag && !newAgentData.tags.includes(tag)) {
                        setNewAgentData({ ...newAgentData, tags: [...newAgentData.tags, tag] });
                        setNewTagInput('');
                      }
                    }}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold text-xs rounded-xl border border-slate-700 transition"
                  >
                    + Tag
                  </button>
                </div>

                {/* Tags Selecionadas */}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {newAgentData.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-cyan-950/80 border border-cyan-800 text-cyan-300 rounded-md text-[11px] font-mono"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() =>
                          setNewAgentData({
                            ...newAgentData,
                            tags: newAgentData.tags.filter((t) => t !== tag),
                          })
                        }
                        className="hover:text-red-400 ml-1 font-bold"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                {/* Box de Governança / Isolamento de Normas */}
                <div className="mt-3 p-3 bg-cyan-950/30 border border-cyan-900/50 rounded-xl text-[11px] text-cyan-300/90 leading-relaxed">
                  🛡️ <strong>Isolamento & Governança:</strong> Nenhuma norma física é copiada no cadastro. A IA recuperará dinamicamente todos os documentos normativos do banco de dados MongoDB associados às tags configuradas no momento da auditoria.
                </div>
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
