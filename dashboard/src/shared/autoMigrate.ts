import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';

function getCatalogNormIdentifier(source: string, normCode: string, fallbackId: string): {
  normId: string;
  type: string;
  number: string;
  year: string;
} {
  const numberYear = normCode.match(/(\d[\d.]*)\s*\/\s*(\d{2,4})/);
  const number =
    source === 'LGPD'
      ? '13709'
      : numberYear?.[1].replace(/\D/g, '') || fallbackId.replace(/\D/g, '') || '0';
  const rawYear = source === 'LGPD' ? '2018' : numberYear?.[2];
  const year = rawYear ? (rawYear.length === 2 ? `20${rawYear}` : rawYear) : '0000';
  const shortType = /\bRDC\b/i.test(normCode)
    ? 'RDC'
    : /\bRN\b/i.test(normCode)
      ? 'RN'
      : source === 'LGPD' || /\blei\b/i.test(normCode)
        ? 'LEI'
        : 'RES';
  const type = shortType === 'RES' ? 'RESOLUCAO' : shortType;

  return {
    normId: `${source}-${shortType}-${number}-${year}`,
    type,
    number,
    year,
  };
}

async function seedNormsCatalog(): Promise<void> {
  const groupedCatalog = new Map<string, typeof NORMS_CATALOG>();
  for (const item of NORMS_CATALOG) {
    const key = `${item.source}:${item.normCode}`;
    const group = groupedCatalog.get(key) || [];
    group.push(item);
    groupedCatalog.set(key, group);
  }

  let seededNorms = 0;
  let seededChunks = 0;
  for (const group of groupedCatalog.values()) {
    const representative = group[0];
    const identifier = getCatalogNormIdentifier(
      representative.source,
      representative.normCode,
      representative.id
    );
    const isRevoked = group.some((item) => item.validity.isRevoked);
    const status = isRevoked ? 'REVOGADA' : 'VIGENTE';
    const sourceUrl = `https://normas.conformia.med.br/${identifier.normId.toLowerCase()}`;
    const tags = Array.from(
      new Set([
        representative.source.toUpperCase(),
        ...group.flatMap((item) => item.keywords.map((keyword) => keyword.toUpperCase())),
        status,
        ...(isRevoked ? ['REVOGADO'] : ['RAG_READY', 'NORMAS_OFFICIAL']),
      ])
    );
    const markdown = [
      `# ${representative.normCode}`,
      ...group.map(
        (item) =>
          `\n## ${item.article} - ${item.title}\n\n**Dispositivo Normativo:**\n${item.content}\n\n**Orientação Corretiva:**\n${item.correctiveGuidance}`
      ),
    ].join('\n');
    const contentHash = crypto.createHash('sha256').update(markdown, 'utf8').digest('hex');
    const existing = await prisma.norm.findFirst({ where: { normId: identifier.normId } });
    const norm =
      existing ||
      (await prisma.norm.create({
        data: {
          normId: identifier.normId,
          orgao: representative.source,
          tipo: identifier.type,
          numero: identifier.number,
          ano: identifier.year,
          status,
          dataPublicacao: representative.validity.publishedAt,
          ementaOriginal: representative.title,
          ementaHigienizada: `${representative.normCode} - ${representative.title}`,
          macroTema: 'Conformidade Regulatória e Normas Legais',
          urlOriginal: sourceUrl,
          urlPdfOriginal: null,
          sha256Original: contentHash,
          conteudoOriginalBruto: markdown,
          conteudoHigienizado: markdown,
          cleanMarkdown: markdown,
          totalChunks: isRevoked ? 0 : group.length,
          tokensEstimados: Math.ceil(markdown.length / 4),
          tags,
          metadadosRAG: JSON.stringify({
            source_url: sourceUrl,
            source: 'NORMS_CATALOG',
            norm_type: identifier.type,
            year: identifier.year,
            status,
            version: 1,
          }),
        },
      }));

    if (!existing) seededNorms++;
    if (isRevoked) continue;

    const existingChunks = await prisma.normChunk.count({ where: { normId: norm.id } });
    if (existingChunks > 0) continue;

    if (existing) {
      await prisma.norm.update({
        where: { id: norm.id },
        data: { totalChunks: group.length },
      });
    }

    await prisma.normChunk.createMany({
      data: group.map((item, index) => {
        const chunkText = `${item.content}\n\nOrientação Corretiva: ${item.correctiveGuidance}`;
        const context = `${representative.normCode} | ${item.article} | ${item.title}`;
        return {
          normId: norm.id,
          normCode: norm.normId,
          chunkIndex: index + 1,
          totalChunks: group.length,
          conteudoChunk: chunkText,
          tokensEstimados: Math.ceil(chunkText.length / 4),
          caracteresCount: chunkText.length,
          contextoSemantico: JSON.stringify({
            heading_context: context,
            article: item.article,
            norm_title: representative.title,
            source_url: sourceUrl,
            source: 'NORMS_CATALOG',
            embedding_model: 'PENDING',
            content_hash: crypto.createHash('sha256').update(chunkText, 'utf8').digest('hex'),
          }),
          overlapTokens: 0,
          maxChunkTokens: 650,
          embedding: [],
          tags: Array.from(
            new Set([...tags, ...item.keywords.map((keyword) => keyword.toUpperCase())])
          ),
        };
      }),
    });
    seededChunks += group.length;
  }

  const obsoleteCatalogUrls = NORMS_CATALOG.map(
    (item) => `https://normas.conformia.med.br/${item.id.toLowerCase()}`
  );
  await prisma.scrapedPage.deleteMany({ where: { url: { in: obsoleteCatalogUrls } } });

  console.log(
    `📚 [Seed] ${seededNorms} documento(s) e ${seededChunks} chunk(s) do catálogo provisionados em norms/norms_chunk.`
  );
  if (seededChunks > 0) {
    console.warn('[Seed] Os chunks novos estão pendentes de embedding semântico. Execute `npm run rag:reindex` no dashboard.');
  }
}

/**
 * 1. Executa migrações de dados, normalizações de schema e autocura estrutural (C03)
 */
export async function runDatabaseMigrations(): Promise<void> {
  console.log('🔄 [Migration] Verificando e aplicando migrações estruturais no MongoDB...');

  // 1.1 Atualizar AgentModules com code nulo ou vazio
  const agentsWithoutCode = await prisma.agentModule.findMany({
    where: { code: null },
  });

  for (const ag of agentsWithoutCode) {
    const slug = ag.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `agent-${ag.id.slice(-6)}`;
    await prisma.agentModule.update({
      where: { id: ag.id },
      data: { code: `${slug}-${ag.id.slice(-4)}` },
    });
  }
  if (agentsWithoutCode.length > 0) {
    console.log(`🛡️ [Migration] ${agentsWithoutCode.length} Módulo(s) de Agente legados sanitizados com slugs válidos.`);
  }

  // 1.2 Atualizar Clientes e Módulos com datas nulas (createdAt / updatedAt)
  const clientsWithoutDates = await prisma.client.findMany({
    where: {
      OR: [{ createdAt: null }, { updatedAt: null }],
    },
  });

  const now = new Date();
  for (const cl of clientsWithoutDates) {
    await prisma.client.update({
      where: { id: cl.id },
      data: {
        createdAt: cl.createdAt || now,
        updatedAt: cl.updatedAt || now,
      },
    });
  }
  if (clientsWithoutDates.length > 0) {
    console.log(`🛡️ [Migration] ${clientsWithoutDates.length} Cliente(s) legados sanitizados com timestamps válidos.`);
  }

  // 1.3 Verificação de conformidade da coleção 'scraped_pages' (T27)
  // Operações de exclusão destrutiva foram desacopladas do boot e migradas para o script CLI com --dry-run e backup (npm run db:cleanup).
  const allClients = await prisma.client.findMany({ select: { websiteUrl: true } });
  const clinicUrls = allClients.map((c) => c.websiteUrl).filter(Boolean) as string[];

  const countClinicPages = await prisma.scrapedPage.count({
    where: {
      OR: [
        ...(clinicUrls.length > 0 ? [{ url: { in: clinicUrls } }] : []),
        { url: { contains: 'dermotologista' } },
      ],
    },
  });

  if (countClinicPages > 0) {
    console.log(`ℹ️ [Migration:T27] ${countClinicPages} página(s) de clínica detectadas em scraped_pages. Execute 'npm run db:cleanup' para higienização manual com backup.`);
  }

  // C03: NUNCA associar laudos antigos a clientes arbitrários nem injetar URLs fictícias.
  // Laudos históricos preservam sua fidelidade fática integral.
}

/**
 * 2. Executa provisionamento idempotente de dados iniciais (Seed)
 */
export async function runInitialSeed(): Promise<void> {
  console.log('🌱 [Seed] Provisionando usuário administrador, catálogo oficial de normas e modelos de IA...');

  // 2.1 Usuário Administrador Oficial (Hardening T01 / Regra 6.1)
  const isProduction = process.env.NODE_ENV === 'production';
  const adminEmail = process.env.ADMIN_EMAIL || (isProduction ? '' : 'admin@conform.ai');
  const adminPassword = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'admin123456');

  if (isProduction) {
    if (!adminEmail || !adminPassword || adminPassword.length < 12) {
      throw new Error(
        '❌ [Segurança T01] Em ambiente de produção, ADMIN_EMAIL e ADMIN_PASSWORD são obrigatórios e a senha deve ter pelo menos 12 caracteres.'
      );
    }
    if (['admin123456', 'password', '12345678', 'admin', 'administrator'].includes(adminPassword)) {
      throw new Error(
        '❌ [Segurança T01] É proibido iniciar a aplicação em produção com senhas administrativas padrão conhecidas.'
      );
    }
  }

  let user = null;
  if (adminEmail) {
    user = await prisma.user.findUnique({ where: { email: adminEmail } });
  }

  if (!user && adminEmail && adminPassword) {
    const saltRounds = 12;
    const adminPasswordHash = await bcrypt.hash(adminPassword, saltRounds);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: adminPasswordHash,
        name: 'Administrador ConformIA',
        role: 'ADMIN',
      },
    });
    console.log(`✅ [Seed] Novo usuário administrador provisionado com sucesso: ${adminEmail}`);
  } else if (user) {
    console.log(`ℹ️ [Seed] Administrador existente detectado (${adminEmail}). Preservando credenciais e configurações atuais.`);
  }

  // 2.2 Repositório de Normas Oficiais nas coleções normativas usadas pelo RAG
  await seedNormsCatalog();

  // 2.3 Definição do Agente Deontológico Padrão (Desacoplamento Normativo Dinâmico)
  await prisma.agentDefinition.upsert({
    where: { name: 'CFM_DEONTOLOGY_AUDITOR_V1' },
    update: {
      systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista em normas e resoluções vigentes de saúde.',
      targetNorm: 'Catálogo Normativo Ativo e Resoluções Vigentes',
    },
    create: {
      name: 'CFM_DEONTOLOGY_AUDITOR_V1',
      systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista em normas e resoluções vigentes de saúde.',
      targetNorm: 'Catálogo Normativo Ativo e Resoluções Vigentes',
      defaultMode: 'CHEERIO',
      temperature: 0.1,
    },
  });

  // 2.4 Modelos de Inteligência Artificial Padrão no Banco
  const existingModelsCount = await prisma.aiModelConfig.count();
  if (existingModelsCount === 0) {
    console.log('🤖 [Seed] Criando modelos de IA iniciais no MongoDB...');
    await prisma.aiModelConfig.createMany({
      data: [
        {
          name: 'Google Gemini 3.5 Flash',
          provider: 'gemini',
          modelId: 'gemini-3.5-flash',
          isActive: true,
          isDefault: true,
          temperature: 0.2,
          maxTokens: 2048,
          description: 'Modelo multimodal de alta velocidade e precisão para auditoria do Catálogo Normativo Dinâmico em Saúde.',
        },
        {
          name: 'Ollama Local (Qwen 2.5)',
          provider: 'ollama',
          modelId: 'qwen2.5:7b',
          baseUrl: 'http://localhost:11434',
          isActive: false,
          isDefault: false,
          temperature: 0.2,
          maxTokens: 2048,
          description: 'Modelo open-source executado localmente para soberania e privacidade de dados em saúde.',
        },
        {
          name: 'Motor Heurístico Deontológico',
          provider: 'heuristic',
          modelId: 'regex-heuristic-v1',
          isActive: false,
          isDefault: false,
          temperature: 0.0,
          maxTokens: 1024,
          description: 'Motor determinístico baseado no catálogo de artigos, regras gramaticais e regex.',
        },
      ],
    });
    console.log('✅ [Seed] 3 modelos de IA provisionados com sucesso no banco.');
  } else {
    // Atualização de referências a modelos descontinuados
    await prisma.aiModelConfig.updateMany({
      where: {
        OR: [{ modelId: 'gemini-2.0-flash' }, { modelId: 'gemini-2.5-flash' }],
      },
      data: {
        name: 'Google Gemini 3.5 Flash',
        modelId: 'gemini-3.5-flash',
        description: 'Modelo multimodal de alta velocidade e precisão para auditoria do Catálogo Normativo Dinâmico em Saúde.',
      },
    });
  }
}

/**
 * 3. Validação de Integridade Geral e Rastreabilidade (C03)
 */
export async function runDataIntegrityCheck(): Promise<void> {
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (adminCount === 0) {
    throw new Error('❌ [Integridade] Nenhum usuário com perfil ADMIN encontrado no banco após bootstrap.');
  }
  const modelsCount = await prisma.aiModelConfig.count();
  if (modelsCount === 0) {
    throw new Error('❌ [Integridade] Nenhum modelo de IA ativo ou configurado no banco de dados.');
  }
  console.log('✨ [Integridade] Banco de dados consistente e validado com sucesso.');
}

/**
 * Orquestrador principal de inicialização e autocura do banco de dados
 */
export async function runAutoMigrateAndSeed(): Promise<void> {
  console.log('🌱 [AutoMigrate & Seed] Iniciando ciclo estruturado de banco de dados...');
  try {
    await runDatabaseMigrations();
    await runInitialSeed();
    await runDataIntegrityCheck();
    console.log('✨ [AutoMigrate & Seed] Ciclo de bootstrap concluído com sucesso.');
  } catch (error: any) {
    console.error('❌ [AutoMigrate & Seed] Falha crítica de banco de dados:', error.message);
    throw error;
  }
}

// Executar se chamado diretamente via CLI
if (process.argv[1]?.includes('autoMigrate.ts')) {
  runAutoMigrateAndSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
