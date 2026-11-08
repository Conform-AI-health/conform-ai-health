---
name: architecture-review
description: Padrões de revisão arquitetural, design de sistemas distribuídos, padrões de resiliência e auditoria de contratos de software.
---

# 🏛️ Skill: Architecture Review & Systems Design

Esta skill orienta a auditoria de arquitetura de software, padrões de resiliência e contratos de interface no ConformIA.

## 🎯 Pilares da Revisão
1. **Resiliência Arquitetural:**
   - Garantir que toda chamada a serviços externos de terceiros (Google Gemini, Firecrawl, Resend, Ollama) esteja envelopada por um **Circuit Breaker** e um **Bulkhead**.
2. **Contratos Estritos e Tipagem:**
   - Todo fluxo de dados de entrada e saída deve possuir schema Zod correspondente e tipagem estrita no TypeScript.
3. **Isolamento Multi-Tenant:**
   - Nenhuma entidade pertencente a uma clínica médica pode vazar ou ser acessada por outro tenant (`enforceTenantIsolation`).
4. **Governança de IA:**
   - A IA atua como um motor consultivo sujeito a guardrails determinísticos e conferência fática antes da persistência final do laudo.
