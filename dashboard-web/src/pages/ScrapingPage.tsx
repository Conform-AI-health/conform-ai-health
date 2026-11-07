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
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';

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
];

export const ScrapingPage: React.FC = () => {
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrapingInProgress, setScrapingInProgress] = useState(false);
  const [selectedTagFilter, setSelectedTagFilter] = useState('');

  // Formulário de Varredura (100% autônomo, sem amarração a clínica)
  const [url, setUrl] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>(['CFM']);
  const [selectedMode, setSelectedMode] = useState('CHEERIO');

  // Preview de Markdown
  const [previewPage, setPreviewPage] = useState<any>(null);

  // Modal de Agentes Compatíveis com o Contexto da Norma
  const [compatibleModalData, setCompatibleModalData] = useState<any>(null);
  const [loadingCompatible, setLoadingCompatible] = useState(false);

  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPagesCount, setTotalPagesCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

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
    fetchPages(1, pageSize);
  }, [selectedTagFilter]);

  useEffect(() => {
    fetchPages(currentPage, pageSize);
  }, [currentPage, pageSize]);

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const isGitHubDirectory = url.includes('github.com') && url.includes('/tree/');

  const handleScrapeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setScrapingInProgress(true);
      const res = await api.post('/scraped-pages/scrape', {
        url,
        mode: selectedMode,
        customTags: selectedTags,
      });

      if (res.data?.isBatch) {
        alert(`🎉 Varredura em lote concluída com sucesso!\n\n${res.data.totalIndexed} normas/documentos foram baixados do diretório e salvos individualmente no MongoDB Atlas.`);
      } else {
        alert(`Norma/Página indexada com sucesso! Tags atribuídas: [${res.data?.page?.tags?.join(', ')}]`);
      }

      setUrl('');
      fetchPages();
    } catch (err: any) {
      alert(`Falha ao varrer página: ${err.response?.data?.error || err.message}`);
    } finally {
      setScrapingInProgress(false);
    }
  };

  const handleDeletePage = async (id: string) => {
    if (!window.confirm('Deseja excluir esta norma/página raspada da base de dados?')) return;
    try {
      await api.delete(`/scraped-pages/${id}`);
      fetchPages();
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

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Globe className="h-7 w-7 text-emerald-400" />
            <span>Repositório de Normas Web & Tagging Regulatória</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Varra resoluções e páginas da web, indexe com tags no MongoDB (CFM, LGPD, ANVISA, ANS) para alimentar o contexto dos agentes.
          </p>
        </div>

        <button
          onClick={() => fetchPages()}
          disabled={loading}
          className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition flex items-center gap-2 self-start md:self-auto text-xs font-semibold"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar Base de Normas</span>
        </button>
      </div>

      {/* Formulário de Ingestão de Normas (Sem amarração a clínica) */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-emerald-400" />
          <h2 className="text-base font-bold text-white">
            Varrer e Indexar Norma/Página Regulatório no MongoDB
          </h2>
        </div>

        <form onSubmit={handleScrapeSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>URL da Norma, Resolução ou Diretório de Normas Oficial *</span>
              {isGitHubDirectory && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-950/70 border border-amber-800/50 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                  <span>📂</span>
                  <span>Diretório / Varredura em Lote Detectada</span>
                </span>
              )}
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Ex: https://github.com/md-augustolinhares/cfm-normas/tree/main/normas/resolucoes/1957"
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1">
              <span>💡</span>
              <span>
                Suporta páginas avulsas ou <strong>diretórios/árvores do GitHub</strong> (ex: <code className="text-emerald-400">.../tree/main/normas/...</code>) para baixar e indexar todos os arquivos como documentos individuais no MongoDB.
              </span>
            </p>
          </div>

          {/* Seleção de Tags Regulatórias */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Tags Temáticas Regulatórias para Indexação na Base de Conhecimento:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {REGULATORY_TAG_OPTIONS.map((tag) => {
                const isSelected = selectedTags.includes(tag.id);
                return (
                  <div
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition select-none flex flex-col justify-between ${
                      isSelected
                        ? 'bg-slate-900 border-emerald-500 shadow-sm'
                        : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold flex items-center gap-1.5 text-white">
                          <span>{tag.icon}</span>
                          <span>{tag.id}</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                        {tag.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Modo Extrator:</span>
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-white font-mono"
              >
                <option value="CHEERIO">CHEERIO (Rápido)</option>
                <option value="PUPPETEER">PUPPETEER (SPA Dinâmica)</option>
                <option value="FIRECRAWL">FIRECRAWL (API)</option>
                <option value="MCP">MCP</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={scrapingInProgress}
              className="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-semibold text-xs py-2.5 px-6 rounded-xl shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {scrapingInProgress ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              ) : (
                <>
                  <Globe className="h-4 w-4" />
                  <span>Varrer, Taguear & Salvar no MongoDB</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Repositório de Normas e Páginas no MongoDB */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileCode className="h-5 w-5 text-emerald-400" />
              <span>Base de Normas e Páginas Indexadas no MongoDB ({pages.length})</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Normas estruturadas com tags regulatórias para consulta e validação de contexto pelos agentes
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Filtrar por Tag:</span>
            <select
              value={selectedTagFilter}
              onChange={(e) => setSelectedTagFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">Todas as Tags</option>
              <option value="CFM">🩺 CFM (Médico)</option>
              <option value="LGPD">🔒 LGPD (Dados)</option>
              <option value="ANVISA">💊 ANVISA (Sanitário)</option>
              <option value="ANS">🏥 ANS (Saúde Suplementar)</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/60">
              <tr>
                <th className="py-3.5 px-4">Título da Norma / Página</th>
                <th className="py-3.5 px-4">URL Oficial</th>
                <th className="py-3.5 px-4">Tags Regulatórias</th>
                <th className="py-3.5 px-4">Tokens Markdown</th>
                <th className="py-3.5 px-4">Data Indexação</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Carregando normas da base...
                  </td>
                </tr>
              ) : pages.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Nenhuma norma ou página indexada ainda. Insira uma URL acima para enriquecer a base de conhecimento!
                  </td>
                </tr>
              ) : (
                pages.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-900/50 transition">
                    <td className="py-3.5 px-4 font-semibold text-white">
                      {p.title}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300 max-w-[240px] truncate">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-emerald-400 inline-flex items-center gap-1"
                      >
                        <span className="truncate">{p.url}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
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
                      {new Date(p.createdAt).toLocaleDateString('pt-BR')}
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
                        className="p-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-400 border border-emerald-800/40 rounded-lg transition inline-flex items-center gap-1 text-[11px] font-semibold"
                        title="Ver agentes com contexto compatível com esta norma"
                      >
                        <Play className="h-3 w-3 fill-emerald-400" />
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
        </div>

        {/* Paginação de Páginas Regulatórias */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalPagesCount}
          itemsPerPage={pageSize}
          onPageChange={(p) => setCurrentPage(p)}
          onLimitChange={(l) => setPageSize(l)}
          limitOptions={[5, 10, 20, 50]}
          itemLabel="normas e páginas"
        />
      </div>

      {/* Modal Preview do Markdown Limpo */}
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
