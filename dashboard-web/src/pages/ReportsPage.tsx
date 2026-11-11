import React, { useState, useEffect } from 'react';
import {
  FileCheck2,
  Download,
  ExternalLink,
  Search,
  Filter,
  Eye,
  CheckCircle,
  X,
  Clock,
  Sparkles,
  Building,
  ShieldAlert,
  AlertTriangle,
  UserCheck,
  Activity,
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';
import { useToast } from '../context/ToastContext';

export const ReportsPage: React.FC = () => {
  const toast = useToast();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [verdictFilter, setVerdictFilter] = useState('');
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalReports, setTotalReports] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const formatDateTime = (dateStr?: string | Date | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const date = d.toLocaleDateString('pt-BR');
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${date} às ${time}`;
  };

  const fetchReports = async (page = currentPage, limit = pageSize) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (verdictFilter) params.append('verdict', verdictFilter);
      params.append('page', String(page));
      params.append('limit', String(limit));

      const res = await api.get(`/reports?${params.toString()}`);
      setReports(res.data?.data || []);
      if (res.data?.pagination) {
        setTotalReports(res.data.pagination.total);
        setTotalPages(res.data.pagination.totalPages);
        setCurrentPage(res.data.pagination.page);
      }
    } catch (err) {
      console.error('Erro ao carregar laudos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports(1, pageSize);
  }, [verdictFilter]);

  useEffect(() => {
    fetchReports(currentPage, pageSize);
  }, [currentPage, pageSize]);

  const handleOpenDetails = async (id: string) => {
    try {
      setLoadingDetails(true);
      const [resReport, resContract] = await Promise.all([
        api.get(`/reports/${id}`),
        api.get(`/reports/${id}/contract`).catch(() => ({ data: null })),
      ]);
      setSelectedReport({
        ...resReport.data,
        contract: resContract.data,
      });
    } catch (err: any) {
      toast.error(`Erro ao abrir detalhes: ${err.message}`);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDownload = async (id: string) => {
    try {
      const response = await api.get(`/reports/${id}/export`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `laudo-conformia-${id}.md`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Laudo técnico exportado com sucesso em Markdown!');
    } catch (err: any) {
      toast.error(`Falha no download: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <FileCheck2 className="h-7 w-7 text-emerald-400" />
            <span>Laudos de Auditoria Deontológica</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Histórico imutável de varreduras, apontamentos de conformidade e recomendações para o ecossistema de saúde.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="">Todos os vereditos</option>
            <option value="CONFORME">🟢 Conforme</option>
            <option value="PARCIALMENTE_CONFORME">🟡 Parcialmente Conforme</option>
            <option value="NAO_CONFORME">🔴 Não Conforme</option>
            <option value="INCONCLUSIVO">⚪ Inconclusivo (Revisão)</option>
          </select>
        </div>
      </div>

      {/* Tabela de Laudos */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl shadow-lg overflow-hidden">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/60">
            <tr>
              <th className="py-3.5 px-4">Clínica / CRM</th>
              <th className="py-3.5 px-4">Canal / URL</th>
              <th className="py-3.5 px-4">Veredito Semáforo</th>
              <th className="py-3.5 px-4">Pontuação</th>
              <th className="py-3.5 px-4">Economia Tokens</th>
              <th className="py-3.5 px-4">Data & Horário</th>
              <th className="py-3.5 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                  Carregando laudos...
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                  Nenhum laudo encontrado.
                </td>
              </tr>
            ) : (
              reports.map((r) => {
                const isConforme = r.verdict === 'CONFORME';
                const isParcial = r.verdict === 'PARCIALMENTE_CONFORME';
                const isInconclusivo = r.verdict === 'INCONCLUSIVO';

                const badgeClass = isConforme
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : isParcial
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : isInconclusivo
                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20';

                const dotClass = isConforme
                  ? 'bg-emerald-400'
                  : isParcial
                  ? 'bg-amber-400'
                  : isInconclusivo
                  ? 'bg-sky-400'
                  : 'bg-red-400';

                return (
                  <tr key={r.id} className="hover:bg-slate-900/50 transition">
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-white block">
                        {r.client?.tradeName || r.client?.name || 'Clínica Médica'}
                      </span>
                      <span className="text-xs text-slate-400">
                        CRM/{r.client?.crmUf || '-'} {r.client?.crmResponsavel || '-'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-slate-400 max-w-[200px] truncate">
                      {r.targetUrl || 'N/A'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeClass}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`}></span>
                        {r.verdict}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">{r.score}/100</td>
                    <td className="py-3.5 px-4 text-xs text-purple-400 font-mono">
                      +{r.tokensSaved} tokens
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-300 font-mono whitespace-nowrap">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleOpenDetails(r.id)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition inline-flex items-center gap-1 text-xs"
                        title="Ver Detalhes"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Ver Laudo</span>
                      </button>
                      <button
                        onClick={() => handleDownload(r.id)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg transition inline-flex items-center"
                        title="Baixar em Markdown"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Paginação de Laudos */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalReports}
          itemsPerPage={pageSize}
          onPageChange={(p) => setCurrentPage(p)}
          onLimitChange={(l) => setPageSize(l)}
          limitOptions={[5, 10, 20, 50]}
          itemLabel="laudos de auditoria"
        />
      </div>

      {/* Modal / Drawer de Detalhes do Laudo */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Laudo ID: {selectedReport.id}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedReport.status === 'COMPLETED'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : selectedReport.status === 'RUNNING'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'
                        : selectedReport.status === 'QUEUED'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}
                  >
                    {selectedReport.status === 'COMPLETED'
                      ? 'CONCLUÍDO'
                      : selectedReport.status === 'RUNNING'
                      ? 'EM ANÁLISE'
                      : selectedReport.status === 'QUEUED'
                      ? 'NA FILA (ASSÍNCRONO)'
                      : 'FALHA TÉCNICA'}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  {selectedReport.client?.tradeName || selectedReport.client?.name || 'Clínica Médica'}
                </h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-400">
                  <span className="font-mono">{selectedReport.targetUrl || 'Canal não informado'}</span>
                  <span className="text-slate-600">•</span>
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Emitido em: {formatDateTime(selectedReport.createdAt)}</span>
                  </span>
                  {selectedReport.aiModelUsed && (
                    <>
                      <span className="text-slate-600">•</span>
                      <span className="inline-flex items-center gap-1 text-purple-400 font-mono text-[11px]">
                        <Sparkles className="h-3 w-3" />
                        <span>{selectedReport.aiModelUsed}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Alerta de Governança Médica / Revisão Humana Obrigatória */}
              {selectedReport.contract?.requires_human_review && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 animate-in fade-in duration-300">
                  <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                        <span>Intervenção Médica Mandatória (CFM)</span>
                      </h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-md border border-amber-500/40">
                        {selectedReport.contract.audit_id || 'AUD-CFM'}
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-200/90 mt-1 leading-relaxed">
                      Este laudo contém apontamentos com potencial impacto disciplinar que exigem validação e assinatura por médico auditor ou Responsável Técnico (CRM/RQE) antes de conclusões definitivas.
                    </p>
                  </div>
                </div>
              )}

              {/* Badges de Topo */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Veredito</span>
                  <span className="text-sm font-bold text-emerald-400 block mt-1">
                    {selectedReport.verdict}
                  </span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Pontuação</span>
                  <span className="text-sm font-bold text-white block mt-1">
                    {selectedReport.score} / 100 pts
                  </span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Nível de Risco</span>
                  <span className={`text-sm font-bold block mt-1 ${
                    selectedReport.contract?.risk_level === 'CRITICAL' || selectedReport.contract?.risk_level === 'HIGH'
                      ? 'text-rose-400'
                      : selectedReport.contract?.risk_level === 'MEDIUM'
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}>
                    {selectedReport.contract?.risk_level || 'PADRÃO'}
                  </span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Certeza do Modelo</span>
                  <span className="text-sm font-bold text-purple-400 block mt-1">
                    {selectedReport.contract?.confidence
                      ? `${Math.round(selectedReport.contract.confidence * 100)}%`
                      : '95%'}
                  </span>
                </div>
              </div>

              {/* Resumo da IA */}
              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-xs font-bold text-slate-300 block mb-1">
                  Parecer Deontológico Sintético:
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedReport.summary || 'Resumo executivo não registrado.'}</p>
              </div>

              {/* Violações */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Violações e Apontamentos ({selectedReport.violations?.length || 0})
                </h3>
                <div className="space-y-3">
                  {selectedReport.violations?.map((v: any, index: number) => {
                    const matchedFinding = selectedReport.contract?.findings?.[index];
                    const requiresReview = matchedFinding?.requires_human_review ?? (v.severity === 'CRITICA' || v.severity === 'GRAVE');
                    return (
                      <div
                        key={v.id}
                        className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-white">
                            [{v.severity}] {v.normCode} — {v.normArticle}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {requiresReview && (
                              <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <UserCheck className="h-3 w-3" />
                                <span>Revisão Humana Mandatória</span>
                              </span>
                            )}
                            {v.resolved && (
                              <span className="text-[10px] text-emerald-400 font-bold">
                                Regularizado
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-slate-400">
                          <span className="text-slate-300">Evidência:</span>{' '}
                          <span className="italic">"{v.detectedText}"</span>
                        </p>
                        <p className="text-xs text-emerald-400 font-medium">
                          <span className="text-slate-300">Recomendação:</span> {v.correctiveAdvice}
                        </p>
                      </div>
                    );
                  })}

                  {(!selectedReport.violations || selectedReport.violations.length === 0) && (
                    <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
                      {selectedReport.status === 'COMPLETED' ? (
                        <div className="space-y-1">
                          <CheckCircle className="h-6 w-6 text-emerald-400 mx-auto" />
                          <p className="text-xs font-semibold text-emerald-300">
                            Nenhuma infração deontológica identificada nesta varredura.
                          </p>
                          <p className="text-[11px] text-slate-400">
                            O material auditado encontra-se em plena conformidade com as resoluções vigentes.
                          </p>
                        </div>
                      ) : selectedReport.status === 'QUEUED' || selectedReport.status === 'RUNNING' ? (
                        <div className="space-y-1">
                          <Clock className="h-6 w-6 text-amber-400 mx-auto animate-pulse" />
                          <p className="text-xs font-semibold text-amber-300">
                            Auditoria em processamento assíncrono pelo motor de IA.
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Aguarde alguns instantes ou atualize a página para visualizar o parecer e infrações consolidadas.
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-red-400">
                          Auditoria finalizada com falha técnica ou sem dados consolidados.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end gap-3">
              <button
                onClick={() => handleDownload(selectedReport.id)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition"
              >
                <Download className="h-4 w-4" />
                <span>Exportar Laudo Completo (.MD)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

