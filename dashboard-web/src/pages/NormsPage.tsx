import React, { useState, useEffect } from 'react';
import { BookOpen, ShieldAlert, CheckCircle, Search, Stethoscope } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

export const NormsPage: React.FC = () => {
  const { user } = useAuth();
  const [norms, setNorms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const isClient = user?.role === 'CLIENT';

  const fetchNorms = async () => {
    try {
      setLoading(true);
      if (isClient) {
        const res = await api.get('/norms/customer-rules');
        setNorms(res.data?.rules || []);
      } else {
        const res = await api.get('/norms/catalog');
        setNorms(res.data?.norms || []);
      }
    } catch (err) {
      console.error('Erro ao buscar catálogo de normas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNorms();
  }, [isClient]);

  const filteredNorms = norms.filter((norm) => {
    const matchesSearch =
      norm.title.toLowerCase().includes(search.toLowerCase()) ||
      norm.content.toLowerCase().includes(search.toLowerCase()) ||
      norm.normCode.toLowerCase().includes(search.toLowerCase());

    const matchesSource = !sourceFilter || norm.source === sourceFilter;
    return matchesSearch && matchesSource;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <BookOpen className="h-7 w-7 text-emerald-400" />
            <span>Catálogo Normativo & Deontologia em Saúde</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Artigos e diretrizes estruturadas: Resolução CFM nº, ANS RN 509/395, ANVISA e LGPD Art. 11.
          </p>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-3">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="">Todas as fontes</option>
            <option value="CFM">CFM (Deontologia Médica)</option>
            <option value="LGPD">LGPD (Dados Sensíveis)</option>
            <option value="ANS">ANS (Saúde Suplementar)</option>
            <option value="ANVISA">ANVISA (Vigilância Sanitária)</option>
          </select>
        </div>
      </div>

      {/* Busca */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-xl p-3 flex items-center">
        <Search className="h-4 w-4 text-slate-500 ml-2 mr-3" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar por artigo, proibição, RQE, antes/depois ou termo regulatório..."
          className="bg-transparent border-none text-xs text-slate-100 placeholder-slate-500 w-full focus:outline-none"
        />
      </div>

      {/* Lista de Normas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {loading ? (
          <div className="col-span-2 py-12 text-center text-xs text-slate-500">
            Carregando catálogo de dispositivos legais...
          </div>
        ) : filteredNorms.length === 0 ? (
          <div className="col-span-2 py-12 text-center text-xs text-slate-500">
            Nenhuma diretriz encontrada para a pesquisa.
          </div>
        ) : (
          filteredNorms.map((n) => {
            const severityColor =
              n.severityDefault === 'CRITICA'
                ? 'text-red-400 bg-red-950/30 border-red-800/40'
                : n.severityDefault === 'GRAVE'
                ? 'text-orange-400 bg-orange-950/30 border-orange-800/40'
                : 'text-amber-400 bg-amber-950/30 border-amber-800/40';

            return (
              <div
                key={n.id}
                className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg hover:border-slate-700 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {n.normCode} — {n.article}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${severityColor}`}>
                      {n.severityDefault}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white mb-2">{n.title}</h3>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3.5 rounded-xl border border-slate-800/80 mb-3">
                    {n.content}
                  </p>

                  <div className="text-xs text-emerald-400/90 font-medium">
                    <span className="text-slate-400 font-semibold block text-[11px] uppercase tracking-wider mb-0.5">
                      Diretriz Prática Recomendada:
                    </span>
                    {n.correctiveGuidance}
                  </div>
                </div>

                {isClient && n.totalOccurrences !== undefined && (
                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Ocorrências em sua clínica:</span>
                    <span
                      className={`font-bold ${
                        n.unresolvedOccurrences > 0 ? 'text-red-400' : 'text-emerald-400'
                      }`}
                    >
                      {n.unresolvedOccurrences} ativa(s) / {n.totalOccurrences} total
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

