import React, { useState, useEffect } from 'react';
import {
  Terminal,
  Cpu,
  Zap,
  Clock,
  FileCode,
  FileCheck2,
  RefreshCw,
  Search,
  Filter,
  ArrowDownRight,
  TrendingDown,
  Sparkles,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  DollarSign,
  ShieldAlert,
  Scale,
  History,
  ServerCrash,
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';

export const LogsTelemetryPage: React.FC = () => {
  const [telemetry, setTelemetry] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [livePolling, setLivePolling] = useState(true);
  const [logFilter, setLogFilter] = useState('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [selectedSourcesAudit, setSelectedSourcesAudit] = useState<{
    clientName: string;
    targetUrl: string;
    aiModelUsed: string;
    sources: string[];
  } | null>(null);

  const fetchTelemetry = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(true);
      const res = await api.get('/system/telemetry');
      setTelemetry(res.data);
    } catch (err) {
      console.error('Erro ao buscar telemetria:', err);
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const intervalTime = livePolling ? 3000 : 15000;
    const interval = setInterval(() => fetchTelemetry(true), intervalTime);
    return () => clearInterval(interval);
  }, [livePolling]);

  const metrics = telemetry?.metrics || {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalTokensSaved: 0,
    savingsPercentage: 0,
    averageLatencyMs: 0,
    minLatencyMs: 0,
    maxLatencyMs: 0,
    p95LatencyMs: 0,
    totalAudits: 0,
    activeAiModel: 'gemini',
    totalCostUsd: 0,
    totalCostBrl: 0,
    averageCostPerAuditUsd: 0,
    averageCostPerAuditBrl: 0,
    evidenceMissingRate: 0,
    invalidCitationsRate: 0,
    humanAiDivergenceRate: 0,
  };

  const audits = telemetry?.auditsTelemetry || [];
  const sourcesDistribution = telemetry?.sourcesDistribution || [];
  const modelFailureRates = telemetry?.modelFailureRates || [];
  const promptVersionHistory = telemetry?.promptVersionHistory || [];
  const logs = telemetry?.systemLogs || [];

  // Paginação dos Registros de Auditoria
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(5);
  const paginatedAudits = audits.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize);
  const totalAuditPages = Math.ceil(audits.length / auditPageSize) || 1;

  const filteredLogs = logs.filter((log: any) => {
    const matchesLevel = logFilter === 'ALL' || log.level === logFilter;
    const matchesSearch =
      !logSearch ||
      log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
      (log.module && log.module.toLowerCase().includes(logSearch.toLowerCase()));
    return matchesLevel && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Terminal className="h-7 w-7 text-emerald-400" />
            <span>Observabilidade de IA, Tokens & Logs Operacionais</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Métricas de consumo de tokens, catálogo de normas e arquivos utilizados para análise do agente.
          </p>
        </div>

        <button
          onClick={() => fetchTelemetry(false)}
          disabled={loading}
          className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition flex items-center gap-2 self-start md:self-auto text-xs font-semibold"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar Telemetria</span>
        </button>
      </div>

      {/* KPI Cards de Telemetria de Tokens */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Tokens Consumidos */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Tokens Consumidos
            </span>
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-purple-400">
              {metrics.totalTokens.toLocaleString('pt-BR')}
            </span>
            <span className="text-xs text-slate-500">tokens totais</span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 flex justify-between">
            <span>Prompt: {metrics.totalPromptTokens.toLocaleString('pt-BR')}</span>
            <span>Completion: {metrics.totalCompletionTokens.toLocaleString('pt-BR')}</span>
          </div>
        </div>

        {/* Tokens Economizados via Sanitização */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Economia de Contexto
            </span>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-400">
              {metrics.totalTokensSaved.toLocaleString('pt-BR')}
            </span>
            <span className="text-xs font-semibold text-emerald-400">
              (-{metrics.savingsPercentage}%)
            </span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
            Poupados via limpeza e extração Markdown
          </div>
        </div>

        {/* Latência Média */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Latência de Inferência
            </span>
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-blue-400">
              {metrics.averageLatencyMs}
            </span>
            <span className="text-xs text-slate-400">ms / auditoria</span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
            Tempo médio de varredura + reconciliação
          </div>
        </div>

        {/* Provedor e Modelo de IA Ativo */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Motor de Reconciliação
            </span>
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Zap className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-xl font-extrabold text-white uppercase">
              {metrics.activeAiModel}
            </span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
            Gemini 2.0 Flash com contingência Ollama/Regex
          </div>
        </div>
      </div>

      {/* Linha 2 de KPIs: Custo Financeiro, Confiabilidade de Guardrails e Divergência Humana */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Custo Médio e Total por Auditoria */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Custo por Auditoria
            </span>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-emerald-400">
              R$ {metrics.averageCostPerAuditBrl?.toFixed(4) || '0.0000'}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              ($ {metrics.averageCostPerAuditUsd?.toFixed(6) || '0.000000'})
            </span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 flex justify-between">
            <span>Total: R$ {metrics.totalCostBrl?.toFixed(2) || '0.00'}</span>
            <span>(${metrics.totalCostUsd?.toFixed(4) || '0.0000'})</span>
          </div>
        </div>

        {/* Taxa de Respostas sem Evidências */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Taxa Sem Evidências
            </span>
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-extrabold ${metrics.evidenceMissingRate > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {metrics.evidenceMissingRate || 0}%
            </span>
            <span className="text-xs text-slate-500">alucinação fática</span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
            Citações forjadas interceptadas pelo Guardrails
          </div>
        </div>

        {/* Taxa de Citações Inválidas */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Citações Inválidas
            </span>
            <div className="h-8 w-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-extrabold ${metrics.invalidCitationsRate > 5 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {metrics.invalidCitationsRate || 0}%
            </span>
            <span className="text-xs text-slate-500">normas fora do escopo</span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
            Normas revogadas ou inexistentes expurgadas
          </div>
        </div>

        {/* Taxa de Divergência Humano vs IA */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Divergência Humano vs IA
            </span>
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <Scale className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-indigo-400">
              {metrics.humanAiDivergenceRate || 0}%
            </span>
            <span className="text-xs text-slate-500">revisões manuais</span>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
            Discordâncias ou ajustes feitos por auditores
          </div>
        </div>
      </div>

      {/* Painel de Fontes & Arquivos Utilizados nas Auditorias */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-emerald-400" />
              <span>Arquivos e Normas Cadastradas mais Acionadas pelos Agentes</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Rastreamento de quais dispositivos legais e chunks de normas fundamentaram os pareceres dos agentes
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sourcesDistribution.length === 0 ? (
            <div className="col-span-3 py-6 text-center text-xs text-slate-500">
              Nenhuma fonte computada ainda. Execute auditorias para ver a telemetria de normas consultadas.
            </div>
          ) : (
            sourcesDistribution.map((src: any, index: number) => (
              <div
                key={index}
                className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between hover:border-slate-700 transition"
              >
                <div className="overflow-hidden pr-3">
                  <span className="text-xs font-semibold text-slate-200 block truncate">
                    {src.name}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Fonte Normativa da Base
                  </span>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-950/50 border border-emerald-800/40 text-emerald-400 text-xs font-mono font-bold flex-shrink-0">
                  {src.count}x
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Grid: Taxa de Falhas por Modelo & Histórico de Prompts e Versões */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Painel de Taxa de Falhas por Modelo de IA */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <ServerCrash className="h-5 w-5 text-rose-400" />
                <span>Taxa de Falhas & Resiliência por Modelo</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Métricas do Circuit Breaker e contingência automática por provedor de IA
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/50">
                <tr>
                  <th className="py-2.5 px-3">Modelo / Provedor</th>
                  <th className="py-2.5 px-3">Invocações</th>
                  <th className="py-2.5 px-3">Falhas</th>
                  <th className="py-2.5 px-3">Taxa de Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {modelFailureRates.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">
                      Nenhum dado de falha registrado.
                    </td>
                  </tr>
                ) : (
                  modelFailureRates.map((m: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 font-mono font-semibold text-white capitalize">
                        {m.model}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">
                        {m.invocations}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-rose-400">
                        {m.failures}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                          m.failureRate > 10
                            ? 'bg-rose-950/60 text-rose-300 border border-rose-800/40'
                            : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                        }`}>
                          {m.failureRate}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Histórico de Prompts e Versões dos Agentes */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <History className="h-5 w-5 text-teal-400" />
                <span>Histórico de Prompts & Versões dos Agentes</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Versionamento de instruções comportamentais e marcos deontológicos
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/50">
                <tr>
                  <th className="py-2.5 px-3">Agente</th>
                  <th className="py-2.5 px-3">Versão</th>
                  <th className="py-2.5 px-3">Marco</th>
                  <th className="py-2.5 px-3">Prompt Atual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {promptVersionHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">
                      Nenhum módulo de agente registrado.
                    </td>
                  </tr>
                ) : (
                  promptVersionHistory.slice(0, 5).map((p: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 font-semibold text-white">
                        {p.agentName}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-teal-300 font-mono text-[10px]">
                          v{p.version}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-400 truncate max-w-[120px]">
                        {p.framework}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-400 truncate max-w-[180px]" title={p.promptSnippet}>
                        {p.promptSnippet}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tabela de Telemetria por Auditoria (Tokens & Fontes Utilizadas) */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-purple-400" />
              <span>Detalhamento de Tokens e Fontes por Auditoria</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Relação de consumo exato de tokens e artigos normativos acionados em cada análise
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/50">
              <tr>
                <th className="py-3 px-4">Clínica & Canal</th>
                <th className="py-3 px-4">Modelo IA</th>
                <th className="py-3 px-4">Prompt Tokens</th>
                <th className="py-3 px-4">Completion Tokens</th>
                <th className="py-3 px-4">Total Tokens</th>
                <th className="py-3 px-4">Economia</th>
                <th className="py-3 px-4">Fontes / Normas Utilizadas</th>
                <th className="py-3 px-4">Latência</th>
                <th className="py-3 px-4">Custo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {audits.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500 text-xs">
                    Nenhum registro de telemetria processado até o momento.
                  </td>
                </tr>
              ) : (
                paginatedAudits.map((a: any) => (
                  <tr key={a.id} className="hover:bg-slate-900/60 transition text-xs">
                    <td className="py-3 px-4">
                      <span className="font-semibold text-white block">{a.clientName}</span>
                      <span className="font-mono text-[11px] text-slate-400 truncate max-w-[160px] block">
                        {a.targetUrl}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono px-2 py-0.5 rounded bg-slate-800 text-purple-300 text-[10px]">
                        {a.aiModelUsed}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {a.promptTokens.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {a.completionTokens.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-white">
                      {a.totalTokens.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-3 px-4 font-mono text-emerald-400">
                      +{a.tokensSaved.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-3 px-4">
                      {a.sourcesUsed && a.sourcesUsed.length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedSourcesAudit({
                              clientName: a.clientName,
                              targetUrl: a.targetUrl,
                              aiModelUsed: a.aiModelUsed,
                              sources: a.sourcesUsed,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-950/70 hover:bg-teal-900 border border-teal-800/60 text-teal-300 hover:text-white transition text-xs font-semibold group cursor-pointer shadow-sm"
                          title="Clique para abrir e inspecionar todas as normas/arquivos utilizados"
                        >
                          <BookOpen className="h-3.5 w-3.5 text-teal-400 group-hover:scale-110 transition-transform" />
                          <span className="font-mono">{a.sourcesUsed.length}</span>
                          <span className="text-[10px] text-teal-400/80 font-sans">
                            {a.sourcesUsed.length === 1 ? 'norma' : 'normas'}
                          </span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500 italic">Nenhuma fonte vinculada</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {a.executionTimeMs}ms
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-emerald-400">
                      R$ {a.costBrl ? a.costBrl.toFixed(4) : '0.0000'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação de Auditorias */}
        <Pagination
          currentPage={auditPage}
          totalPages={totalAuditPages}
          totalItems={audits.length}
          itemsPerPage={auditPageSize}
          onPageChange={(p) => setAuditPage(p)}
          onLimitChange={(l) => setAuditPageSize(l)}
          limitOptions={[5, 10, 25]}
          itemLabel="registros de auditoria"
        />
      </div>

      {/* Terminal de Logs Operacionais do Sistema */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Terminal className="h-5 w-5 text-emerald-400" />
              <span>Terminal de Logs Operacionais & Eventos de IA</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Rastreabilidade em tempo real de execuções do Cockpit, extrações de conteúdo e consumo de tokens da IA
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setLivePolling((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition ${
                livePolling
                  ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300 shadow-sm'
                  : 'bg-slate-900 border-slate-700/80 text-slate-400 hover:text-white'
              }`}
              title="Alternar atualização automática a cada 3 segundos"
            >
              <span className={`w-2 h-2 rounded-full ${livePolling ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              <span>{livePolling ? 'Live (3s)' : 'Pausado'}</span>
            </button>

            <button
              type="button"
              onClick={() => fetchTelemetry(false)}
              disabled={refreshing}
              className="bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
              title="Atualizar logs agora"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>Atualizar</span>
            </button>

            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filtrar por mensagem ou módulo..."
                className="bg-slate-900 border border-slate-700/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <select
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">Todos os níveis</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
        </div>

        {/* Terminal Window com Design de Console Autêntico */}
        <div className="bg-[#050914] rounded-2xl border border-slate-800/90 shadow-2xl overflow-hidden font-mono text-xs">
          {/* Header Bar do Console */}
          <div className="bg-[#080f24] px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
              </div>
              <span className="text-[11px] text-slate-400 ml-2 font-mono">
                conformia-audit@cockpit:~$ stream --tail -n 100
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-semibold">
              {filteredLogs.length} eventos registrados
            </span>
          </div>

          {/* Área de Linhas de Log */}
          <div className="p-4 max-h-[460px] overflow-y-auto space-y-2 select-text">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-10 text-slate-500 italic">
                <Terminal className="h-6 w-6 mx-auto mb-2 opacity-40 text-emerald-400" />
                Nenhum evento registrado no momento. Execute uma ação no Cockpit ou Coleta de Informações.
              </div>
            ) : (
              filteredLogs.map((l: any) => {
                const isError = l.level === 'ERROR';
                const isWarn = l.level === 'WARN';
                const mod = (l.module || '').toUpperCase();

                const isCockpit = mod.includes('COCKPIT');
                const isAiNorms = mod.includes('AI_NORMS') || mod.includes('NORMS');
                const isAi = mod.includes('AI') || mod.includes('INTERACTION');
                const isScraper = mod.includes('SCRAPER');
                const isRecon = mod.includes('RECON');
                const isClient = mod.includes('CLIENT');

                let parsedDetails: any = null;
                if (l.details) {
                  try {
                    parsedDetails = JSON.parse(l.details);
                  } catch {
                    // Texto plano
                  }
                }

                return (
                  <div
                    key={l.id}
                    className="flex items-start gap-2.5 leading-relaxed hover:bg-slate-900/40 px-2 py-1.5 rounded-lg border border-transparent hover:border-slate-800/60 transition"
                  >
                    <span className="text-slate-500 select-none flex-shrink-0 text-[11px] pt-0.5">
                      {new Date(l.createdAt).toLocaleTimeString('pt-BR')}
                    </span>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase flex-shrink-0 ${
                        isError
                          ? 'bg-red-950/80 text-red-400 border border-red-800/50'
                          : isWarn
                          ? 'bg-amber-950/80 text-amber-400 border border-amber-800/50'
                          : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                      }`}
                    >
                      {l.level}
                    </span>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono flex-shrink-0 border ${
                        isAiNorms
                          ? 'bg-teal-950/80 text-teal-300 border-teal-700/70 shadow-sm'
                          : isCockpit
                          ? 'bg-cyan-950/70 text-cyan-300 border-cyan-800/60'
                          : isAi
                          ? 'bg-purple-950/70 text-purple-300 border-purple-800/60'
                          : isScraper
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                          : isRecon
                          ? 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                          : isClient
                          ? 'bg-blue-950/70 text-blue-300 border-blue-800/60'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      [{l.module}]
                    </span>

                    <div className="flex-1 min-w-0">
                      <span className="text-slate-200 break-words">{l.message}</span>
                      
                      {/* Visualizador Estruturado para Normas e Fontes Utilizadas */}
                      {parsedDetails?.normsAndFilesUsed && Array.isArray(parsedDetails.normsAndFilesUsed) && (
                        <div className="mt-1.5 p-2 bg-[#080d1a] border border-teal-900/50 rounded-xl space-y-1.5 font-mono text-[11px]">
                          <span className="text-[10px] font-bold text-teal-400 uppercase tracking-wider block">
                            📚 Arquivos e Normas Deontológicas no Contexto da IA ({parsedDetails.normsAndFilesUsed.length}):
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {parsedDetails.normsAndFilesUsed.map((norm: string, nIdx: number) => (
                              <span
                                key={nIdx}
                                className="px-2 py-0.5 rounded bg-teal-950/60 border border-teal-800/50 text-teal-300 text-[10px]"
                              >
                                📄 {norm}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Visualizador Estruturado para Fontes no Log de Veredito da IA */}
                      {parsedDetails?.sourcesUsed && Array.isArray(parsedDetails.sourcesUsed) && (
                        <div className="mt-1.5 p-2 bg-[#080d1a] border border-purple-900/50 rounded-xl space-y-1 font-mono text-[11px]">
                          <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">
                            ⚖️ Normas Concretamente Aplicadas no Veredito:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {parsedDetails.sourcesUsed.map((source: string, sIdx: number) => (
                              <span
                                key={sIdx}
                                className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/50 text-purple-300 text-[10px]"
                              >
                                {source}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Detalhes Genéricos */}
                      {l.details && !parsedDetails?.normsAndFilesUsed && !parsedDetails?.sourcesUsed && (
                        <div className="mt-1 text-[11px] text-slate-400 bg-[#080d1a] border border-slate-800/80 rounded px-2.5 py-1 font-mono inline-block max-w-full overflow-x-auto">
                          {l.details}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Modal Dialog: Detalhamento de Normas e Fontes Utilizadas */}
      {selectedSourcesAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/60">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Fontes & Normas Regulatórias Utilizadas</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-teal-950 text-teal-300 border border-teal-800/60">
                      {selectedSourcesAudit.sources.length} arquivos
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedSourcesAudit.clientName} &bull; Modelo:{' '}
                    <span className="text-purple-300 font-mono font-semibold">
                      {selectedSourcesAudit.aiModelUsed}
                    </span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSourcesAudit(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                title="Fechar modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content - Listagem de Arquivos/Normas */}
            <div className="p-5 overflow-y-auto flex-1 space-y-2.5 max-h-[55vh]">
              <div className="text-xs text-slate-400 mb-3 bg-slate-900/40 p-3 rounded-xl border border-slate-800/60">
                Estas normas e resoluções foram recuperadas dinamicamente da collection{' '}
                <code className="text-teal-300 font-mono">scraped_pages</code> no MongoDB e injetadas no
                contexto do modelo de IA para reconciliação do veredito desta auditoria.
              </div>

              {selectedSourcesAudit.sources.map((src, index) => {
                const isRevogado = src.toLowerCase().includes('revogad');
                return (
                  <div
                    key={index}
                    className="p-3 bg-slate-900/70 hover:bg-slate-900 border border-slate-800/80 rounded-xl flex items-start justify-between gap-3 transition"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="text-sm mt-0.5">📄</span>
                      <div className="min-w-0">
                        <span className="font-semibold text-white text-xs block break-words">
                          {src}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                          Arquivo #{index + 1} &bull; Referência Oficial da Auditoria
                        </span>
                      </div>
                    </div>
                    {isRevogado && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-rose-950 text-rose-400 border border-rose-800/50 shrink-0">
                        REVOGADO
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/40 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-mono truncate max-w-[380px]" title={selectedSourcesAudit.targetUrl}>
                Alvo: {selectedSourcesAudit.targetUrl}
              </span>
              <button
                onClick={() => setSelectedSourcesAudit(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

