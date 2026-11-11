import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';

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

  // 1.3 Higienização da coleção 'scraped_pages': deve conter exclusivamente normas regulatórias oficiais
  const allClients = await prisma.client.findMany({ select: { websiteUrl: true } });
  const clinicUrls = allClients.map((c) => c.websiteUrl).filter(Boolean) as string[];

  const deletedClinicPages = await prisma.scrapedPage.deleteMany({
    where: {
      OR: [
        ...(clinicUrls.length > 0 ? [{ url: { in: clinicUrls } }] : []),
        { url: { contains: 'dermotologista' } },
      ],
    },
  });

  if (deletedClinicPages && deletedClinicPages.count > 0) {
    console.log(`🛡️ [Migration] ${deletedClinicPages.count} página(s) de clínica indevidas removidas do repositório de normas.`);
  }

  // C03: NUNCA associar laudos antigos a clientes arbitrários nem injetar URLs fictícias (ex: https://conform-ia.med.br).
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

  // 2.2 Repositório de Normas Oficiais no MongoDB (scraped_pages)
  const normsInDb = await prisma.scrapedPage.count();
  if (normsInDb === 0) {
    console.log('📚 [Seed] Provisionando Catálogo de Normas Oficiais no MongoDB (scraped_pages)...');
    for (const norm of NORMS_CATALOG) {
      await prisma.scrapedPage.upsert({
        where: { url: `https://normas.conformia.med.br/${norm.id.toLowerCase()}` },
        update: {
          title: `[${norm.source}] ${norm.normCode} - ${norm.title}`,
          cleanMarkdown: `# ${norm.normCode} - ${norm.article}: ${norm.title}\n\n**Dispositivo Normativo:**\n${norm.content}\n\n**Orientação Deontológica:**\n${norm.correctiveGuidance}`,
          tags: [norm.source, norm.source.toLowerCase(), ...norm.keywords.map((k) => k.toLowerCase())],
        },
        create: {
          url: `https://normas.conformia.med.br/${norm.id.toLowerCase()}`,
          title: `[${norm.source}] ${norm.normCode} - ${norm.title}`,
          cleanMarkdown: `# ${norm.normCode} - ${norm.article}: ${norm.title}\n\n**Dispositivo Normativo:**\n${norm.content}\n\n**Orientação Deontológica:**\n${norm.correctiveGuidance}`,
          rawLength: norm.content.length,
          tokensCount: Math.ceil(norm.content.length / 4),
          tags: [norm.source, norm.source.toLowerCase(), ...norm.keywords.map((k) => k.toLowerCase())],
        },
      });
    }
    console.log(`✅ [Seed] Repositório de normas inicializado com ${NORMS_CATALOG.length} resoluções.`);
  }

  // 2.3 Definição do Agente Deontológico Padrão
  await prisma.agentDefinition.upsert({
    where: { name: 'CFM_DEONTOLOGY_AUDITOR_V1' },
    update: {
      systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista na Resolução CFM nº 2.336/2023, ANS e LGPD.',
      targetNorm: 'Resolução CFM nº 2.336/2023, ANS RN 509 e LGPD Art. 11',
    },
    create: {
      name: 'CFM_DEONTOLOGY_AUDITOR_V1',
      systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista na Resolução CFM nº 2.336/2023, ANS e LGPD.',
      targetNorm: 'Resolução CFM nº 2.336/2023, ANS RN 509 e LGPD Art. 11',
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
          description: 'Modelo multimodal de alta velocidade e precisão para auditoria da Res. CFM 2.336/2023.',
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
        description: 'Modelo multimodal de alta velocidade e precisão para auditoria da Res. CFM 2.336/2023.',
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
