import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Download,
  Building,
  Stethoscope,
  ExternalLink,
  CheckCircle,
  FileText,
  Clock,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';

export const CustomerDashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [portalData, setPortalData] = useState<any>(null);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchPortalData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/clients/portal/me');
      setPortalData(res.data);
      if (res.data?.recentReports?.length > 0) {
        setSelectedReport(res.data.recentReports[0]);
      }
    } catch (err) {
      console.error('Erro ao carregar dados do portal do cliente:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPortalData();
  }, []);

  const handleResolveViolation = async (reportId: string, violationId: string) => {
    try {
      setResolvingId(violationId);
      await api.patch(`/reports/${reportId}/violations/${violationId}/resolve`);
      // Atualiza localmente
      if (selectedReport) {
        const updatedViolations = selectedReport.violations.map((v: any) =>
          v.id === violationId ? { ...v, resolved: true } : v
        );
        setSelectedReport({ ...selectedReport, violations: updatedViolations });
      }
      fetchPortalData();
    } catch (err: any) {
      alert(`Falha ao regularizar infração: ${err.message}`);
    } finally {
      setResolvingId(null);
    }
  };

  const handleDownloadReport = async (reportId: string) => {
    try {
      const response = await api.get(`/reports/${reportId}/export`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `laudo-deontologico-${reportId}.md`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      alert(`Erro ao baixar laudo: ${err.message}`);
    }
  };

  if (loading && !portalData) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
          <span className="text-xs text-slate-400">Carregando painel de conformidade da clínica...</span>
        </div>
      </div>
    );
  }

  const { client, overview } = portalData || {};
  const verdict = overview?.latestVerdict || 'PARCIALMENTE_CONFORME';
  const score = overview?.latestScore ?? 85;

  const isConforme = verdict === 'CONFORME';
  const isParcial = verdict === 'PARCIALMENTE_CONFORME';

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Banner da Clínica */}
      <div className="bg-gradient-to-r from-[#0d1836] to-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 text-emerald-400">
              <Building className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-white">{client?.name}</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {client?.status || 'ATIVO'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <Stethoscope className="h-3.5 w-3.5 text-slate-500" />
                <span>
                  Responsável Técnico: CRM/{client?.crmUf} {client?.crmResponsavel}
                </span>
                {client?.rqeResponsavel && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span>RQE nº {client?.rqeResponsavel}</span>
                  </>
                )}
                {client?.especialidade && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span>({client?.especialidade})</span>
                  </>
                )}
              </p>
              <a
                href={client?.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-400 hover:underline mt-1.5 inline-flex items-center gap-1 font-mono"
              >
                <span>{client?.websiteUrl}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchPortalData}
              className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {selectedReport && (
              <button
                onClick={() => handleDownloadReport(selectedReport.id)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 px-4 rounded-xl border border-slate-700 flex items-center gap-2 transition"
              >
                <Download className="h-4 w-4 text-emerald-400" />
                <span>Baixar Laudo Técnico (.MD)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Veredito Semáforo & Indicadores */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Veredito Semáforo */}
        <div
          className={`border rounded-2xl p-6 shadow-lg flex flex-col justify-between ${
            isConforme
              ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
              : isParcial
              ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
              : 'bg-red-950/20 border-red-800/40 text-red-300'
          }`}
        >
          <div>
            <span className="text-xs font-bold uppercase tracking-wider block opacity-75">
              Veredito Deontológico Geral
            </span>
            <div className="flex items-center gap-3 mt-3">
              <span
                className={`h-4 w-4 rounded-full animate-ping ${
                  isConforme ? 'bg-emerald-400' : isParcial ? 'bg-amber-400' : 'bg-red-400'
                }`}
              ></span>
              <h2 className="text-xl font-extrabold tracking-tight">
                {isConforme
                  ? '🟢 CONFORME (REGULAR)'
                  : isParcial
                  ? '🟡 PARCIALMENTE CONFORME'
                  : '🔴 NÃO CONFORME (CRÍTICO)'}
              </h2>
            </div>
            <p className="text-xs mt-2 opacity-90">
              {isConforme
                ? 'Sua clínica atende integralmente à Resolução CFM nº e diretrizes da LGPD.'
                : isParcial
                ? 'Identificamos oportunidades de adequação técnica recomendadas para prevenir autuações.'
                : 'Atenção imediata requerida: infrações de severidade alta ou crítica identificadas em seus canais.'}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-current/20 text-[11px] opacity-75 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>Última auditoria em: {overview?.lastAuditDate ? `${new Date(overview.lastAuditDate).toLocaleDateString('pt-BR')} às ${new Date(overview.lastAuditDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Hoje'}</span>
          </div>
        </div>

        {/* Score de Risco */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Índice de Conformidade Ética
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span
                className={`text-4xl font-extrabold ${
                  score >= 85 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400'
                }`}
              >
                {score}
              </span>
              <span className="text-sm text-slate-400">/ 100 pontos</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-2.5 mt-4">
              <div
                className={`h-2.5 rounded-full transition-all ${
                  score >= 85 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${score}%` }}
              ></div>
            </div>
          </div>
          <div className="mt-4 text-[11px] text-slate-400">
            Escala regulatória calibrada segundo normas do CFM e ANS
          </div>
        </div>

        {/* Pendências Críticas */}
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Pontos de Atenção Ativos
            </span>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl">
                <span className="text-2xl font-bold text-red-400 block">
                  {overview?.activeCriticalViolations || 0}
                </span>
                <span className="text-[11px] text-red-300">Críticas</span>
              </div>
              <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-xl">
                <span className="text-2xl font-bold text-amber-400 block">
                  {overview?.activeGraveViolations || 0}
                </span>
                <span className="text-[11px] text-amber-300">Graves</span>
              </div>
            </div>
          </div>
          <div className="mt-4 text-[11px] text-slate-400">
            Adequações prioritárias recomendadas pela consultoria
          </div>
        </div>
      </div>

      {/* Recomendações e Apontamentos do Laudo Mais Recente */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              <span>Diagnóstico Executivo & Recomendações Corretivas</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Orientações preventivas amigáveis para adequação imediata aos artigos do CFM
            </p>
          </div>
        </div>

        {selectedReport ? (
          <div className="space-y-6">
            {/* Resumo do laudo */}
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-300 leading-relaxed">
              <span className="font-semibold text-white block mb-1">Síntese do Auditor IA:</span>
              {selectedReport.summary}
            </div>

            {/* Lista de Violações */}
            <div className="space-y-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Itens Auditados com Apontamento ({selectedReport.violations?.length || 0})
              </h3>

              {selectedReport.violations?.length === 0 ? (
                <div className="p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800/80">
                  <CheckCircle className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-white">Nenhuma violação encontrada!</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Todos os canais digitais avaliados estão em perfeita conformidade com o CFM.
                  </p>
                </div>
              ) : (
                selectedReport.violations.map((v: any) => {
                  const severityColors: any = {
                    CRITICA: 'bg-red-500/10 text-red-400 border-red-500/20',
                    GRAVE: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
                    MEDIA: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                    LEVE: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                  };

                  return (
                    <div
                      key={v.id}
                      className={`p-4 rounded-xl border transition ${
                        v.resolved
                          ? 'bg-slate-900/40 border-slate-800/80 opacity-70'
                          : 'bg-slate-900/90 border-slate-800'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              severityColors[v.severity] || severityColors.MEDIA
                            }`}
                          >
                            {v.severity}
                          </span>
                          <span className="text-xs font-bold text-white">
                            {v.normCode} — {v.normArticle}
                          </span>
                        </div>

                        {v.resolved ? (
                          <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5" /> Adequação Concluída
                          </span>
                        ) : (
                          <button
                            onClick={() => handleResolveViolation(selectedReport.id, v.id)}
                            disabled={resolvingId === v.id}
                            className="text-xs font-medium text-slate-300 hover:text-emerald-400 bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded-lg transition"
                          >
                            Marcar como Regularizado
                          </button>
                        )}
                      </div>

                      <div className="mt-2 space-y-1.5 text-xs">
                        <p className="text-slate-400">
                          <span className="font-semibold text-slate-300">Evidência detectada:</span>{' '}
                          <span className="italic font-mono text-slate-300">"{v.detectedText}"</span>
                        </p>
                        <p className="text-emerald-400/90 font-medium">
                          <span className="text-slate-300 font-semibold">Como adequar:</span>{' '}
                          {v.correctiveAdvice}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-500">
            Nenhuma auditoria processada para esta clínica até o momento.
          </div>
        )}
      </div>
    </div>
  );
};

