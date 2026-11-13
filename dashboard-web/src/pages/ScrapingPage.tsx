import React, { useState, useEffect } from 'react';
import {
  Globe,
  Tag,
  Search,
  Sparkles,
  ExternalLink,
  Play,
  Trash2,
  Eye,
  X,
  FileCode,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Upload,
  FileUp,
  Database,
  Layers,
  BookOpen,
  Cpu,
  FileText,
  Binary,
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';
import { useToast } from '../context/ToastContext';
import { safeHttpUrl } from '../utils/urlSecurity';

const REGULATORY_TAG_OPTIONS = [
  {
    id: 'CFM',
    label: 'CFM (Deontologia Médica)',
    description: 'CRM, RQE, publicidade médica, promessa de resultado, antes e depois.',
    badgeClass: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40',
    icon: '🩺',
  },
  {
    id: 'LGPD',
    label: 'LGPD (Proteção de Dados)',
    description: 'Formulários online, dados de saúde, consentimento e privacidade.',
    badgeClass: 'bg-blue-950/50 text-blue-400 border-blue-800/40',
    icon: '🔒',
  },
  {
    id: 'ANVISA',
    label: 'ANVISA (Vigilância Sanitária)',
    description: 'Medicamentos sob prescrição, toxina botulínica e produtos de saúde.',
    badgeClass: 'bg-purple-950/50 text-purple-400 border-purple-800/40',
    icon: '💊',
  },
  {
    id: 'ANS',
    label: 'ANS (Saúde Suplementar)',
    description: 'Planos de saúde, convênios, carências e rede credenciada.',
    badgeClass: 'bg-amber-950/50 text-amber-400 border-amber-800/40',
    icon: '🏥',
  },
  {
    id: 'REVOGADO',
    label: 'REVOGADO (Sem Vigência)',
    description: 'Resoluções, atos normativos ou leis com revogação expressa identificada.',
    badgeClass: 'bg-rose-950/50 text-rose-400 border-rose-800/40',
    icon: '🚫',
  },
];

export const ScrapingPage: React.FC = () => {
  const toast = useToast();
  // Aba ativa de visualização do repositório
  const [activeTab, setActiveTab] = useState<'norms' | 'scraped_pages'>('norms');

  // Sumário Consolidado de Estatísticas (norms, norms_chunk, scraped_pages)
  const [statsSummary, setStatsSummary] = useState<{
    totalNorms: number;
    totalChunks: number;
    totalScrapedPages: number;
    statusBreakdown: { vigentes: number; revogadas: number };
  } | null>(null);

  // Estado da Coleção 'scraped_pages' (Legado / Páginas Web Avulsas)
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrapingInProgress, setScrapingInProgress] = useState(false);
  const [selectedTagFilter, setSelectedTagFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPagesCount, setTotalPagesCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Estado da Coleção 'norms' (Documentos Mestres Oficiais CFM & RAG)
  const [normsList, setNormsList] = useState<any[]>([]);
  const [normsLoading, setNormsLoading] = useState(false);
  const [normsCurrentPage, setNormsCurrentPage] = useState(1);
  const [normsPageSize, setNormsPageSize] = useState(10);
  const [normsTotalCount, setNormsTotalCount] = useState(0);
  const [normsTotalPages, setNormsTotalPages] = useState(1);
  const [normsSearch, setNormsSearch] = useState('');
  const [normsTipoFilter, setNormsTipoFilter] = useState('');
  const [normsStatusFilter, setNormsStatusFilter] = useState('');

  // Modal de Detalhes da Norma e Chunks RAG
  const [selectedNormModal, setSelectedNormModal] = useState<any>(null);
  const [normChunksLoading, setNormChunksLoading] = useState(false);
  const [normChunksList, setNormChunksList] = useState<any[]>([]);
  const [normModalTab, setNormModalTab] = useState<'ementa' | 'original' | 'higienizado' | 'chunks'>('ementa');

  // Formulário de Varredura e Ingestão
  const [ingestMode, setIngestMode] = useState<'url' | 'upload'>('url');
  const [url, setUrl] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadingInProgress, setUploadingInProgress] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>(['CFM']);
  const [selectedMode, setSelectedMode] = useState('CHEERIO');

  // Preview de Markdown das páginas legadas
  const [previewPage, setPreviewPage] = useState<any>(null);

  // Modal de Agentes Compatíveis com o Contexto da Norma
  const [compatibleModalData, setCompatibleModalData] = useState<any>(null);
  const [loadingCompatible, setLoadingCompatible] = useState(false);

  // Carrega estatísticas consolidadas
  const fetchStats = async () => {
    try {
      const res = await api.get('/norms/stats/summary');
      if (res.data) {
        setStatsSummary(res.data);
      }
    } catch (err) {
      console.warn('Estatísticas de normas indisponíveis no momento:', err);
    }
  };

  // Carrega a coleção 'norms' do MongoDB Atlas
  const fetchNorms = async (page = normsCurrentPage, limit = normsPageSize) => {
    try {
      setNormsLoading(true);
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(limit));
      if (normsSearch) params.append('search', normsSearch);
      if (normsTipoFilter) params.append('tipo', normsTipoFilter);
      if (normsStatusFilter) params.append('status', normsStatusFilter);

      const res = await api.get(`/norms?${params.toString()}`);
      if (res.data?.data && res.data?.pagination) {
        setNormsList(res.data.data);
        setNormsTotalCount(res.data.pagination.total);
        setNormsTotalPages(res.data.pagination.totalPages);
        setNormsCurrentPage(res.data.pagination.page);
      } else {
        setNormsList([]);
        setNormsTotalCount(0);
        setNormsTotalPages(1);
      }
    } catch (err) {
      console.error('Erro ao buscar normas da coleção norms:', err);
    } finally {
      setNormsLoading(false);
    }
  };

  // Carrega a coleção 'scraped_pages' do MongoDB Atlas
  const fetchPages = async (page = currentPage, limit = pageSize) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedTagFilter) params.append('tag', selectedTagFilter);
      params.append('page', String(page));
      params.append('limit', String(limit));

      const res = await api.get(`/scraped-pages?${params.toString()}`);
      if (res.data?.data && res.data?.pagination) {
        setPages(res.data.data);
        setTotalPagesCount(res.data.pagination.total);
        setTotalPages(res.data.pagination.totalPages);
        setCurrentPage(res.data.pagination.page);
      } else if (Array.isArray(res.data)) {
        setPages(res.data);
        setTotalPagesCount(res.data.length);
        setTotalPages(Math.ceil(res.data.length / limit) || 1);
      } else {
        setPages([]);
        setTotalPagesCount(0);
        setTotalPages(1);
      }
    } catch (err) {
      console.error('Erro ao buscar páginas regulatórias:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchNorms(1, normsPageSize);
    fetchPages(1, pageSize);
  }, []);

  useEffect(() => {
    fetchPages(1, pageSize);
  }, [selectedTagFilter]);

  useEffect(() => {
    fetchPages(currentPage, pageSize);
  }, [currentPage, pageSize]);

  useEffect(() => {
    fetchNorms(normsCurrentPage, normsPageSize);
  }, [normsCurrentPage, normsPageSize, normsTipoFilter, normsStatusFilter]);

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const isGitHubDirectory = url.includes('github.com') && url.includes('/tree/');
  const isDouPortal = url.includes('in.gov.br');
  const isPdfLink = /\.pdf($|\?|#)/i.test(url);

  const handleScrapeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setScrapingInProgress(true);
      const res = await api.post('/scraped-pages/scrape', {
        url,
        mode: selectedMode,
        customTags: selectedTags,
      });

      if (res.data?.async || res.data?.isBatch) {
        toast.info(
          res.data?.message ||
            'A varredura foi iniciada em segundo plano. Atualize o acervo após a conclusão.',
          'Varredura em andamento'
        );
      } else {
        toast.success(
          `Norma/Página indexada com sucesso! Tags atribuídas: [${res.data?.page?.tags?.join(', ')}]`
        );
        fetchPages();
        fetchNorms();
        fetchStats();
      }

      setUrl('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Falha ao varrer página');
    } finally {
      setScrapingInProgress(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      alert('Selecione um arquivo PDF, Markdown (.md) ou Texto (.txt) para ingestão.');
      return;
    }

    try {
      setUploadingInProgress(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          const res = await api.post('/scraped-pages/upload', {
            filename: uploadFile.name,
            fileBase64: base64,
            customTags: selectedTags,
          });

          alert(
            `🎉 Arquivo indexado com sucesso no MongoDB!\n\nTítulo: ${res.data?.page?.title}\nTags: [${res.data?.page?.tags?.join(', ')}]\nTokens Estimados: ${res.data?.page?.tokensCount}`
          );
          setUploadFile(null);
          fetchPages();
          fetchStats();
        } catch (err: any) {
          alert(`Falha ao indexar arquivo: ${err.response?.data?.error || err.message}`);
        } finally {
          setUploadingInProgress(false);
        }
      };
      reader.onerror = () => {
        alert('Erro ao ler arquivo no navegador.');
        setUploadingInProgress(false);
      };
      reader.readAsDataURL(uploadFile);
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
      setUploadingInProgress(false);
    }
  };

  const handleDeletePage = async (id: string) => {
    if (!window.confirm('Deseja excluir esta norma/página raspada da base de dados?')) return;
    try {
      await api.delete(`/scraped-pages/${id}`);
      fetchPages();
      fetchStats();
    } catch (err: any) {
      alert(`Erro ao remover: ${err.message}`);
    }
  };

  const handleOpenCompatibleAgents = async (pageId: string) => {
    try {
      setLoadingCompatible(true);
      const res = await api.get(`/scraped-pages/${pageId}/compatible-agents`);
      setCompatibleModalData(res.data);
    } catch (err: any) {
      alert(`Erro ao buscar agentes compatíveis: ${err.message}`);
    } finally {
      setLoadingCompatible(false);
    }
  };

  const handleOpenNormDetails = async (normId: string) => {
    try {
      setNormChunksLoading(true);
      setNormModalTab('ementa');
      const [normRes, chunksRes] = await Promise.all([
        api.get(`/norms/${normId}`),
        api.get(`/norms/${normId}/chunks?limit=50`),
      ]);
      setSelectedNormModal(normRes.data.data);
      setNormChunksList(chunksRes.data.data || []);
    } catch (err: any) {
      alert(`Erro ao carregar detalhes da norma: ${err.message}`);
    } finally {
      setNormChunksLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Globe className="h-7 w-7 text-emerald-400" />
            <span>Repositório de Normas & Persistência Vetorial RAG</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Gestão do acervo normativo oficial (<span className="text-emerald-400 font-mono">norms</span>), fragmentos semânticos (<span className="text-purple-400 font-mono">norms_chunk</span>) e varreduras web (<span className="text-blue-400 font-mono">scraped_pages</span>).
          </p>
        </div>

        <button
          onClick={() => {
            fetchStats();
            if (activeTab === 'norms') fetchNorms();
            else fetchPages();
          }}
          disabled={loading || normsLoading}
          className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition flex items-center gap-2 self-start md:self-auto text-xs font-semibold"
        >
          <RefreshCw className={`h-4 w-4 ${loading || normsLoading ? 'animate-spin' : ''}`} />
          <span>Atualizar Base</span>
        </button>
      </div>

      {/* Cards de Métricas Consolidadas das Coleções do MongoDB */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Coleção 'norms' (CFM / RAG)
              </p>
              <h3 className="text-2xl font-black text-white mt-1">
                {statsSummary?.totalNorms ?? normsTotalCount}
              </h3>
              <p className="text-[11px] text-emerald-400 mt-0.5 flex items-center gap-1 font-medium">
                <CheckCircle2 className="h-3 w-3" />
                <span>
                  {statsSummary?.statusBreakdown?.vigentes ?? 0} vigentes · {statsSummary?.statusBreakdown?.revogadas ?? 0} revogadas
                </span>
              </p>
            </div>
            <div className="p-3 bg-emerald-950/50 border border-emerald-800/40 rounded-xl text-emerald-400">
              <BookOpen className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Coleção 'norms_chunk' (Embeddings)
              </p>
              <h3 className="text-2xl font-black text-purple-300 mt-1">
                {statsSummary?.totalChunks ?? 0}
              </h3>
              <p className="text-[11px] text-purple-400 mt-0.5 flex items-center gap-1 font-medium">
                <Cpu className="h-3 w-3" />
                <span>Vetores 768d normalizados (L2)</span>
              </p>
            </div>
            <div className="p-3 bg-purple-950/50 border border-purple-800/40 rounded-xl text-purple-400">
              <Layers className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Coleção 'scraped_pages' (Web)
              </p>
              <h3 className="text-2xl font-black text-blue-300 mt-1">
                {statsSummary?.totalScrapedPages ?? totalPagesCount}
              </h3>
              <p className="text-[11px] text-blue-400 mt-0.5 flex items-center gap-1 font-medium">
                <Globe className="h-3 w-3" />
                <span>Páginas e arquivos raspados avulsos</span>
              </p>
            </div>
            <div className="p-3 bg-blue-950/50 border border-blue-800/40 rounded-xl text-blue-400">
              <Database className="h-6 w-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Box de Ingestão e Varredura */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Nova Ingestão de Norma ou Varredura Web
            </h2>
          </div>

          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setIngestMode('url')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                ingestMode === 'url'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>Varredura por URL</span>
            </button>
            <button
              type="button"
              onClick={() => setIngestMode('upload')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                ingestMode === 'upload'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload de Arquivo (PDF/MD/TXT)</span>
            </button>
          </div>
        </div>

        <form onSubmit={ingestMode === 'url' ? handleScrapeSubmit : handleUploadSubmit} className="space-y-6">
          {ingestMode === 'url' ? (
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                URL Oficial da Norma ou Portal Regulatório:
              </label>
              <div className="relative">
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Ex: https://sistemas.cfm.org.br/normas/visualizar/resolucoes/2023/2336"
                  className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition font-mono pr-10"
                />
                <Globe className="h-4 w-4 text-slate-500 absolute right-3.5 top-3.5 pointer-events-none" />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                Arquivo de Norma para Ingestão Direta:
              </label>
              <div className="border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-xl p-6 text-center bg-slate-900/40">
                <input
                  type="file"
                  id="file-upload"
                  accept=".pdf,.md,.txt,.markdown"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                  <FileUp className="h-8 w-8 text-emerald-400 mb-2" />
                  <span className="text-xs font-semibold text-white">
                    {uploadFile ? uploadFile.name : 'Clique para selecionar PDF, Markdown (.md) ou Texto (.txt)'}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1">
                    {uploadFile ? `${(uploadFile.size / 1024).toFixed(1)} KB` : 'Suporta extração textual com cálculo de tokens e tags'}
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Seleção de Tags Regulatórias */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-2 flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-emerald-400" />
              <span>Tags Regulatórias Aplicáveis:</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {REGULATORY_TAG_OPTIONS.map((tag) => {
                const isSelected = selectedTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                      isSelected
                        ? `${tag.badgeClass} ring-1 ring-emerald-500/50`
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span className="text-base">{tag.icon}</span>
                    <div>
                      <div className="text-xs font-bold text-white">{tag.label}</div>
                      <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                        {tag.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={scrapingInProgress || uploadingInProgress}
              className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl transition text-xs flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-500/10"
            >
              {scrapingInProgress || uploadingInProgress ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Processando e Indexando...</span>
                </>
              ) : (
                <>
                  {ingestMode === 'url' ? <Globe className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  <span>
                    {ingestMode === 'url'
                      ? 'Varrer, Taguear & Salvar no MongoDB'
                      : 'Processar, Taguear & Salvar no MongoDB'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Navegador do Repositório de Normas com Abas */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
        {/* Header e Seleção de Abas */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800/80">
          <div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('norms')}
                className={`text-sm font-bold pb-1 transition flex items-center gap-2 border-b-2 ${
                  activeTab === 'norms'
                    ? 'border-emerald-400 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="h-4 w-4 text-emerald-400" />
                <span>Acervo de Normas CFM & RAG (`norms`)</span>
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                  {normsTotalCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('scraped_pages')}
                className={`text-sm font-bold pb-1 transition flex items-center gap-2 border-b-2 ${
                  activeTab === 'scraped_pages'
                    ? 'border-blue-400 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe className="h-4 w-4 text-blue-400" />
                <span>Varreduras Web Avulsas (`scraped_pages`)</span>
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-950 text-blue-300 border border-blue-800/40">
                  {totalPagesCount}
                </span>
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {activeTab === 'norms'
                ? 'Normas de todas as tags regulatórias, com documentos mestres em norms e fragmentos vetoriais RAG em norms_chunk.'
                : 'Páginas web avulsas e arquivos indexados diretamente pela interface de scraping.'}
            </p>
          </div>

          {/* Filtros da Aba Ativa */}
          {activeTab === 'norms' ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <input
                  type="text"
                  value={normsSearch}
                  onChange={(e) => setNormsSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchNorms(1, normsPageSize);
                  }}
                  placeholder="Buscar norma, ano ou tema..."
                  className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-8 w-48"
                />
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2" />
              </div>

              <select
                value={normsTipoFilter}
                onChange={(e) => setNormsTipoFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Todos os Tipos</option>
                <option value="RESOLUCAO">Resolução</option>
                <option value="PARECER">Parecer</option>
                <option value="RECOMENDACAO">Recomendação</option>
              </select>

              <select
                value={normsStatusFilter}
                onChange={(e) => setNormsStatusFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Status Vigência</option>
                <option value="VIGENTE">🟢 Vigente</option>
                <option value="REVOGADA">🔴 Revogada</option>
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">Filtrar por Tag:</span>
              <select
                value={selectedTagFilter}
                onChange={(e) => setSelectedTagFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Todas as Tags</option>
                <option value="CFM">🩺 CFM (Médico)</option>
                <option value="LGPD">🔒 LGPD (Dados)</option>
                <option value="ANVISA">💊 ANVISA (Sanitário)</option>
                <option value="ANS">🏥 ANS (Saúde Suplementar)</option>
                <option value="REVOGADO">🚫 REVOGADO (Sem Vigência)</option>
              </select>
            </div>
          )}
        </div>

        {/* TABELA: ABA 'norms' */}
        {activeTab === 'norms' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/60">
                <tr>
                  <th className="py-3.5 px-4">Identificador da Norma</th>
                  <th className="py-3.5 px-4">Tags</th>
                  <th className="py-3.5 px-4">Tipo / Ano</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Ementa Higienizada</th>
                  <th className="py-3.5 px-4">Chunks RAG</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {normsLoading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Carregando acervo de normas da coleção 'norms'...
                    </td>
                  </tr>
                ) : normsList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Nenhuma norma encontrada na coleção 'norms'. Execute a ingestão local das 3.857 normas via script CLI para povoar a base!
                    </td>
                  </tr>
                ) : (
                  normsList.map((norm) => (
                    <tr key={norm.id || norm.normId} className="hover:bg-slate-900/50 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-white">
                        <span className="text-emerald-400">{norm.normId}</span>
                        {norm.idNormaCfm && (
                          <span className="text-[10px] text-slate-500 block">ID CFM: {norm.idNormaCfm}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {norm.tags?.map((tag: string) => (
                            <span
                              key={tag}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                tag === 'RAG_READY'
                                  ? 'bg-purple-950/50 text-purple-300 border-purple-800/40'
                                  : 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {tag === 'RAG_READY' ? 'RAG' : tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-semibold text-slate-300">
                          {norm.tipo} {norm.numero}/{norm.ano}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            norm.status === 'VIGENTE'
                              ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40'
                              : 'bg-rose-950/50 text-rose-400 border-rose-800/40'
                          }`}
                        >
                          {norm.status === 'VIGENTE' ? '🟢 Vigente' : '🔴 Revogada'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 max-w-[320px] text-slate-300">
                        <p className="line-clamp-2 leading-relaxed">
                          {norm.ementaHigienizada || 'Sem ementa cadastrada.'}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-purple-300">
                        <span className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/40 text-[11px] font-semibold inline-flex items-center gap-1">
                          <Layers className="h-3 w-3" />
                          <span>{norm.totalChunks || 0} chunks</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => handleOpenNormDetails(norm.normId)}
                          className="p-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-400 border border-emerald-800/40 rounded-lg transition inline-flex items-center gap-1 text-[11px] font-semibold"
                          title="Inspecionar Norma e Chunks RAG"
                        >
                          <Eye className="h-3 w-3" />
                          <span>Ver Norma & Chunks</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Paginação de Normas */}
            <Pagination
              currentPage={normsCurrentPage}
              totalPages={normsTotalPages}
              totalItems={normsTotalCount}
              itemsPerPage={normsPageSize}
              onPageChange={(p) => setNormsCurrentPage(p)}
              onLimitChange={(l) => setNormsPageSize(l)}
              limitOptions={[5, 10, 20, 50]}
              itemLabel="normas regulatórias"
            />
          </div>
        )}

        {/* TABELA: ABA 'scraped_pages' */}
        {activeTab === 'scraped_pages' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/60">
                <tr>
                  <th className="py-3.5 px-4">Título da Norma / Página</th>
                  <th className="py-3.5 px-4">URL Oficial</th>
                  <th className="py-3.5 px-4">Tags Regulatórias</th>
                  <th className="py-3.5 px-4">Tokens Markdown</th>
                  <th className="py-3.5 px-4">Data de Indexação</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Carregando páginas raspadas...
                    </td>
                  </tr>
                ) : pages.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Nenhuma página web avulsa indexada ainda. Insira uma URL acima para enriquecer a base!
                    </td>
                  </tr>
                ) : (
                  pages.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-900/50 transition">
                      <td className="py-3.5 px-4 font-semibold text-white">
                        {p.title}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300 max-w-[240px] truncate">
                        {(() => {
                          const safeUrl = safeHttpUrl(p.url);
                          if (safeUrl) {
                            return (
                              <a
                                href={safeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-blue-400 inline-flex items-center gap-1"
                              >
                                <span className="truncate">{safeUrl}</span>
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </a>
                            );
                          }
                          return <span className="truncate text-slate-500 italic">{p.url}</span>;
                        })()}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {p.tags?.map((t: string) => {
                            const tagConfig = REGULATORY_TAG_OPTIONS.find((opt) => opt.id === t);
                            return (
                              <span
                                key={t}
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                  tagConfig?.badgeClass || 'bg-slate-800 text-slate-300 border-slate-700'
                                }`}
                              >
                                {tagConfig?.icon} {t}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-purple-300">
                        {p.tokensCount?.toLocaleString('pt-BR')} tokens
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {p.updatedAt || p.createdAt
                          ? new Date(p.updatedAt || p.createdAt).toLocaleString('pt-BR')
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => setPreviewPage(p)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition inline-flex items-center gap-1 text-[11px]"
                          title="Ver Markdown limpo"
                        >
                          <Eye className="h-3 w-3" />
                          <span>Ver Markdown</span>
                        </button>
                        <button
                          onClick={() => handleOpenCompatibleAgents(p.id)}
                          className="p-1.5 bg-blue-950/60 hover:bg-blue-900/60 text-blue-400 border border-blue-800/40 rounded-lg transition inline-flex items-center gap-1 text-[11px] font-semibold"
                          title="Ver agentes com contexto compatível com esta norma"
                        >
                          <Play className="h-3 w-3 fill-blue-400" />
                          <span>Agentes Compatíveis</span>
                        </button>
                        <button
                          onClick={() => handleDeletePage(p.id)}
                          className="p-1.5 text-slate-600 hover:text-red-400 rounded-lg transition"
                          title="Excluir da base"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Paginação de Páginas Regulatórias */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalPagesCount}
              itemsPerPage={pageSize}
              onPageChange={(p) => setCurrentPage(p)}
              onLimitChange={(l) => setPageSize(l)}
              limitOptions={[5, 10, 20, 50]}
              itemLabel="páginas web raspadas"
            />
          </div>
        )}
      </div>

      {/* Modal de Detalhes da Norma e Chunks RAG da Coleção 'norms' */}
      {selectedNormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold text-white">
                    {selectedNormModal.normId}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/40 font-semibold">
                    {selectedNormModal.status}
                  </span>
                </div>
                <span className="text-xs text-slate-400 mt-0.5 block">
                  {selectedNormModal.tipo} {selectedNormModal.numero}/{selectedNormModal.ano} · Publicado em {selectedNormModal.dataPublicacao || 'N/D'}
                </span>
              </div>
              <button
                onClick={() => setSelectedNormModal(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Abas do Modal */}
            <div className="flex items-center gap-2 pt-3 pb-2 border-b border-slate-800/60 text-xs">
              <button
                onClick={() => setNormModalTab('ementa')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  normModalTab === 'ementa'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Ementa & Metadados
              </button>
              <button
                onClick={() => setNormModalTab('chunks')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
                  normModalTab === 'chunks'
                    ? 'bg-purple-950 text-purple-300 border border-purple-800/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Fragmentos RAG ({normChunksList.length} chunks)</span>
              </button>
              <button
                onClick={() => setNormModalTab('higienizado')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  normModalTab === 'higienizado'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Texto Higienizado (Anti-Mojibake)
              </button>
              <button
                onClick={() => setNormModalTab('original')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  normModalTab === 'original'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Texto Bruto Original
              </button>
            </div>

            {/* Conteúdo das Abas do Modal */}
            <div className="mt-4 flex-1 overflow-y-auto space-y-4">
              {normModalTab === 'ementa' && (
                <div className="space-y-4 text-xs">
                  <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Ementa Higienizada:
                    </span>
                    <p className="text-white leading-relaxed text-sm">
                      {selectedNormModal.ementaHigienizada || 'Sem ementa disponível.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Total de Chunks RAG:</span>
                      <span className="text-base font-bold text-purple-300 font-mono">
                        {selectedNormModal.totalChunks}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Tokens Estimados:</span>
                      <span className="text-base font-bold text-white font-mono">
                        {selectedNormModal.tokensEstimados?.toLocaleString('pt-BR')}
                      </span>
                    </div>
                  </div>

                  {selectedNormModal.urlOriginal && (
                    <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800 font-mono text-[11px] truncate">
                      <span className="text-slate-400 block mb-1">URL Oficial CFM:</span>
                      <a
                        href={selectedNormModal.urlOriginal}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:underline inline-flex items-center gap-1"
                      >
                        {selectedNormModal.urlOriginal}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {normModalTab === 'chunks' && (
                <div className="space-y-3">
                  {normChunksLoading ? (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      Carregando fragmentos semânticos com embeddings...
                    </div>
                  ) : normChunksList.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 text-xs">
                      Nenhum chunk particionado encontrado para esta norma.
                    </div>
                  ) : (
                    normChunksList.map((chunk) => (
                      <div
                        key={chunk.id || chunk.chunkIndex}
                        className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-bold text-purple-300">
                            Chunk #{chunk.chunkIndex}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {chunk.tokensEstimados} tokens · Vetor 768d L2
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 leading-relaxed font-sans bg-slate-950 p-2.5 rounded-lg border border-slate-800/60 whitespace-pre-wrap">
                          {chunk.conteudoChunk}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {normModalTab === 'higienizado' && (
                <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-200 max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {selectedNormModal.conteudoHigienizado || selectedNormModal.cleanMarkdown}
                </pre>
              )}

              {normModalTab === 'original' && (
                <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-400 max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {selectedNormModal.conteudoOriginalBruto || 'Conteúdo original bruto indisponível.'}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Preview do Markdown Limpo da Coleção scraped_pages */}
      {previewPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">{previewPage.title}</h3>
                <span className="text-[11px] text-slate-400 font-mono">{previewPage.url}</span>
              </div>
              <button
                onClick={() => setPreviewPage(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-2">
                Markdown Limpo Sanitizado da Norma:
              </span>
              <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 max-h-96 overflow-y-auto whitespace-pre-wrap">
                {previewPage.cleanMarkdown}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Agentes Compatíveis com o Contexto das Tags */}
      {compatibleModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Play className="h-4 w-4 text-emerald-400 fill-emerald-400" />
                  <span>Agentes Compatíveis com o Contexto</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tags desta norma: [{compatibleModalData.pageTags?.join(', ')}]. Agentes cujo contexto abrange essas tags:
                </p>
              </div>
              <button
                onClick={() => setCompatibleModalData(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {compatibleModalData.compatibleAgents?.length === 0 ? (
                <div className="p-6 text-center bg-slate-900/60 rounded-xl border border-slate-800">
                  <AlertCircle className="h-8 w-8 text-amber-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-300">
                    Nenhum agente cadastrado com contexto para as tags [{compatibleModalData.pageTags?.join(', ')}].
                  </p>
                </div>
              ) : (
                compatibleModalData.compatibleAgents?.map((agent: any) => (
                  <div
                    key={agent.id}
                    className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-emerald-400">
                          {agent.code}
                        </span>
                        <span className="text-xs font-semibold text-white">{agent.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-slate-400">Contexto do Agente:</span>
                        {agent.tags?.map((t: string) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.2 rounded bg-slate-800 text-[9px] font-mono text-emerald-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>

                    <span className="text-xs text-emerald-400 font-semibold px-2 py-1 rounded bg-emerald-950/40 border border-emerald-800/30">
                      Contexto Alinhado
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
