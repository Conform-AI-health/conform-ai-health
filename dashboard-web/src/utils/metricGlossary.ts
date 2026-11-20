/**
 * Glossário Explicativo de Métricas, IA e Conformidade Deontológica
 * Conform.AI Health — Curadoria conjunta AI Engineer, Backend Specialist e Compliance
 */

export interface MetricDefinition {
  title: string;
  description: string;
  category: 'ai' | 'compliance' | 'system' | 'financial';
}

export const METRIC_GLOSSARY: Record<string, MetricDefinition> = {
  // === MÉTRICAS DE IA & LLMOPS ===
  contextSavings: {
    title: 'Economia de Contexto (Tokens Poupados)',
    description:
      'Percentual e volume de tokens poupados através do pipeline de higienização de HTML, remoção de scripts, CSS, telemetria e conversão para Markdown limpo antes do envio ao LLM. Reduz até 90% do consumo da janela de contexto e previne custos desnecessários.',
    category: 'ai',
  },
  inferenceLatency: {
    title: 'Latência de Inferência',
    description:
      'Tempo total de resposta (em milissegundos) transcorrido desde a raspagem do canal digital até o término do processamento pelo modelo de IA (Google Gemini 2.0 Flash ou Ollama local), incluindo reconciliação e validação de guardrails.',
    category: 'ai',
  },
  totalTokens: {
    title: 'Tokens Consumidos',
    description:
      'Volume consolidado de tokens processados na auditoria. Compreende os tokens de entrada (Prompt: normas do CFM, contexto do alvo e instruções) e de saída (Completion: identificação de infrações, evidências e orientações).',
    category: 'ai',
  },
  reconciliationEngine: {
    title: 'Motor de Reconciliação',
    description:
      'Arquitetura híbrida e tolerante a falhas do agente de IA: utiliza como provedor principal o Google Gemini 2.0 Flash e comuta automaticamente para modelos locais (Ollama / Heurístico Regex) em caso de limite de cota (HTTP 429) ou indisponibilidade de rede.',
    category: 'ai',
  },
  evidenceMissingRate: {
    title: 'Taxa Sem Evidências (Alucinação Fática)',
    description:
      'Percentual de apontamentos onde a IA tentou imputar uma não-conformidade sem extrair a citação literal exata (detectedText) do website raspado. O guardrail deontológico bloqueia a infração caso a evidência não exista no texto original.',
    category: 'ai',
  },
  invalidCitationsRate: {
    title: 'Citações Inválidas (Alucinação Normativa)',
    description:
      'Índice de resoluções ou artigos citados pela IA que não constam no banco vetorial de normas oficiais do CFM/ANS. O motor de grounding obrigatório invalida qualquer citação desconhecida.',
    category: 'ai',
  },
  humanAiDivergenceRate: {
    title: 'Divergência Humano-IA',
    description:
      'Frequência estatística com que o auditor humano discorda das conclusões do agente de IA durante a homologação na esteira Human-In-The-Loop (HITL), servindo de balizador para calibração contínua dos prompts.',
    category: 'ai',
  },
  ragChunks: {
    title: 'Recuperação RAG & Embeddings Vetoriais',
    description:
      'Segmentos normativos oficiais do CFM/ANS indexados em vetores de 768 dimensões. O motor busca semanticamente os trechos de leis aplicáveis ao conteúdo raspado para fundamentar juridicamente as constatações.',
    category: 'ai',
  },
  autoTagging: {
    title: 'Auto-Tagging Deontológico',
    description:
      'Classificação semântica automática gerada pós-raspagem (ex.: PUBLICIDADE, TELEMEDICINA, ANTES_E_DEPOIS) para otimizar o filtro vetorial e direcionar os chunks RAG com precisão cirúrgica.',
    category: 'ai',
  },

  // === MÉTRICAS FINANCEIRAS ===
  costPerAudit: {
    title: 'Custo Médio por Auditoria',
    description:
      'Estimativa financeira em reais (BRL) e dólares (USD) calculada dinamicamente a partir dos tokens de entrada e saída consumidos na chamada do modelo de IA, refletindo o custo de inferência unitário.',
    category: 'financial',
  },

  // === MÉTRICAS DE CONFORMIDADE & NEGÓCIO ===
  activeClients: {
    title: 'Clínicas & Estabelecimentos Ativos',
    description:
      'Total de clínicas, hospitais e consultórios com perfil cadastrado, canais digitais monitorados e responsáveis técnicos (CRM/RQE) validados pela governança.',
    category: 'compliance',
  },
  deontologicalScore: {
    title: 'Índice de Conformidade Deontológica',
    description:
      'Score de 0 a 100 pontos calibrado segundo as resoluções do CFM. Cada infração deduz pontos conforme a gravidade: Leve (-5 pts), Média (-10 pts), Grave (-20 pts) e Crítica (-40 pts).',
    category: 'compliance',
  },
  criticalViolations: {
    title: 'Infrações Críticas',
    description:
      'Violações éticas de risco máximo (ex.: promessa de resultados garantidos, manipulação de imagens de pacientes/antes-e-depois, ausência de CRM/RQE do responsável técnico ou desrespeito à LGPD).',
    category: 'compliance',
  },
  trafficLightVerdict: {
    title: 'Veredito Deontológico (Semáforo)',
    description:
      'Classificação executiva de risco: 🟢 Conforme (Regular), 🟡 Parcialmente Conforme (Atenção para adequações), 🟡 Análise Preliminar (Aguardando homologação de auditor) e 🔴 Não Conforme (Risco iminente de sanção).',
    category: 'compliance',
  },
  auditorReviewHITL: {
    title: 'Governança Human-In-The-Loop (HITL)',
    description:
      'Etapa obrigatória de controle de qualidade onde um auditor humano revisa o laudo preliminar gerado pela IA antes do envio oficial da notificação à clínica auditada.',
    category: 'compliance',
  },
};
