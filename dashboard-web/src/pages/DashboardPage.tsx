import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  AlertTriangle,
  Building2,
  FileCheck2,
  Cpu,
  Play,
  TrendingUp,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Clock,
  CheckCircle2,
  LayoutDashboard,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { api } from '../services/api';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reportsRes, clientsRes, modulesRes] = await Promise.all([
        api.get('/reports?limit=10'),
        api.get('/clients?limit=100'),
        api.get('/agents'),
      ]);

      setReports(reportsRes.data?.data || []);
      setClients(clientsRes.data?.data || []);
      setModules(modulesRes.data?.data || (Array.isArray(modulesRes.data) ? modulesRes.data : []));
    } catch (err) {
      console.error('Erro ao carregar dados do cockpit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Cálculos de Indicadores
  const totalReports = reports.length;
  const compliantCount = reports.filter((r) => r.verdict === 'CONFORME').length;
  const partialCount = reports.filter((r) => r.verdict === 'PARCIALMENTE_CONFORME').length;
  const nonCompliantCount = reports.filter((r) => r.verdict === 'NAO_CONFORME').length;

  const avgScore =
    totalReports > 0
      ? Math.round(reports.reduce((acc, r) => acc + (r.score || 0), 0) / totalReports)
      : 0;

  const totalTokensSaved = reports.reduce((acc, r) => acc + (r.tokensSaved || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Unificado */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
            <span>Cockpit do Auditor Deontológico</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition flex items-center gap-2 text-xs font-semibold"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* PANORAMA & INDICADORES DE CONFORMIDADE */}
      {/* ============================================================== */}
      <div className="space-y-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1: Clínicas */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Clínicas Ativas
                </span>
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                  <Building2 className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white">{clients.length}</span>
                <span className="text-xs font-medium text-emerald-400 flex items-center">
                  <TrendingUp className="h-3 w-3 mr-0.5" /> 100% monitoradas
                </span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Mapeamento contínuo de CRM e RQE
              </div>
            </div>

            {/* Card 2: Conformidade Média */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Índice Deontológico
                </span>
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-emerald-400">{avgScore}</span>
                <span className="text-xs text-slate-400">/ 100 pts</span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Média ponderada do ecossistema
              </div>
            </div>

            {/* Card 3: Não-Conformes Críticos */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Violações Críticas
                </span>
                <div className="h-8 w-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-red-400">{nonCompliantCount}</span>
                <span className="text-xs text-slate-400">laudos vermelhos</span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Exigem notificação preventiva imediata
              </div>
            </div>

            {/* Card 4: Economia de Tokens via Sanitização */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Token Efficiency
                </span>
                <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <Cpu className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-purple-400">
                  {totalTokensSaved > 1000 ? `${(totalTokensSaved / 1000).toFixed(1)}k` : totalTokensSaved}
                </span>
                <span className="text-xs text-slate-400">tokens poupados</span>
              </div>
              <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                Redução de ~90% de custo LLM
              </div>
            </div>
          </div>

          {/* Semáforo & Status Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Distribuição Semáforo */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  <span>Distribuição Semáforo Deontológico</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Classificação executiva de risco regulatório no ecossistema
                </p>

                <div className="space-y-4 mt-6">
                  {/* Verde */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-emerald-400 flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span> Conforme (Regular)
                      </span>
                      <span className="text-slate-300">{compliantCount} laudos</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all"
                        style={{
                          width: totalReports > 0 ? `${(compliantCount / totalReports) * 100}%` : '0%',
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Amarelo */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-amber-400 flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span> Parcialmente Conforme (Atenção)
                      </span>
                      <span className="text-slate-300">{partialCount} laudos</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full transition-all"
                        style={{
                          width: totalReports > 0 ? `${(partialCount / totalReports) * 100}%` : '0%',
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Vermelho */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-red-400 flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span> Não Conforme (Crítico)
                      </span>
                      <span className="text-slate-300">{nonCompliantCount} laudos</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full transition-all"
                        style={{
                          width: totalReports > 0 ? `${(nonCompliantCount / totalReports) * 100}%` : '0%',
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800/80 mt-6 flex items-center justify-between text-xs">
                <span className="text-slate-400">Total auditado:</span>
                <span className="font-bold text-white font-mono">{totalReports} laudos</span>
              </div>
            </div>

            {/* Ação Rápida Integrada */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Play className="h-4 w-4 text-emerald-400 fill-emerald-400" />
                  <span>Auditoria Preventiva Contínua</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Dispare varreduras imediatas em websites ou contas de Instagram para prevenir multas do CFM.
                </p>

                <div className="mt-5 space-y-3">
                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">
                    <span className="text-slate-300 font-semibold block mb-0.5">Res. CFM 2.336/2023:</span>
                    <span className="text-slate-400 text-[11px]">
                      Auditoria de antes e depois educativo, identificação de responsável técnico e ausência de promoções.
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">
                    <span className="text-slate-300 font-semibold block mb-0.5">LGPD em Saúde:</span>
                    <span className="text-slate-400 text-[11px]">
                      Verificação de conformidade na captação de dados biométricos e histórico clínico de pacientes.
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => navigate('/agents')}
                className="mt-6 w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 transition"
              >
                <span>Ir para Cockpit de Agentes & Disparo</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {/* Destaque de Clínicas */}
            <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-400" />
                  <span>Instituições sob Fiscalização</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Últimas clínicas registradas no ecossistema
                </p>

                <div className="mt-4 space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {clients.slice(0, 4).map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 text-xs flex items-center justify-between"
                    >
                      <div className="truncate mr-2">
                        <span className="font-semibold text-white truncate block">{c.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          CRM/{c.crmUf} {c.crmResponsavel}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/40">
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400">Total de clínicas:</span>
                <span className="font-bold text-white font-mono">{clients.length} ativas</span>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};
