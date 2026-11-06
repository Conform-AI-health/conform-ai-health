import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Search,
  ExternalLink,
  Play,
  Filter,
  CheckCircle2,
  Trash2,
  Stethoscope,
} from 'lucide-react';
import { api } from '../services/api';

export const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Formulário de Criação
  const [formData, setFormData] = useState({
    name: '',
    tradeName: '',
    cnpj: '',
    crmResponsavel: '',
    crmUf: 'SP',
    rqeResponsavel: '',
    especialidade: '',
    websiteUrl: '',
    instagramHandle: '',
    email: '',
    phone: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);

      const res = await api.get(`/clients?${params.toString()}`);
      setClients(res.data?.data || []);
    } catch (err) {
      console.error('Erro ao buscar clientes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [search, statusFilter]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await api.post('/clients', formData);
      setShowCreateModal(false);
      setFormData({
        name: '',
        tradeName: '',
        cnpj: '',
        crmResponsavel: '',
        crmUf: 'SP',
        rqeResponsavel: '',
        especialidade: '',
        websiteUrl: '',
        instagramHandle: '',
        email: '',
        phone: '',
      });
      fetchClients();
    } catch (err: any) {
      alert(`Erro ao cadastrar clínica: ${err.response?.data?.error || err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickAudit = async (client: any) => {
    try {
      const modulesRes = await api.get('/agents');
      const firstModule = modulesRes.data?.[0];
      if (!firstModule) return;

      await api.post(`/agents/${firstModule.id}/run`, {
        clientId: client.id,
        targetUrl: client.websiteUrl,
        extractionMode: 'CHEERIO',
      });
      alert(`Auditoria deontológica disparada com sucesso para ${client.name}!`);
    } catch (err: any) {
      alert(`Falha ao disparar auditoria: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Building2 className="h-7 w-7 text-emerald-400" />
            <span>Gestão de Clínicas & Estabelecimentos</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Cadastro de instituições de saúde, responsáveis técnicos médicos (CRM/RQE) e canais monitorados.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition"
        >
          <Plus className="h-4 w-4" />
          <span>Cadastrar Nova Clínica</span>
        </button>
      </div>

      {/* Filtros e Busca */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-80">
          <Search className="h-4 w-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, CRM ou e-mail..."
            className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="">Todos os status</option>
            <option value="ATIVO">Ativo</option>
            <option value="PENDENTE">Pendente</option>
            <option value="INATIVO">Inativo</option>
            <option value="SUSPENSO">Suspenso</option>
          </select>
        </div>
      </div>

      {/* Tabela de Clínicas */}
      <div className="bg-[#0b1329] border border-slate-800 rounded-2xl shadow-lg overflow-hidden">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 bg-slate-900/60">
            <tr>
              <th className="py-3.5 px-4">Clínica & Nome Fantasia</th>
              <th className="py-3.5 px-4">Responsável Técnico</th>
              <th className="py-3.5 px-4">Especialidade / RQE</th>
              <th className="py-3.5 px-4">Website Oficial</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                  Carregando lista de estabelecimentos regulados...
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  Nenhuma clínica encontrada para os filtros selecionados.
                </td>
              </tr>
            ) : (
              clients.map((c) => (
                <tr key={c.id} className="hover:bg-slate-900/50 transition">
                  <td className="py-3.5 px-4">
                    <span className="font-semibold text-white block">{c.name}</span>
                    <span className="text-xs text-slate-400">{c.tradeName || c.email}</span>
                  </td>
                  <td className="py-3.5 px-4 text-xs">
                    <span className="font-mono text-emerald-400 font-semibold block">
                      CRM/{c.crmUf} {c.crmResponsavel}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-xs">
                    <span className="text-slate-200 block">{c.especialidade || 'Clínica Geral'}</span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {c.rqeResponsavel ? `RQE ${c.rqeResponsavel}` : 'Sem RQE'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-xs font-mono text-slate-400">
                    <a
                      href={c.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-emerald-400 inline-flex items-center gap-1"
                    >
                      <span className="max-w-[180px] truncate">{c.websiteUrl}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {c.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handleQuickAudit(c)}
                      className="bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white p-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition"
                      title="Auditar agora"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>Auditar</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de Cadastro */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-400" />
              <span>Cadastrar Nova Instituição Médica</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Informe os dados da clínica e do médico responsável técnico segundo a Res. CFM 2.336/23.
            </p>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 mt-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Razão Social *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nome Fantasia
                  </label>
                  <input
                    type="text"
                    value={formData.tradeName}
                    onChange={(e) => setFormData({ ...formData, tradeName: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    CRM do Resp. *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.crmResponsavel}
                    onChange={(e) => setFormData({ ...formData, crmResponsavel: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">UF *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={formData.crmUf}
                    onChange={(e) => setFormData({ ...formData, crmUf: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">RQE</label>
                  <input
                    type="text"
                    value={formData.rqeResponsavel}
                    onChange={(e) => setFormData({ ...formData, rqeResponsavel: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Especialidade
                  </label>
                  <input
                    type="text"
                    value={formData.especialidade}
                    onChange={(e) => setFormData({ ...formData, especialidade: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    E-mail de Contato *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Website / Canal Digital Principal *
                </label>
                <input
                  type="url"
                  required
                  value={formData.websiteUrl}
                  onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                  placeholder="https://clinica.med.br"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-4 rounded-xl transition"
                >
                  {submitting ? 'Salvando...' : 'Salvar Clínica'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

