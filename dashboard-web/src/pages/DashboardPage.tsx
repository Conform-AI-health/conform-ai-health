import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Building2,
  FileCheck2,
  Cpu,
  Play,
  TrendingUp,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Clock,
  CheckCircle2,
  LayoutDashboard,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { api } from '../services/api';

export const DashboardPage: React.FC = () => {
  // Aba Ativa: 'overview' | 'audit' | 'reports'
  const [activeTab, setActiveTab] = useState<'overview' | 'audit' | 'reports'>('overview');

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);

  // Disparo Rápido de Auditoria
  const [selectedClientId, setSelectedClientId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedMode, setSelectedMode] = useState('CHEERIO');
  const [runningAudit, setRunningAudit] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reportsRes, clientsRes, modulesRes] = await Promise.all([
        api.get('/reports?limit=10'),
        api.get('/clients?limit=100'),
        api.get('/agents'),
      ]);

      setReports(reportsRes.data?.data || []);
      setClients(clientsRes.data?.data || []);
      setModules(modulesRes.data?.data || (Array.isArray(modulesRes.data) ? modulesRes.data : []));

      if (clientsRes.data?.data?.[0]?.id && !selectedClientId) {
        setSelectedClientId(clientsRes.data.data[0].id);
        setTargetUrl(clientsRes.data.data[0].websiteUrl || '');
      }
    } catch (err) {
      console.error('Erro ao carregar dados do cockpit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunAuditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const firstModule = modules[0];
    if (!firstModule?.id) {
      alert('Nenhum módulo de agente disponível para execução.');
      return;
    }

    try {
      setRunningAudit(true);
      await api.post(`/agents/${firstModule.id}/run`, {
        clientId: selectedClientId,
        targetUrl,
        extractionMode: selectedMode,
      });

      alert('Auditoria deontológica enviada para a fila de processamento assíncrono!');
      // Redireciona para a aba de laudos e atualiza os dados
      setActiveTab('reports');
      setTimeout(() => {
        fetchData();
      }, 1500);
    } catch (err: any) {
      alert(`Falha ao disparar auditoria: ${err.response?.data?.error || err.message}`);
    } finally {
      setRunningAudit(false);
    }
  };

  // Cálculos de Indicadores
  const totalReports = reports.length;
  const compliantCount = reports.filter((r) => r.verdict === 'CONFORME').length;
  const partialCount = reports.filter((r) => r.verdict === 'PARCIALMENTE_CONFORME').length;
  const nonCompliantCount = reports.filter((r) => r.verdict === 'NAO_CONFORME').length;

  const avgScore =
    totalReports > 0
      ? Math.round(reports.reduce((acc, r) => acc + (r.score || 0), 0) / totalReports)
      : 0;

  const totalTokensSaved = reports.reduce((acc, r) => acc + (r.tokensSaved || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Unificado */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
            <span>Cockpit do Auditor Deontológico</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Monitoramento analítico em tempo real de conformidade com a Resolução CFM nº 2.336/2023 e LGPD.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition flex items-center gap-2 text-xs font-semibold"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Navegação por Abas do Cockpit */}
      <div className="border-b border-slate-800 flex items-center gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
            activeTab === 'overview'
              ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" />
          <span>Panorama & Indicadores</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
            activeTab === 'audit'
              ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          <Play className="h-4 w-4" />
          <span>Nova Auditoria Imediata</span>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
            activeTab === 'reports'
              ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          <FileCheck2 className="h-4 w-4" />
          <span>Últimos Laudos Concluídos</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
            {reports.length}
          </span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* ABA 1: PANORAMA & INDICADORES */}
      {/* ============================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1: Clínicas */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Clínicas Ativas
                </span>
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                  <Building2 className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white">{clients.length}</span>
                <span className="text-xs font-medium text-emerald-400 flex items-center">
                  <TrendingUp className="h-3 w-3 mr-0.5" /> 100% monitoradas
                </span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Mapeamento contínuo de CRM e RQE
              </div>
            </div>

            {/* Card 2: Conformidade Média */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Índice Deontológico
                </span>
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-emerald-400">{avgScore}</span>
                <span className="text-xs text-slate-400">/ 100 pts</span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Média ponderada do ecossistema
              </div>
            </div>

            {/* Card 3: Não-Conformes Críticos */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Violações Críticas
                </span>
                <div className="h-8 w-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-red-400">{nonCompliantCount}</span>
                <span className="text-xs text-slate-400">laudos vermelhos</span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Exigem notificação preventiva imediata
              </div>
            </div>

            {/* Card 4: Economia de Tokens via Sanitização */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Token Efficiency
                </span>
                <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <Cpu className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-purple-400">
                  {totalTokensSaved > 1000 ? `${(totalTokensSaved / 1000).toFixed(1)}k` : totalTokensSaved}
                </span>
                <span className="text-xs text-slate-400">tokens poupados</span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Redução de ~90% de custo LLM
              </div>
            </div>
          </div>

          {/* Semáforo & Status Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Distribuição Semáforo */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  <span>Distribuição Semáforo Deontológico</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Classificação executiva de risco regulatório no ecossistema
                </p>

                <div className="space-y-4 mt-6">
                  {/* Verde */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-emerald-400 flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span> Conforme (Regular)
                      </span>
                      <span className="text-slate-300">{compliantCount} laudos</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all"
                        style={{
                          width: totalReports > 0 ? `${(compliantCount / totalReports) * 100}%` : '0%',
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Amarelo */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-amber-400 flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span> Parcialmente Conforme (Atenção)
                      </span>
                      <span className="text-slate-300">{partialCount} laudos</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full transition-all"
                        style={{
                          width: totalReports > 0 ? `${(partialCount / totalReports) * 100}%` : '0%',
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Vermelho */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-red-400 flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span> Não Conforme (Crítico)
                      </span>
                      <span className="text-slate-300">{nonCompliantCount} laudos</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full transition-all"
                        style={{
                          width: totalReports > 0 ? `${(nonCompliantCount / totalReports) * 100}%` : '0%',
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800/80 mt-6 flex items-center justify-between text-xs">
                <span className="text-slate-400">Total auditado:</span>
                <span className="font-bold text-white font-mono">{totalReports} laudos</span>
              </div>
            </div>

            {/* Ação Rápida Integrada */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Play className="h-4 w-4 text-emerald-400 fill-emerald-400" />
                  <span>Auditoria Preventiva Contínua</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Dispare varreduras imediatas em websites ou contas de Instagram para prevenir multas do CFM.
                </p>

                <div className="mt-5 space-y-3">
                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">
                    <span className="text-slate-300 font-semibold block mb-0.5">Res. CFM 2.336/2023:</span>
                    <span className="text-slate-400 text-[11px]">
                      Auditoria de antes e depois educativo, identificação de responsável técnico e ausência de promoções.
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">
                    <span className="text-slate-300 font-semibold block mb-0.5">LGPD em Saúde:</span>
                    <span className="text-slate-400 text-[11px]">
                      Verificação de conformidade na captação de dados biométricos e histórico clínico de pacientes.
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveTab('audit')}
                className="mt-6 w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 transition"
              >
                <span>Abrir Formulário de Auditoria</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {/* Destaque de Clínicas */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-400" />
                  <span>Instituições sob Fiscalização</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Últimas clínicas registradas no ecossistema
                </p>

                <div className="mt-4 space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {clients.slice(0, 4).map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 text-xs flex items-center justify-between"
                    >
                      <div className="truncate mr-2">
                        <span className="font-semibold text-white truncate block">{c.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          CRM/{c.crmUf} {c.crmResponsavel}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/40">
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400">Total de clínicas:</span>
                <span className="font-bold text-white font-mono">{clients.length} ativas</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: NOVA AUDITORIA IMEDIATA (FORMULÁRIO EMBUTIDO) */}
      {/* ============================================================== */}
      {activeTab === 'audit' && (
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-7 shadow-xl max-w-2xl mx-auto">
          <div className="pb-4 border-b border-slate-800 mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-emerald-400 fill-emerald-400" />
              <span>Disparar Auditoria Deontológica Imediata</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure o canal digital alvo para reconciliação automática com as normas do CFM e LGPD.
            </p>
          </div>

          <form onSubmit={handleRunAuditSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Clínica / Instituição Médica *
              </label>
              <select
                value={selectedClientId}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  const selected = clients.find((c) => c.id === e.target.value);
                  if (selected?.websiteUrl) setTargetUrl(selected.websiteUrl);
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
                URL Oficial do Website ou Canal a Auditar *
              </label>
              <input
                type="url"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://clinicaexemplo.med.br"
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Modo de Extração de Conteúdo
              </label>
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="CHEERIO">CHEERIO (HTML Estático / Alta Performance)</option>
                <option value="PUPPETEER">PUPPETEER (Aplicações Dinâmicas SPA)</option>
                <option value="FIRECRAWL">FIRECRAWL (API de Markdown)</option>
                <option value="MCP">MCP (Model Context Protocol)</option>
              </select>
            </div>

            <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className="px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition"
              >
                Voltar ao Panorama
              </button>
              <button
                type="submit"
                disabled={runningAudit}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 px-6 rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition disabled:opacity-50"
              >
                {runningAudit ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Processando e Enviando...</span>
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

      {/* ============================================================== */}
      {/* ABA 3: ÚLTIMOS LAUDOS DE CONFORMIDADE */}
      {/* ============================================================== */}
      {activeTab === 'reports' && (
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-emerald-400" />
                <span>Últimos Laudos de Auditoria Deontológica</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Vereditos emitidos pelo motor de IA reconciliados contra o catálogo normativo
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/60">
                <tr>
                  <th className="py-3 px-4">Clínica / Médico</th>
                  <th className="py-3 px-4">URL Auditada</th>
                  <th className="py-3 px-4">Extração</th>
                  <th className="py-3 px-4">Veredito Semáforo</th>
                  <th className="py-3 px-4">Score</th>
                  <th className="py-3 px-4">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                      Nenhuma auditoria registrada ainda. Use a aba "Nova Auditoria Imediata" para rodar a primeira.
                    </td>
                  </tr>
                ) : (
                  reports.map((r) => {
                    const isConforme = r.verdict === 'CONFORME';
                    const isParcial = r.verdict === 'PARCIALMENTE_CONFORME';

                    return (
                      <tr key={r.id} className="hover:bg-slate-900/60 transition">
                        <td className="py-3 px-4">
                          <span className="font-semibold text-white block">
                            {r.client?.tradeName || r.client?.name || 'Clínica Médica'}
                          </span>
                          <span className="text-xs text-slate-400">
                            CRM/{r.client?.crmUf} {r.client?.crmResponsavel}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-slate-300 max-w-xs truncate">
                          {r.targetUrl}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono">
                            {r.extractionMode}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                              isConforme
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                : isParcial
                                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                                : 'bg-red-500/15 text-red-400 border border-red-500/20'
                            }`}
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isConforme ? 'bg-emerald-400' : isParcial ? 'bg-amber-400' : 'bg-red-400'
                              }`}
                            ></span>
                            {r.verdict}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-white">{r.score}/100</td>
                        <td className="py-3 px-4 text-xs text-slate-400">
                          {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
