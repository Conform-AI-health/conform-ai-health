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
  Download,
  CheckCheck,
  Inbox,
  History,
  CheckCircle2,
  XCircle,
  X,
  MailX,
  Ban,
  Search,
  Filter,
  RotateCcw,
  Calendar,
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';
import { useToast } from '../context/ToastContext';
import { InfoTooltip } from '../components/Tooltip';
import { METRIC_GLOSSARY } from '../utils/metricGlossary';

interface ReportItem {
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
  updatedAt?: string;
  reviewStatus?: string;
  auditorReviewed?: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  auditorNotes?: string;
  emailSent?: boolean;
  emailSentAt?: string;
  violations?: {
    id: string;
    normArticle?: string;
    normCode?: string;
    severity: string;
    detectedText?: string | null;
    correctiveAdvice?: string | null;
    description?: string | null;
    sourceVersion?: string | null;
    validityStatus?: string;
    requiresHumanReview?: boolean;
    resolved: boolean;
  }[];
  sourcesUsed?: string[];
  riskLevel?: string;
  confidence?: number;
}

export const AuditReviewPage: React.FC = () => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'pending' | 'processed'>('pending');

  // Estados da aba de Pendências
  const [pendingReports, setPendingReports] = useState<ReportItem[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [checkedAgreements, setCheckedAgreements] = useState<Record<string, boolean>>({});
  const [auditorNotes, setAuditorNotes] = useState<Record<string, string>>({});
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingLimit, setPendingLimit] = useState(10);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingTotalPages, setPendingTotalPages] = useState(1);

  // Estados da aba de Processados
  const [processedReports, setProcessedReports] = useState<ReportItem[]>([]);
  const [loadingProcessed, setLoadingProcessed] = useState(false);
  const [resendingEmailId, setResendingEmailId] = useState<string | null>(null);
  const [processedPage, setProcessedPage] = useState(1);
  const [processedLimit, setProcessedLimit] = useState(10);
  const [processedTotal, setProcessedTotal] = useState(0);
  const [processedTotalPages, setProcessedTotalPages] = useState(1);

  // Estados de Filtros Dinâmicos
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState('');
  const [emailStatusFilter, setEmailStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [clientsList, setClientsList] = useState<{ id: string; name: string; tradeName?: string }[]>([]);

  // Estados para Modal de Recusa de Laudo
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [reportToReject, setReportToReject] = useState<ReportItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  // Expansão de cards
  const [expandedReports, setExpandedReports] = useState<Record<string, boolean>>({});

  // Debounce da busca textual (350ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPendingPage(1);
      setProcessedPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Carrega lista de clínicas para o seletor de filtro
  useEffect(() => {
    api
      .get('/clients?limit=100')
      .then((res) => {
        setClientsList(res.data?.data || []);
      })
      .catch(() => {});
  }, []);

  const buildQueryParams = (tab: 'pending' | 'processed', page: number, limit: number): string => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (selectedClientId) params.set('clientId', selectedClientId);
    if (verdictFilter) params.set('verdict', verdictFilter);
    if (severityFilter) params.set('severity', severityFilter);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (tab === 'processed') {
      if (reviewStatusFilter) params.set('reviewStatus', reviewStatusFilter);
      if (emailStatusFilter) params.set('emailStatus', emailStatusFilter);
    }
    return params.toString();
  };

  const hasActiveFilters = Boolean(
    searchInput.trim() ||
      selectedClientId ||
      verdictFilter ||
      severityFilter ||
      startDate ||
      endDate ||
      (activeTab === 'processed' && (reviewStatusFilter || emailStatusFilter))
  );

  const handleClearFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setSelectedClientId('');
    setVerdictFilter('');
    setSeverityFilter('');
    setReviewStatusFilter('');
    setEmailStatusFilter('');
    setStartDate('');
    setEndDate('');
    setPendingPage(1);
    setProcessedPage(1);
  };

  const fetchPendingReports = async (page = pendingPage, limit = pendingLimit) => {
    try {
      setLoadingPending(true);
      const qs = buildQueryParams('pending', page, limit);
      const res = await api.get(`/reports/pending-review?${qs}`);
      const list = res.data?.data || [];
      setPendingReports(list);
      if (res.data?.pagination) {
        setPendingTotal(res.data.pagination.total ?? list.length);
        setPendingTotalPages(res.data.pagination.totalPages ?? 1);
      } else {
        setPendingTotal(list.length);
        setPendingTotalPages(1);
      }

      const initialExpanded: Record<string, boolean> = {};
      list.forEach((r: ReportItem, index: number) => {
        if (index === 0) initialExpanded[r.id] = true;
      });
      setExpandedReports((prev) => ({ ...initialExpanded, ...prev }));
    } catch (err: any) {
      console.error('Erro ao carregar laudos pendentes de revisão:', err);
      toast.error(err.response?.data?.error || 'Erro ao carregar fila de revisão de laudos.');
    } finally {
      setLoadingPending(false);
    }
  };

  const fetchProcessedReports = async (page = processedPage, limit = processedLimit) => {
    try {
      setLoadingProcessed(true);
      const qs = buildQueryParams('processed', page, limit);
      const res = await api.get(`/reports/processed-review?${qs}`);
      const list = res.data?.data || [];
      setProcessedReports(list);
      if (res.data?.pagination) {
        setProcessedTotal(res.data.pagination.total ?? list.length);
        setProcessedTotalPages(res.data.pagination.totalPages ?? 1);
      } else {
        setProcessedTotal(list.length);
        setProcessedTotalPages(1);
      }
    } catch (err: any) {
      console.error('Erro ao carregar laudos processados:', err);
      toast.error(err.response?.data?.error || 'Erro ao carregar histórico de laudos processados.');
    } finally {
      setLoadingProcessed(false);
    }
  };

  useEffect(() => {
    fetchPendingReports(pendingPage, pendingLimit);
  }, [pendingPage, pendingLimit, debouncedSearch, selectedClientId, verdictFilter, severityFilter, startDate, endDate]);

  useEffect(() => {
    fetchProcessedReports(processedPage, processedLimit);
  }, [
    processedPage,
    processedLimit,
    debouncedSearch,
    selectedClientId,
    verdictFilter,
    severityFilter,
    reviewStatusFilter,
    emailStatusFilter,
    startDate,
    endDate,
  ]);

  const toggleExpand = (id: string) => {
    setExpandedReports((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCheckboxChange = (id: string, checked: boolean) => {
    setCheckedAgreements((prev) => ({ ...prev, [id]: checked }));
  };

  const handleNotesChange = (id: string, text: string) => {
    setAuditorNotes((prev) => ({ ...prev, [id]: text }));
  };

  const handleConfirmAndSend = async (report: ReportItem) => {
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

      // Atualiza ambas as listas
      fetchPendingReports();
      fetchProcessedReports();
    } catch (err: any) {
      console.error('Erro ao confirmar laudo e enviar e-mail:', err);
      toast.error(err.response?.data?.error || 'Falha ao confirmar o laudo e enviar e-mail.');
    } finally {
      setSubmittingId(null);
    }
  };

  const handleOpenRejectModal = (report: ReportItem) => {
    setReportToReject(report);
    setRejectionReason(auditorNotes[report.id] || '');
    setRejectModalOpen(true);
  };

  const handleCloseRejectModal = () => {
    if (isRejecting) return;
    setRejectModalOpen(false);
    setReportToReject(null);
    setRejectionReason('');
  };

  const handleConfirmReject = async () => {
    if (!reportToReject) return;

    try {
      setIsRejecting(true);
      const notes = rejectionReason.trim() || 'Laudo recusado pelo auditor responsável.';

      await api.post(`/reports/${reportToReject.id}/confirm-and-send`, {
        confirmed: true,
        decision: 'REJECTED',
        notes,
      });

      toast.success(
        'Laudo recusado com sucesso. Ele foi movido para a tela de Laudos Processados e nenhum e-mail foi disparado para a clínica.'
      );

      handleCloseRejectModal();
      fetchPendingReports();
      fetchProcessedReports();
    } catch (err: any) {
      console.error('Erro ao recusar laudo:', err);
      toast.error(err.response?.data?.error || 'Falha ao processar a recusa do laudo.');
    } finally {
      setIsRejecting(false);
    }
  };

  const handleResendEmail = async (reportId: string) => {
    try {
      setResendingEmailId(reportId);
      const res = await api.post(`/reports/${reportId}/notify`);
      toast.success(res.data?.message || 'E-mail reenviado com sucesso para a clínica.');
      fetchProcessedReports();
    } catch (err: any) {
      console.error('Erro ao reenviar e-mail do laudo:', err);
      toast.error(err.response?.data?.error || 'Falha ao reenviar notificação por e-mail.');
    } finally {
      setResendingEmailId(null);
    }
  };

  const handleDownloadMarkdown = async (reportId: string) => {
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
      toast.success('Download do laudo executivo iniciado.');
    } catch (err: any) {
      toast.error('Erro ao baixar documento do laudo.');
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

  const getSeverityBadge = (severity?: string) => {
    const normalized = (severity || 'MEDIA').toUpperCase();
    switch (normalized) {
      case 'CRITICA':
        return (
          <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-950/90 text-rose-300 border border-rose-700/80">
            Severidade Crítica
          </span>
        );
      case 'GRAVE':
      case 'ALTA':
        return (
          <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-orange-950/90 text-orange-300 border border-orange-700/80">
            Severidade Grave
          </span>
        );
      case 'MEDIA':
        return (
          <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-700/80">
            Severidade Média
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-950/90 text-blue-300 border border-blue-700/80">
            Severidade Leve
          </span>
        );
    }
  };

  const renderViolationCard = (
    v: NonNullable<ReportItem['violations']>[number],
    idx: number
  ) => {
    const normCode = v.normCode || 'Normativo Vigente';
    const normArticle = v.normArticle || 'Dispositivo Geral';
    const validityLabel = v.validityStatus || (v.sourceVersion ? `VIGENTE (${v.sourceVersion})` : 'VIGENTE');
    const isRevoked = validityLabel.toUpperCase().includes('REVOGADA');
    const requiresReview =
      v.requiresHumanReview ?? (v.severity === 'CRITICA' || v.severity === 'GRAVE');
    const hasDistinctDescription =
      v.description &&
      v.description.trim().length > 0 &&
      !v.description.toLowerCase().endsWith(': inadequação detectada');

    return (
      <div
        key={v.id || idx}
        className="p-4 rounded-xl bg-[#080f24] border border-slate-800/90 text-xs space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-cyan-300">
              {idx + 1}. {normCode} — {normArticle}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                isRevoked
                  ? 'bg-rose-950/60 text-rose-300 border-rose-800/70'
                  : 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60'
              }`}
            >
              {validityLabel}
            </span>
            {v.resolved && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Regularizado
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {requiresReview && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                <UserCheck className="w-3 h-3" />
                <span>Revisão Humana</span>
              </span>
            )}
            {getSeverityBadge(v.severity)}
          </div>
        </div>

        {hasDistinctDescription && (
          <p className="text-slate-300 leading-relaxed">
            <strong className="text-slate-200">Enquadramento Regulatório:</strong> {v.description}
          </p>
        )}

        <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800/90 space-y-1">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">
            Trecho de Evidência no Canal Auditado
          </span>
          {v.detectedText ? (
            <p className="text-slate-200 italic leading-relaxed">"{v.detectedText}"</p>
          ) : (
            <p className="text-slate-500 italic">
              Trecho literal não destacado individualmente — conferir evidência integral na URL auditada.
            </p>
          )}
        </div>

        <div className="pt-0.5">
          <p className="text-slate-200 leading-relaxed">
            <strong className="text-cyan-400">Recomendação Deontológica Corretiva:</strong>{' '}
            {v.correctiveAdvice ||
              'Adequar a comunicação institucional em estrita conformidade com o dispositivo normativo citado.'}
          </p>
        </div>
      </div>
    );
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
                <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-700/60 inline-flex items-center gap-1">
                  HITL • CFM
                  <InfoTooltip
                    title={METRIC_GLOSSARY.auditorReviewHITL.title}
                    content={METRIC_GLOSSARY.auditorReviewHITL.description}
                  />
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
            onClick={() => {
              if (activeTab === 'pending') fetchPendingReports();
              else fetchProcessedReports();
            }}
            disabled={loadingPending || loadingProcessed}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 hover:border-slate-600 transition disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loadingPending || loadingProcessed ? 'animate-spin text-cyan-400' : ''}`}
            />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Navegação por Abas (Pendências vs Processados) */}
      <div className="flex items-center gap-3 border-b border-slate-800">
        <button
          onClick={() => setActiveTab('pending')}
          className={`flex items-center gap-2.5 px-4 py-3 text-xs font-bold transition-all relative border-b-2 ${
            activeTab === 'pending'
              ? 'text-cyan-400 border-cyan-400 bg-cyan-950/20'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <Inbox className="w-4 h-4" />
          <span>Pendências de Revisão</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'pending'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {pendingTotal}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('processed')}
          className={`flex items-center gap-2.5 px-4 py-3 text-xs font-bold transition-all relative border-b-2 ${
            activeTab === 'processed'
              ? 'text-cyan-400 border-cyan-400 bg-cyan-950/20'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Laudos Processados</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'processed'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {processedTotal}
          </span>
        </button>
      </div>

      {/* Barra de Filtros Dinâmicos */}
      <div className="p-4 rounded-2xl bg-[#0b1329] border border-slate-800/90 space-y-3 shadow-md shadow-black/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <span>Filtros de Auditoria & Homologação</span>
            {hasActiveFilters && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-700/60">
                Filtros ativos
              </span>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-300 bg-rose-950/30 hover:bg-rose-900/50 border border-rose-800/50 transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Limpar filtros</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Busca livre */}
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por clínica, CRM, e-mail, URL auditada ou auditor..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filtro por Clínica */}
          <select
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setPendingPage(1);
              setProcessedPage(1);
            }}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
          >
            <option value="">Todas as clínicas</option>
            {clientsList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.tradeName || c.name}
              </option>
            ))}
          </select>

          {/* Filtro por Veredito Semáforo */}
          <select
            value={verdictFilter}
            onChange={(e) => {
              setVerdictFilter(e.target.value);
              setPendingPage(1);
              setProcessedPage(1);
            }}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
          >
            <option value="">Todos os vereditos</option>
            <option value="CONFORME">Conforme</option>
            <option value="PARCIALMENTE_CONFORME">Parcialmente Conforme</option>
            <option value="NAO_CONFORME">Não Conforme</option>
            <option value="INCONCLUSIVO">Inconclusivo</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Filtro por Severidade de Apontamento */}
          <select
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPendingPage(1);
              setProcessedPage(1);
            }}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
          >
            <option value="">Todas as severidades</option>
            <option value="CRITICA">Severidade Crítica</option>
            <option value="GRAVE">Severidade Grave</option>
            <option value="MEDIA">Severidade Média</option>
            <option value="LEVE">Severidade Leve</option>
          </select>

          {/* Filtros exclusivos da aba de Laudos Processados */}
          {activeTab === 'processed' && (
            <>
              <select
                value={reviewStatusFilter}
                onChange={(e) => {
                  setReviewStatusFilter(e.target.value);
                  setProcessedPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value="">Todas as decisões</option>
                <option value="APPROVED">Homologados (Aprovados)</option>
                <option value="REJECTED">Recusados pelo Auditor</option>
                <option value="CHANGES_REQUESTED">Ajustes Solicitados</option>
              </select>

              <select
                value={emailStatusFilter}
                onChange={(e) => {
                  setEmailStatusFilter(e.target.value);
                  setProcessedPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value="">Status do e-mail (Todos)</option>
                <option value="SENT">E-mail Enviado</option>
                <option value="PENDING">E-mail Pendente</option>
              </select>
            </>
          )}

          {/* Data Inicial */}
          <div className="relative flex items-center">
            <Calendar className="w-3.5 h-3.5 text-slate-500 absolute left-3 pointer-events-none" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPendingPage(1);
                setProcessedPage(1);
              }}
              title="Data inicial"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          {/* Data Final */}
          <div className="relative flex items-center">
            <Calendar className="w-3.5 h-3.5 text-slate-500 absolute left-3 pointer-events-none" />
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPendingPage(1);
                setProcessedPage(1);
              }}
              title="Data final"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
            />
          </div>
        </div>
      </div>

      {/* Alerta de Governança */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/30 via-cyan-950/20 to-slate-900 border border-cyan-800/30 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 space-y-1">
          <p className="font-bold text-cyan-200">
            {activeTab === 'pending'
              ? 'Governança Deontológica Human-in-the-Loop (CFM 2.336/23 & ISO/IEC 42001)'
              : 'Histórico de Homologações & Trilhas Forenses'}
          </p>
          <p className="text-slate-400 leading-relaxed">
            {activeTab === 'pending'
              ? 'Os laudos gerados pela IA não são enviados diretamente aos clientes. Como auditor responsável, confira os achados, as evidências extraídas do canal digital e marque o checkbox de confirmação para homologar o parecer e autorizar o envio eletrônico à diretoria médica.'
              : 'Visualização dos laudos já auditados e liberados por auditores humanos, com controle do status de envio de e-mails, parecer registrado e opção de reenvio manual ou download do documento.'}
          </p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ABA 1: PENDÊNCIAS DE REVISÃO                                 */}
      {/* ============================================================ */}
      {activeTab === 'pending' && (
        <>
          {loadingPending ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="text-sm font-medium">Buscando laudos pendentes de homologação...</p>
            </div>
          ) : pendingReports.length === 0 ? (
            <div className="text-center py-16 px-4 bg-[#0b1329] border border-slate-800/80 rounded-2xl space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-950/40 border border-emerald-800/50 flex items-center justify-center text-emerald-400">
                <CheckCircle className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-200">
                {hasActiveFilters
                  ? 'Nenhum laudo pendente encontrado para os filtros aplicados'
                  : 'Nenhum laudo pendente de revisão'}
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {hasActiveFilters
                  ? 'Ajuste ou limpe os filtros selecionados para visualizar outros laudos aguardando homologação.'
                  : 'Todas as auditorias geradas pela IA já foram homologadas e devidamente notificadas às clínicas clientes. Novas auditorias concluídas aparecerão aqui automaticamente.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/60 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Limpar filtros</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {pendingReports.map((report) => {
                const isExpanded = !!expandedReports[report.id];
                const isChecked = !!checkedAgreements[report.id];
                const isSubmitting = submittingId === report.id;
                const violations = report.violations || [];
                const clientName = report.client?.tradeName || report.client?.name || 'Clínica Médica';
                const techResp = report.client?.crmResponsavel
                  ? `CRM/${report.client.crmUf || '-'} ${report.client.crmResponsavel}`
                  : 'Não informado';
                const clientEmail =
                  report.client?.email || (report.client?.users?.[0]?.email ?? 'Sem e-mail cadastrado');

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
                          <span className="text-xs px-2 py-0.5 rounded-md font-mono bg-slate-800/90 text-slate-300 border border-slate-700/60 inline-flex items-center gap-1">
                            Score: {report.score ?? 0}/100
                            <InfoTooltip
                              title={METRIC_GLOSSARY.deontologicalScore.title}
                              content={METRIC_GLOSSARY.deontologicalScore.description}
                            />
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

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenRejectModal(report)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border border-rose-800/70 transition"
                          title="Recusar laudo (arquiva sem enviar e-mail)"
                        >
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                          <span>Recusar</span>
                        </button>
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
                          <p className="leading-relaxed text-slate-300">
                            {report.summary || 'Sem resumo executivo disponível.'}
                          </p>
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
                              {violations.map((v, idx) => renderViolationCard(v, idx))}
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

                          {/* Botões de Ação: Recusar Laudo vs Confirmar e Enviar */}
                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
                            <button
                              type="button"
                              onClick={() => handleOpenRejectModal(report)}
                              disabled={isSubmitting}
                              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/80 shadow-md shadow-rose-950/30 transition disabled:opacity-40"
                              title="Recusar laudo: ele será movido para os processados e nenhum e-mail será disparado"
                            >
                              <XCircle className="w-4 h-4 text-rose-400" />
                              <span>Recusar Laudo</span>
                            </button>

                            <button
                              type="button"
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

              <Pagination
                currentPage={pendingPage}
                totalPages={pendingTotalPages}
                totalItems={pendingTotal}
                itemsPerPage={pendingLimit}
                onPageChange={setPendingPage}
                onLimitChange={setPendingLimit}
                itemLabel="laudos pendentes"
              />
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/* ABA 2: LAUDOS PROCESSADOS                                    */}
      {/* ============================================================ */}
      {activeTab === 'processed' && (
        <>
          {loadingProcessed ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="text-sm font-medium">Carregando histórico de laudos processados...</p>
            </div>
          ) : processedReports.length === 0 ? (
            <div className="text-center py-16 px-4 bg-[#0b1329] border border-slate-800/80 rounded-2xl space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-400">
                <History className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-200">
                {hasActiveFilters
                  ? 'Nenhum laudo processado encontrado para os filtros aplicados'
                  : 'Nenhum laudo processado até o momento'}
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {hasActiveFilters
                  ? 'Ajuste ou limpe os critérios de filtro para visualizar outros registros no histórico de homologações.'
                  : 'Os laudos homologados pelos auditores na aba de Pendências aparecerão aqui com os registros forenses de aprovação e telemetria de e-mail.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/60 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Limpar filtros</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {processedReports.map((report) => {
                const isExpanded = !!expandedReports[report.id];
                const violations = report.violations || [];
                const clientName = report.client?.tradeName || report.client?.name || 'Clínica Médica';
                const clientEmail =
                  report.client?.email || (report.client?.users?.[0]?.email ?? 'Sem e-mail cadastrado');
                const isResending = resendingEmailId === report.id;

                return (
                  <div
                    key={report.id}
                    className="bg-[#0b1329] border border-slate-800/90 rounded-2xl overflow-hidden shadow-lg shadow-black/20"
                  >
                    {/* Cabeçalho do Card Processado */}
                    <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/60 bg-[#080f24]/50">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                            <Building className="w-4 h-4 text-cyan-400" />
                            {clientName}
                          </h3>
                          {getVerdictBadge(report.verdict)}
                          <span className="text-xs px-2 py-0.5 rounded-md font-mono bg-slate-800/90 text-slate-300 border border-slate-700/60 inline-flex items-center gap-1">
                            Score: {report.score ?? 0}/100
                            <InfoTooltip
                              title={METRIC_GLOSSARY.deontologicalScore.title}
                              content={METRIC_GLOSSARY.deontologicalScore.description}
                            />
                          </span>
                          {report.reviewStatus === 'REJECTED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/60 text-rose-400 border border-rose-800/60">
                              <XCircle className="w-3.5 h-3.5" />
                              Recusado por Auditor
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                              <CheckCheck className="w-3.5 h-3.5" />
                              Homologado por Auditor
                            </span>
                          )}
                          {report.reviewStatus === 'REJECTED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                              <MailX className="w-3 h-3 text-rose-400" />
                              E-mail Não Enviado (Recusado)
                            </span>
                          ) : report.emailSent ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-950/60 text-cyan-400 border border-cyan-800/60">
                              <Mail className="w-3 h-3" />
                              E-mail Enviado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/60 text-amber-400 border border-amber-800/60">
                              <Mail className="w-3 h-3" />
                              E-mail Pendente
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span>
                            <strong className="text-slate-300">Auditor:</strong> {report.reviewedBy || 'Auditor'}
                          </span>
                          <span>
                            <strong className="text-slate-300">
                              {report.reviewStatus === 'REJECTED' ? 'Recusado em:' : 'Homologado em:'}
                            </strong>{' '}
                            {formatDateTime(report.reviewedAt || report.updatedAt)}
                          </span>
                          <span>
                            <strong className="text-slate-300">Destinatário:</strong> {clientEmail}
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

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownloadMarkdown(report.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-750 border border-slate-700/80 transition"
                          title="Baixar Laudo Técnico em Markdown"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>
                        {report.reviewStatus !== 'REJECTED' && (
                          <button
                            onClick={() => handleResendEmail(report.id)}
                            disabled={isResending}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 border border-cyan-800/60 transition disabled:opacity-50"
                            title="Reenviar E-mail Oficial para a Clínica"
                          >
                            <Send className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
                            <span>Reenviar E-mail</span>
                          </button>
                        )}
                        <button
                          onClick={() => toggleExpand(report.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-750 border border-slate-700/80 transition"
                        >
                          <span>{isExpanded ? 'Ocultar' : 'Detalhes'}</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Detalhes Expansíveis do Laudo Processado */}
                    {isExpanded && (
                      <div className="p-5 space-y-5 bg-[#080e22]/40">
                        {/* Parecer do Auditor */}
                        {report.auditorNotes && (
                          <div
                            className={`p-4 rounded-xl border text-xs space-y-1 ${
                              report.reviewStatus === 'REJECTED'
                                ? 'bg-rose-950/20 border-rose-800/40'
                                : 'bg-cyan-950/20 border-cyan-800/40'
                            }`}
                          >
                            <div
                              className={`flex items-center gap-2 font-bold ${
                                report.reviewStatus === 'REJECTED' ? 'text-rose-300' : 'text-cyan-300'
                              }`}
                            >
                              {report.reviewStatus === 'REJECTED' ? (
                                <XCircle className="w-4 h-4 text-rose-400" />
                              ) : (
                                <UserCheck className="w-4 h-4 text-cyan-400" />
                              )}
                              <span>
                                {report.reviewStatus === 'REJECTED'
                                  ? 'Motivo da Recusa pelo Auditor Responsável:'
                                  : 'Parecer Técnico do Auditor Responsável:'}
                              </span>
                            </div>
                            <p className="text-slate-200 leading-relaxed italic">"{report.auditorNotes}"</p>
                          </div>
                        )}

                        {/* Resumo da IA */}
                        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                          <div className="flex items-center gap-2 font-bold text-slate-200">
                            <FileText className="w-4 h-4 text-cyan-400" />
                            <span>Resumo Executivo do Laudo</span>
                          </div>
                          <p className="leading-relaxed text-slate-300">
                            {report.summary || 'Sem resumo executivo disponível.'}
                          </p>
                        </div>

                        {/* Violações e Achados */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                            Apontamentos Deontológicos ({violations.length})
                          </h4>

                          {violations.length === 0 ? (
                            <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                              <span>Nenhuma infração identificada. Laudo em total conformidade.</span>
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              {violations.map((v, idx) => renderViolationCard(v, idx))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <Pagination
                currentPage={processedPage}
                totalPages={processedTotalPages}
                totalItems={processedTotal}
                itemsPerPage={processedLimit}
                onPageChange={setProcessedPage}
                onLimitChange={setProcessedLimit}
                itemLabel="laudos processados"
              />
            </div>
          )}
        </>
      )}

      {/* Modal de Recusa de Laudo */}
      {rejectModalOpen && reportToReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#0b1329] border border-rose-800/70 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl shadow-rose-950/50">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-700/60 text-rose-400">
                  <XCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-100">Recusar Laudo de Auditoria</h3>
                  <p className="text-xs text-rose-300/80">O laudo será arquivado sem envio de e-mail</p>
                </div>
              </div>
              <button
                onClick={handleCloseRejectModal}
                disabled={isRejecting}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1.5">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-medium text-slate-400">Clínica:</span>
                <span className="font-bold text-slate-100">
                  {reportToReject.client?.tradeName || reportToReject.client?.name || 'Clínica Médica'}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-medium text-slate-400">Destinatário:</span>
                <span className="text-slate-200">
                  {reportToReject.client?.email || reportToReject.client?.users?.[0]?.email || 'Sem e-mail'}
                </span>
              </div>
              {reportToReject.targetUrl && (
                <div className="flex items-center justify-between text-slate-300 truncate">
                  <span className="font-medium text-slate-400 mr-2 flex-shrink-0">URL:</span>
                  <span className="text-cyan-400 truncate text-[11px]">{reportToReject.targetUrl}</span>
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-200 flex items-start gap-2.5 leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Atenção:</strong> Ao confirmar a recusa, este laudo será movido para a tela de{' '}
                <strong>Laudos Processados</strong> com status de recusado. <strong>Nenhum e-mail será enviado</strong> para a
                clínica ou seus responsáveis.
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">
                Motivo da Recusa / Justificativa Técnica:
              </label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Ex: Falso positivo identificado na promessa de resultado; ou captura incompleta de páginas pelo crawler; solicitar nova auditoria..."
                className="w-full text-xs p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500 transition"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleCloseRejectModal}
                disabled={isRejecting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={isRejecting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-950/50 disabled:opacity-50 transition"
              >
                {isRejecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processando Recusa...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    <span>Confirmar Recusa do Laudo</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
