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
} from 'lucide-react';
import { api } from '../services/api';

export const DashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);

  // Modal de Disparo Rápido de Auditoria
  const [showRunModal, setShowRunModal] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedMode, setSelectedMode] = useState('CHEERIO');
  const [runningAudit, setRunningAudit] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reportsRes, clientsRes, modulesRes] = await Promise.all([
        api.get('/reports?limit=8'),
        api.get('/clients?limit=100'),
        api.get('/agents'),
      ]);

      setReports(reportsRes.data?.data || []);
      setClients(clientsRes.data?.data || []);
      setModules(modulesRes.data || []);
      if (clientsRes.data?.data?.[0]?.id) {
        setSelectedClientId(clientsRes.data.data[0].id);
        setTargetUrl(clientsRes.data.data[0].websiteUrl || 'https://exemplo-clinica-saude-sintetica.med.br');
      }
    } catch (err) {
      console.error('Erro ao carregar dados do dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunAuditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modules[0]?.id) return;
    try {
      setRunningAudit(true);
      await api.post(`/agents/${modules[0].id}/run`, {
        clientId: selectedClientId,
        targetUrl,
        extractionMode: selectedMode,
      });
      setShowRunModal(false);
      // Aguarda 1 segundo e recarrega os laudos
      setTimeout(() => {
        fetchData();
      }, 1200);
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
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
            <span>Cockpit do Auditor Deontológico</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Monitoramento analítico em tempo real de conformidade com a Resolução CFM nº e LGPD.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowRunModal(true)}
            className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-semibold text-sm py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition"
          >
            <Play className="h-4 w-4 fill-white" />
            <span>Nova Auditoria Imediata</span>
          </button>
        </div>
      </div>

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

          <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>Critérios calibrados conforme Res. CFM 2.336/23</span>
          </div>
        </div>

        {/* Módulos de Auditoria Ativos */}
        <div className="lg:col-span-2 bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white">Módulos Especializados Integrados</h2>
              <p className="text-xs text-slate-400">Motores de extração e reconciliação em execução</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-2">
            {modules.map((m) => (
              <div
                key={m.id}
                className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400">{m.code}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                    {m.extractionMode}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-200 mt-1">{m.name}</h3>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabela de Laudos Recentes */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-emerald-400" />
              <span>Auditorias e Laudos Deontológicos Recentes</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Últimas varreduras efetuadas no ecossistema de saúde</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/50">
              <tr>
                <th className="py-3 px-4">Clínica Auditada</th>
                <th className="py-3 px-4">Canal / URL</th>
                <th className="py-3 px-4">Modo</th>
                <th className="py-3 px-4">Veredito Semáforo</th>
                <th className="py-3 px-4">Score</th>
                <th className="py-3 px-4">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                    Nenhuma auditoria registrada ainda. Clique em "Nova Auditoria Imediata" para rodar a primeira.
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

      {/* Modal Disparo de Auditoria */}
      {showRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-emerald-400 fill-emerald-400" />
              <span>Disparar Auditoria Deontológica</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Selecione a clínica alvo e o canal digital para varredura e cruzamento com a Resolução CFM.
            </p>

            <form onSubmit={handleRunAuditSubmit} className="space-y-4 mt-5">
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
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
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
                  placeholder="https://suaclinica.med.br"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Modo de Extração Polimórfico
                </label>
                <select
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="CHEERIO">CHEERIO (Parser Estático Ultrarrápido)</option>
                  <option value="PUPPETEER">PUPPETEER (SPA Dinâmica / Headless)</option>
                  <option value="FIRECRAWL">FIRECRAWL (API de Markdown Limpo)</option>
                  <option value="MCP">MCP (Model Context Protocol)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowRunModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={runningAudit}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 px-5 rounded-xl transition flex items-center gap-2 disabled:opacity-50"
                >
                  {runningAudit ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  ) : (
                    <>
                      <span>Iniciar Auditoria</span>
                      <Play className="h-3.5 w-3.5 fill-white" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

