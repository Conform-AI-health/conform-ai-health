---
name: rag-engineering
description: Engenharia de RAG (Retrieval-Augmented Generation), extração de normas em saúde, chunking semântico, filtragem de revogação e resolução dinâmica de contexto deontológico.
---

# 📚 Skill: RAG Engineering (Retrieval-Augmented Generation em Saúde)

Esta skill define as diretrizes para indexação, busca e injeção contextual de normas e resoluções deontológicas da saúde (CFM, LGPD, ANVISA, ANS).

## 🎯 Princípios Fundamentais
1. **Filtragem Ativa de Revogação:**
   - Resoluções que possuam a tag `REVOGADO` ou termos explícitos de revogação JAMAIS devem ser injetadas no contexto de auditoria imediata.
2. **Chunking Semântico Orientado a Artigos:**
   - Cada chunk deve representar uma unidade regulatória completa (artigo, parágrafo, inciso) com metadados de severidade padrão e palavras-chave.
3. **Resolução Dinâmica baseada em Tags:**
   - A correspondência entre o agente e as normas é resolvida em tempo de execução via tags regulatórias (`NormsResolver.resolveByTags`).

## 🛠️ Boas Práticas
- Utilizar cache em memória para catálogos estáticos e consultas indexadas no MongoDB.
- Calcular SHA-256 do conteúdo raspado para detectar alterações normativas.
- Limitar o tamanho do contexto injetado para otimizar tokens e latência sem perder precisão jurídica.
