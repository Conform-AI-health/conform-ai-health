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
  Pencil,
  Stethoscope,
  X,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../services/api';
import { Pagination } from '../components/Pagination';
import { useToast } from '../context/ToastContext';

export const ClientsPage: React.FC = () => {
  const toast = useToast();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modais
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<any>(null);

  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalClients, setTotalClients] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

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
    status: 'ATIVO',
    email: '',
    phone: '',
  });

  // Formulário de Edição
  const [editFormData, setEditFormData] = useState({
    name: '',
    tradeName: '',
    cnpj: '',
    crmResponsavel: '',
    crmUf: 'SP',
    rqeResponsavel: '',
    especialidade: '',
    websiteUrl: '',
    status: 'ATIVO',
    email: '',
    phone: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchClients = async (page = currentPage, limit = pageSize) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      params.append('page', String(page));
      params.append('limit', String(limit));

      const res = await api.get(`/clients?${params.toString()}`);
      setClients(res.data?.data || []);
      if (res.data?.pagination) {
        setTotalClients(res.data.pagination.total);
        setTotalPages(res.data.pagination.totalPages);
        setCurrentPage(res.data.pagination.page);
      }
    } catch (err: any) {
      console.error('Erro ao buscar clientes:', err);
      toast.error(`Falha ao carregar lista de clínicas: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients(1, pageSize);
  }, [search, statusFilter]);

  useEffect(() => {
    fetchClients(currentPage, pageSize);
  }, [currentPage, pageSize]);

  // Criação
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload: any = {
        name: formData.name.trim(),
        status: formData.status,
      };
      if (formData.tradeName?.trim()) payload.tradeName = formData.tradeName.trim();
      if (formData.cnpj?.trim()) payload.cnpj = formData.cnpj.trim();
      if (formData.email?.trim()) payload.email = formData.email.trim();
      if (formData.phone?.trim()) payload.phone = formData.phone.trim();
      if (formData.crmResponsavel?.trim()) payload.crmResponsavel = formData.crmResponsavel.trim();
      if (formData.crmUf?.trim()) payload.crmUf = formData.crmUf.trim().toUpperCase();
      if (formData.rqeResponsavel?.trim()) payload.rqeResponsavel = formData.rqeResponsavel.trim();
      if (formData.especialidade?.trim()) payload.especialidade = formData.especialidade.trim();
      if (formData.websiteUrl?.trim()) payload.websiteUrl = formData.websiteUrl.trim();

      await api.post('/clients', payload);
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
        status: 'ATIVO',
        email: '',
        phone: '',
      });
      fetchClients();
      toast.success('Clínica médica cadastrada e vinculada com sucesso!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao cadastrar clínica');
    } finally {
      setSubmitting(false);
    }
  };

  // Abrir Modal de Edição
  const handleOpenEdit = (client: any) => {
    setEditingClient(client);
    setEditFormData({
      name: client.name || '',
      tradeName: client.tradeName || '',
      cnpj: client.cnpj || '',
      crmResponsavel: client.crmResponsavel || '',
      crmUf: client.crmUf || 'SP',
      rqeResponsavel: client.rqeResponsavel || '',
      especialidade: client.especialidade || '',
      websiteUrl: client.websiteUrl || '',
      status: client.status || 'ATIVO',
      email: client.email || '',
      phone: client.phone || '',
    });
    setShowEditModal(true);
  };

  // Salvar Edição
  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient?.id) return;
    try {
      setSubmitting(true);
      const payload: any = {
        name: editFormData.name.trim(),
        status: editFormData.status,
      };
      if (editFormData.tradeName !== undefined) payload.tradeName = editFormData.tradeName.trim();
      if (editFormData.cnpj !== undefined) payload.cnpj = editFormData.cnpj.trim();
      if (editFormData.email !== undefined) payload.email = editFormData.email.trim();
      if (editFormData.phone !== undefined) payload.phone = editFormData.phone.trim();
      if (editFormData.crmResponsavel !== undefined) payload.crmResponsavel = editFormData.crmResponsavel.trim();
      if (editFormData.crmUf !== undefined) payload.crmUf = editFormData.crmUf.trim().toUpperCase();
      if (editFormData.rqeResponsavel !== undefined) payload.rqeResponsavel = editFormData.rqeResponsavel.trim();
      if (editFormData.especialidade !== undefined) payload.especialidade = editFormData.especialidade.trim();
      if (editFormData.websiteUrl !== undefined) payload.websiteUrl = editFormData.websiteUrl.trim();

      await api.put(`/clients/${editingClient.id}`, payload);
      setShowEditModal(false);
      setEditingClient(null);
      fetchClients();
      toast.success('Dados da clínica médica atualizados com sucesso!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao atualizar clínica');
    } finally {
      setSubmitting(false);
    }
  };

  // Abrir Confirmação de Exclusão
  const handleOpenDelete = (client: any) => {
    setClientToDelete(client);
    setShowDeleteModal(true);
  };

  // Confirmar Exclusão
  const handleConfirmDelete = async () => {
    if (!clientToDelete?.id) return;
    try {
      setDeleting(true);
      await api.delete(`/clients/${clientToDelete.id}`);
      setShowDeleteModal(false);
      setClientToDelete(null);
      fetchClients();
      toast.success('Clínica médica removida do sistema com sucesso!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao excluir clínica');
    } finally {
      setDeleting(false);
    }
  };

  const handleQuickAudit = async (client: any) => {
    try {
      const modulesRes = await api.get('/agents');
      const firstModule = modulesRes.data?.data?.[0] || modulesRes.data?.[0];
      if (!firstModule) {
        toast.warning('Nenhum módulo de agente ativo disponível para disparo imediato.');
        return;
      }

      await api.post(`/agents/${firstModule.id}/run`, {
        clientId: client.id,
        targetUrl: client.websiteUrl || 'https://prontomed.med.br',
        extractionMode: 'CHEERIO',
      });
      toast.success(`Auditoria deontológica disparada com sucesso para ${client.name}!`, 'Varredura em Fila');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Falha ao disparar auditoria');
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
        <div className="overflow-x-auto">
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
                      <span className="text-xs text-slate-400">{c.tradeName || c.email || 'Sem nome fantasia'}</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      {c.crmResponsavel ? (
                        <span className="font-mono text-emerald-400 font-semibold block">
                          CRM/{c.crmUf || 'SP'} {c.crmResponsavel}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">Não informado</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      <span className="text-slate-200 block">{c.especialidade || 'Clínica Geral'}</span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {c.rqeResponsavel ? `RQE ${c.rqeResponsavel}` : 'Sem RQE'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-slate-400">
                      {c.websiteUrl ? (
                        <a
                          href={c.websiteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-emerald-400 inline-flex items-center gap-1"
                        >
                          <span className="max-w-[180px] truncate">{c.websiteUrl}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-slate-500 italic">Sem URL</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'ATIVO'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : c.status === 'PENDENTE'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleQuickAudit(c)}
                          className="bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
                          title="Auditar agora"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span>Auditar</span>
                        </button>
                        <button
                          onClick={() => handleOpenEdit(c)}
                          className="bg-slate-800 hover:bg-cyan-600 text-slate-300 hover:text-white p-1.5 rounded-lg text-xs transition"
                          title="Editar dados da clínica"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleOpenDelete(c)}
                          className="bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white p-1.5 rounded-lg text-xs transition"
                          title="Excluir clínica"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação de Clínicas */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalClients}
          itemsPerPage={pageSize}
          onPageChange={(p) => setCurrentPage(p)}
          onLimitChange={(l) => setPageSize(l)}
          limitOptions={[5, 10, 20, 50]}
          itemLabel="instituições médicas"
        />
      </div>

      {/* ============================================================== */}
      {/* MODAL 1: NOVO CLIENTE REGULADO (CADASTRAR) */}
      {/* ============================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#0b132b] border border-slate-800 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <h2 className="text-base font-bold text-white flex items-center gap-2.5">
                <Building2 className="h-5 w-5 text-cyan-400" />
                <span>Novo Cliente Regulado</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Razão Social *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: ProntoMed Digital Saúde Ltda"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome Fantasia
                </label>
                <input
                  type="text"
                  placeholder="Ex: ProntoMed Digital"
                  value={formData.tradeName}
                  onChange={(e) => setFormData({ ...formData, tradeName: e.target.value })}
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    CNPJ
                  </label>
                  <input
                    type="text"
                    placeholder="00.000.000/0001-00"
                    value={formData.cnpj}
                    onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="ATIVO">Ativo</option>
                    <option value="PENDENTE">Pendente</option>
                    <option value="INATIVO">Inativo</option>
                    <option value="SUSPENSO">Suspenso</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    E-mail de Notificação / Compliance
                  </label>
                  <input
                    type="email"
                    placeholder="compliance@prontomed.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Telefone de Plantão
                  </label>
                  <input
                    type="tel"
                    placeholder="(11) 98765-4321"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Responsável Técnico Médico */}
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider block mb-2.5">
                  Responsável Técnico Médico (CFM)
                </span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      CRM do Responsável
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 123456"
                      value={formData.crmResponsavel}
                      onChange={(e) => setFormData({ ...formData, crmResponsavel: e.target.value })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      UF
                    </label>
                    <input
                      type="text"
                      maxLength={2}
                      placeholder="SP"
                      value={formData.crmUf}
                      onChange={(e) => setFormData({ ...formData, crmUf: e.target.value.toUpperCase() })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase placeholder-slate-600 focus:outline-none focus:border-cyan-500 text-center"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      RQE (Qualificação)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 98765"
                      value={formData.rqeResponsavel}
                      onChange={(e) => setFormData({ ...formData, rqeResponsavel: e.target.value })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Especialidade
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Dermatologia"
                      value={formData.especialidade}
                      onChange={(e) => setFormData({ ...formData, especialidade: e.target.value })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Website Oficial ou URL Auditada
                  </label>
                  <input
                    type="url"
                    placeholder="https://prontomed.med.br"
                    value={formData.websiteUrl}
                    onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs py-2.5 px-6 rounded-xl transition shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Cadastrando...' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: EDITAR CLIENTE REGULADO (ATUALIZAR) */}
      {/* ============================================================== */}
      {showEditModal && editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#0b132b] border border-slate-800 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <h2 className="text-base font-bold text-white flex items-center gap-2.5">
                <Pencil className="h-5 w-5 text-cyan-400" />
                <span>Editar Cliente Regulado</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateSubmit} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Razão Social *
                </label>
                <input
                  type="text"
                  required
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome Fantasia
                </label>
                <input
                  type="text"
                  value={editFormData.tradeName}
                  onChange={(e) => setEditFormData({ ...editFormData, tradeName: e.target.value })}
                  className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    CNPJ
                  </label>
                  <input
                    type="text"
                    value={editFormData.cnpj}
                    onChange={(e) => setEditFormData({ ...editFormData, cnpj: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Status
                  </label>
                  <select
                    value={editFormData.status}
                    onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="ATIVO">Ativo</option>
                    <option value="PENDENTE">Pendente</option>
                    <option value="INATIVO">Inativo</option>
                    <option value="SUSPENSO">Suspenso</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    E-mail de Notificação / Compliance
                  </label>
                  <input
                    type="email"
                    value={editFormData.email}
                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Telefone de Plantão
                  </label>
                  <input
                    type="tel"
                    value={editFormData.phone}
                    onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Responsável Técnico Médico */}
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider block mb-2.5">
                  Responsável Técnico Médico (CFM)
                </span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      CRM do Responsável
                    </label>
                    <input
                      type="text"
                      value={editFormData.crmResponsavel}
                      onChange={(e) => setEditFormData({ ...editFormData, crmResponsavel: e.target.value })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      UF
                    </label>
                    <input
                      type="text"
                      maxLength={2}
                      value={editFormData.crmUf}
                      onChange={(e) => setEditFormData({ ...editFormData, crmUf: e.target.value.toUpperCase() })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase focus:outline-none focus:border-cyan-500 text-center"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      RQE (Qualificação)
                    </label>
                    <input
                      type="text"
                      value={editFormData.rqeResponsavel}
                      onChange={(e) => setEditFormData({ ...editFormData, rqeResponsavel: e.target.value })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Especialidade
                    </label>
                    <input
                      type="text"
                      value={editFormData.especialidade}
                      onChange={(e) => setEditFormData({ ...editFormData, especialidade: e.target.value })}
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Website Oficial ou URL Auditada
                  </label>
                  <input
                    type="url"
                    value={editFormData.websiteUrl}
                    onChange={(e) => setEditFormData({ ...editFormData, websiteUrl: e.target.value })}
                    className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs py-2.5 px-6 rounded-xl transition shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: CONFIRMAR EXCLUSÃO DE CLIENTE */}
      {/* ============================================================== */}
      {showDeleteModal && clientToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#1e0808]/95 border border-red-500/40 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-left">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-950/60 rounded-xl border border-red-800/50 text-red-400">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Excluir Clínica</h3>
                <p className="text-xs text-red-200/80 mt-0.5">Ação permanente e irreversível</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Tem certeza que deseja remover o cadastro da clínica{' '}
              <strong className="text-white font-semibold">"{clientToDelete.name}"</strong>?
              Todos os vínculos regulatórios e configurações de auditoria associados serão removidos.
            </p>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-red-900/40">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs py-2 px-5 rounded-xl transition shadow-lg shadow-red-950/50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{deleting ? 'Removendo...' : 'Sim, Excluir'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
