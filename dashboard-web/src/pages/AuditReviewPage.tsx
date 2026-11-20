import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  Building,
  ExternalLink,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  Mail,
  Send,
  Sparkles,
  RefreshCw,
  Clock,
  UserCheck,
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../services/api';
import { useToast } from '../context/ToastContext';

interface PendingReport {
  id: string;
  clientId?: string;
  client?: {
    id: string;
    name: string;
    tradeName?: string;
    crmResponsavel?: string;
    crmUf?: string;
    email?: string;
    users?: { email: string }[];
  };
  targetUrl?: string;
  verdict: 'CONFORME' | 'PARCIALMENTE_CONFORME' | 'NAO_CONFORME' | 'INCONCLUSIVO';
  score?: number;
  groundingScore?: number;
  summary?: string;
  createdAt: string;
  reviewStatus?: string;
  auditorReviewed?: boolean;
  violations?: {
    id: string;
    normArticle?: string;
    normCode?: string;
    severity: string;
    detectedText?: string;
    correctiveAdvice?: string;
    resolved: boolean;
  }[];
  sourcesUsed?: string[];
}

export const AuditReviewPage: React.FC = () => {
  const toast = useToast();
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  // Estados locais por laudo (checkbox de auditor e notas)
  const [checkedAgreements, setCheckedAgreements] = useState<Record<string, boolean>>({});
  const [auditorNotes, setAuditorNotes] = useState<Record<string, string>>({});
  const [expandedReports, setExpandedReports] = useState<Record<string, boolean>>({});

  const fetchPendingReports = async () => {
    try {
      setLoading(true);
      const res = await api.get('/reports/pending-review');
      const list = res.data?.data || [];
      setReports(list);

      // Abre automaticamente os primeiros itens para revisão
      const initialExpanded: Record<string, boolean> = {};
      list.forEach((r: PendingReport, index: number) => {
        if (index === 0) initialExpanded[r.id] = true;
      });
      setExpandedReports(initialExpanded);
    } catch (err: any) {
      console.error('Erro ao carregar laudos pendentes de revisão:', err);
      toast.error(err.response?.data?.error || 'Erro ao carregar fila de revisão de laudos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingReports();
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedReports((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCheckboxChange = (id: string, checked: boolean) => {
    setCheckedAgreements((prev) => ({ ...prev, [id]: checked }));
  };

  const handleNotesChange = (id: string, text: string) => {
    setAuditorNotes((prev) => ({ ...prev, [id]: text }));
  };

  const handleConfirmAndSend = async (report: PendingReport) => {
    const isChecked = !!checkedAgreements[report.id];
    if (!isChecked) {
      toast.error('Você deve assinalar o checkbox de revisão e conformidade do auditor antes de enviar.');
      return;
    }

    try {
      setSubmittingId(report.id);
      const notes = auditorNotes[report.id] || 'Laudo revisado e confirmado pelo auditor responsável.';

      const res = await api.post(`/reports/${report.id}/confirm-and-send`, {
        confirmed: true,
        decision: 'APPROVED',
        notes,
      });

      toast.success(
        res.data?.emailSent
          ? 'Laudo confirmado e e-mail enviado para a clínica com sucesso!'
          : 'Laudo confirmado com sucesso! (Nenhum e-mail de destino cadastrado para envio automático).'
      );

      // Remove da fila de pendentes
      setReports((prev) => prev.filter((r) => r.id !== report.id));
    } catch (err: any) {
      console.error('Erro ao confirmar laudo e enviar e-mail:', err);
      toast.error(err.response?.data?.error || 'Falha ao confirmar o laudo e enviar e-mail.');
    } finally {
      setSubmittingId(null);
    }
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'CONFORME':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-950/70 text-emerald-400 border border-emerald-800/80">
            <CheckCircle className="w-3.5 h-3.5" /> Conforme
          </span>
        );
      case 'PARCIALMENTE_CONFORME':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-950/70 text-amber-400 border border-amber-800/80">
            <AlertTriangle className="w-3.5 h-3.5" /> Parcialmente Conforme
          </span>
        );
      case 'NAO_CONFORME':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-950/70 text-rose-400 border border-rose-800/80">
            <ShieldAlert className="w-3.5 h-3.5" /> Não Conforme
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
            <AlertCircle className="w-3.5 h-3.5" /> {verdict}
          </span>
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#070d1e] p-6 lg:p-8 space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-950/80 to-blue-950/60 border border-cyan-800/50 text-cyan-400 shadow-md shadow-cyan-950/40">
              <ClipboardCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-100 tracking-tight flex items-center gap-2">
                Revisão & Homologação de Laudos
                <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-700/60">
                  HITL • CFM
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Validação humana obrigatória antes da liberação do laudo e disparo oficial do e-mail à clínica médica.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchPendingReports}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 hover:border-slate-600 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Atualizar Fila</span>
          </button>
          <div className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-cyan-950/40 border border-cyan-800/60 text-cyan-300">
            Pendentes:{' '}
            <span className="font-bold text-white ml-1 bg-cyan-500/20 px-2 py-0.5 rounded-md">
              {reports.length}
            </span>
          </div>
        </div>
      </div>

      {/* Alerta de Governança e Deontologia */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/30 via-cyan-950/20 to-slate-900 border border-cyan-800/30 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 space-y-1">
          <p className="font-bold text-cyan-200">
            Governança Deontológica Human-in-the-Loop (CFM 2.336/23 & ISO/IEC 42001)
          </p>
          <p className="text-slate-400 leading-relaxed">
            Os laudos pré-analisados pelos modelos de IA não são enviados diretamente aos clientes. Como auditor
            responsável, confira os achados, as evidências extraídas do canal digital e marque o checkbox de
            confirmação para homologar o parecer e autorizar o envio eletrônico à diretoria médica da clínica.
          </p>
        </div>
      </div>

      {/* Fila de Laudos Pendentes */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
          <p className="text-sm font-medium">Buscando laudos pendentes de homologação...</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 px-4 bg-[#0b1329] border border-slate-800/80 rounded-2xl space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-950/40 border border-emerald-800/50 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-slate-200">Nenhum laudo pendente de revisão</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Todas as auditorias geradas pela IA já foram homologadas e devidamente notificadas às clínicas clientes.
            Novas auditorias concluídas aparecerão aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => {
            const isExpanded = !!expandedReports[report.id];
            const isChecked = !!checkedAgreements[report.id];
            const isSubmitting = submittingId === report.id;
            const violations = report.violations || [];
            const clientName = report.client?.tradeName || report.client?.name || 'Clínica Médica';
            const techResp = report.client?.crmResponsavel
              ? `CRM/${report.client.crmUf || '-'} ${report.client.crmResponsavel}`
              : 'Não informado';
            const clientEmail = report.client?.email || (report.client?.users?.[0]?.email ?? 'Sem e-mail cadastrado');

            return (
              <div
                key={report.id}
                className="bg-[#0b1329] border border-slate-800/90 hover:border-cyan-800/40 rounded-2xl overflow-hidden transition-all duration-200 shadow-lg shadow-black/20"
              >
                {/* Cabeçalho do Card */}
                <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/60 bg-[#080f24]/50">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                        <Building className="w-4 h-4 text-cyan-400" />
                        {clientName}
                      </h3>
                      {getVerdictBadge(report.verdict)}
                      <span className="text-xs px-2 py-0.5 rounded-md font-mono bg-slate-800/90 text-slate-300 border border-slate-700/60">
                        Score: {report.score ?? 0}/100
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span>
                        <strong className="text-slate-300">Responsável:</strong> {techResp}
                      </span>
                      <span>
                        <strong className="text-slate-300">Destinatário:</strong> {clientEmail}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        {formatDateTime(report.createdAt)}
                      </span>
                    </div>

                    {report.targetUrl && (
                      <div className="flex items-center gap-1.5 text-xs text-cyan-400/90 truncate max-w-xl">
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                        <a
                          href={report.targetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline truncate"
                        >
                          {report.targetUrl}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleExpand(report.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-750 border border-slate-700/80 transition"
                    >
                      <span>{isExpanded ? 'Ocultar Detalhes' : 'Ver Achados & Revisar'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Corpo Expansível */}
                {isExpanded && (
                  <div className="p-5 space-y-6">
                    {/* Resumo da IA */}
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                      <div className="flex items-center gap-2 font-bold text-slate-200">
                        <FileText className="w-4 h-4 text-cyan-400" />
                        <span>Parecer Preliminar Gerado pela IA</span>
                      </div>
                      <p className="leading-relaxed text-slate-300">{report.summary || 'Sem resumo executivo disponível.'}</p>
                    </div>

                    {/* Violações Detectadas */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Apontamentos & Violações Regulatórias ({violations.length})</span>
                      </h4>

                      {violations.length === 0 ? (
                        <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          <span>Nenhuma infração regulatória identificada pela IA neste canal digital.</span>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {violations.map((v, idx) => (
                            <div
                              key={v.id || idx}
                              className="p-3.5 rounded-xl bg-[#080f24] border border-slate-800/80 text-xs space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-cyan-300">
                                  {idx + 1}. {v.normCode || 'Normativo Vigente'} — {v.normArticle || 'Artigo'}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    v.severity === 'ALTA'
                                      ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                      : v.severity === 'MEDIA'
                                      ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                      : 'bg-blue-950 text-blue-400 border border-blue-800'
                                  }`}
                                >
                                  Severidade {v.severity}
                                </span>
                              </div>
                              {v.detectedText && (
                                <p className="text-slate-400 italic bg-slate-900/60 p-2 rounded border border-slate-800">
                                  "{v.detectedText}"
                                </p>
                              )}
                              {v.correctiveAdvice && (
                                <p className="text-slate-300">
                                  <strong className="text-cyan-400">Recomendação Deontológica:</strong>{' '}
                                  {v.correctiveAdvice}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Seção de Homologação e Confirmação do Auditor */}
                    <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-950/30 via-slate-900 to-[#080f24] border border-cyan-800/50 space-y-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                        <UserCheck className="w-4 h-4 text-cyan-400" />
                        <span>Homologação do Auditor & Autorização de Envio</span>
                      </div>

                      {/* Observações / Parecer do Auditor */}
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-300 font-medium">
                          Parecer do Auditor / Notas Técnicas (Opcional):
                        </label>
                        <textarea
                          rows={2}
                          value={auditorNotes[report.id] || ''}
                          onChange={(e) => handleNotesChange(report.id, e.target.value)}
                          placeholder="Ex: Laudo auditado e aprovado com ressalva referente ao Artigo 14 da Res. CFM 2.336/23..."
                          className="w-full text-xs p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
                        />
                      </div>

                      {/* Checkbox do Auditor */}
                      <label className="flex items-start gap-3 p-3 rounded-xl bg-cyan-950/20 border border-cyan-800/30 cursor-pointer hover:bg-cyan-950/30 transition">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleCheckboxChange(report.id, e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-400 focus:ring-offset-0 cursor-pointer"
                        />
                        <span className="text-xs text-slate-200 font-medium leading-relaxed">
                          <strong className="text-cyan-300">Checked do Auditor:</strong> Declaro que revisei os
                          achados deontológicos, confirmo as evidências de conformidade/infração detectadas e autorizo
                          a homologação final do laudo com o disparo oficial do e-mail para a clínica{' '}
                          <span className="text-white font-bold">"{clientName}"</span> ({clientEmail}).
                        </span>
                      </label>

                      {/* Botão de Confirmação & Envio de E-mail */}
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => handleConfirmAndSend(report)}
                          disabled={!isChecked || isSubmitting}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-md shadow-cyan-950/50 disabled:opacity-40 disabled:cursor-not-allowed transition duration-150"
                        >
                          {isSubmitting ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Homologando & Enviando E-mail...</span>
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4" />
                              <span>Confirmar Laudo & Enviar E-mail</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
