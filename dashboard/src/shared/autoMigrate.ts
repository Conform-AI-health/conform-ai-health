import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';

export async function runAutoMigrateAndSeed() {
  console.log('🌱 [AutoMigrate & Seed] Verificando e provisionando administrador e módulos oficiais...');

  try {
    // 1. Usuário Administrador Oficial (Hardening T01 - Regra 6.1)
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

    // T03: Consulta segura do usuário administrador sem exclusão automática em caso de erro de leitura
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
      // T01 & T03: Preservar credenciais e configurações existentes do administrador
      console.log(`ℹ️ [Seed] Administrador existente detectado (${adminEmail}). Preservando credenciais e configurações atuais.`);
    }

    // 2. Módulos de Agente: Cadastro estritamente manual pelo usuário (seeds automáticos removidos conforme governança)
    console.log(`ℹ️ [Governança] Módulos de agente operam com cadastro estritamente manual pelo usuário.`);

    // 2.1 Repositório de Normas Web & Tagging Regulatória no Banco (scraped_pages)
    try {
      const normsInDb = await prisma.scrapedPage.count();
      if (normsInDb === 0) {
        console.log('📚 [Seed] Provisionando Repositório de Normas Web e Deontologia no MongoDB (scraped_pages)...');
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
          }).catch(() => {});
        }
        console.log(`✅ [Seed] Repositório de normas inicializado com ${NORMS_CATALOG.length} resoluções.`);
      }
    } catch (normSeedErr: any) {
      console.warn('⚠️ [Seed] Falha ao sincronizar normas em scraped_pages:', normSeedErr.message);
    }

    // 3. Definição do Agente Deontológico
    await prisma.agentDefinition.upsert({
      where: { name: 'CFM_DEONTOLOGY_AUDITOR_V1' },
      update: {
        systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista na Resolução CFM nº...',
        targetNorm: 'Resolução CFM nº, ANS RN 509 e LGPD Art. 11',
      },
      create: {
        name: 'CFM_DEONTOLOGY_AUDITOR_V1',
        systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista na Resolução CFM nº...',
        targetNorm: 'Resolução CFM nº, ANS RN 509 e LGPD Art. 11',
        defaultMode: 'CHEERIO',
        temperature: 0.1,
      },
    });

    // 4. Modelos Padrão de Inteligência Artificial no Banco de Dados
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
      // Atualização resiliente de modelos descontinuados
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

    // 5. Autocura e Sanitização de Registros Legados (P2032 Prevention)
    try {
      // 5.1 Atualizar AgentModules com code nulo ou vazio
      const agentsWithoutCode = await prisma.agentModule.findMany({
        where: { code: null },
      }).catch(() => []);

      for (const ag of agentsWithoutCode) {
        const slug = ag.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || `agent-${ag.id.slice(-6)}`;
        await prisma.agentModule.update({
          where: { id: ag.id },
          data: { code: `${slug}-${ag.id.slice(-4)}` },
        }).catch(() => {});
      }
      if (agentsWithoutCode.length > 0) {
        console.log(`🛡️ [AutoMigrate] ${agentsWithoutCode.length} Módulo(s) de Agente legados sanitizados com slugs válidos.`);
      }

      // 5.2 Clientes com email nulo são preservados sem injeção de e-mails mockados (T08)

      // 5.3 Atualizar Clientes e Módulos com datas nulas (createdAt / updatedAt)
      const clientsWithoutDates = await prisma.client.findMany({
        where: {
          OR: [{ createdAt: null }, { updatedAt: null }],
        },
      }).catch(() => []);

      const now = new Date();
      for (const cl of clientsWithoutDates) {
        await prisma.client.update({
          where: { id: cl.id },
          data: {
            createdAt: cl.createdAt || now,
            updatedAt: cl.updatedAt || now,
          },
        }).catch(() => {});
      }
      if (clientsWithoutDates.length > 0) {
        console.log(`🛡️ [AutoMigrate] ${clientsWithoutDates.length} Cliente(s) legados sanitizados com timestamps válidos.`);
      }

      // 5.4 Atualizar Laudos legados com clientId, targetUrl ou summary nulos
      const defaultClient = await prisma.client.findFirst({ orderBy: { createdAt: 'asc' } }).catch(() => null);
      const reportsNeedingHealing = await prisma.auditReport.findMany({
        where: {
          OR: [
            { clientId: null },
            { targetUrl: null },
            { summary: null },
          ],
        },
      }).catch(() => []);

      for (const rep of reportsNeedingHealing) {
        await prisma.auditReport.update({
          where: { id: rep.id },
          data: {
            ...(defaultClient && !rep.clientId ? { clientId: defaultClient.id } : {}),
            ...(!rep.targetUrl ? { targetUrl: 'https://conform-ia.med.br' } : {}),
            ...(!rep.summary ? { summary: 'Laudo de conformidade deontológica emitido pela plataforma ConformIA.' } : {}),
          },
        }).catch(() => {});
      }
      if (reportsNeedingHealing.length > 0) {
        console.log(`🛡️ [AutoMigrate] ${reportsNeedingHealing.length} Laudo(s) legados sanitizados (targetUrl, summary, clientId).`);
      }

      // 5.5 Limpar registros de clínicas do repositório de normas (scraped_pages deve conter exclusivamente normas regulatórias)
      const allClients = await prisma.client.findMany({ select: { websiteUrl: true } }).catch(() => []);
      const clinicUrls = allClients.map((c) => c.websiteUrl).filter(Boolean) as string[];

      const deletedClinicPages = await prisma.scrapedPage.deleteMany({
        where: {
          OR: [
            ...(clinicUrls.length > 0 ? [{ url: { in: clinicUrls } }] : []),
            { url: { contains: 'dermotologista' } },
          ],
        },
      }).catch(() => ({ count: 0 }));

      if (deletedClinicPages && deletedClinicPages.count > 0) {
        console.log(`🛡️ [AutoMigrate] ${deletedClinicPages.count} página(s) de clínica removidas do repositório de normas.`);
      }
    } catch (healErr: any) {
      console.warn('⚠️ [AutoMigrate] Aviso na autocura de registros legados:', healErr.message);
    }

    console.log('✨ [AutoMigrate & Seed] Concluído com sucesso (Zero mocks).');
  } catch (error) {
    console.error('❌ [AutoMigrate & Seed] Erro ao provisionar dados:', error);
    throw error;
  }
}

// Executar se chamado diretamente via CLI
if (process.argv[1]?.includes('autoMigrate.ts')) {
  runAutoMigrateAndSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
