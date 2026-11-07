import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';

export async function runAutoMigrateAndSeed() {
  console.log('🌱 [AutoMigrate & Seed] Verificando e provisionando administrador e módulos oficiais...');

  try {
    // 1. Usuário Administrador Oficial (lido das variáveis de ambiente reais)
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@conform.ai';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';
    const saltRounds = 12;
    const adminPasswordHash = await bcrypt.hash(adminPassword, saltRounds);

    // Auto-recuperação resiliente para documentos corrompidos ou legados do MongoDB
    let user = null;
    try {
      user = await prisma.user.findUnique({ where: { email: adminEmail } });
    } catch {
      console.log('⚠️ [Seed] Detectado usuário com tipos legados incompatíveis no Mongo. Limpando registro corrompido...');
      try {
        await prisma.$runCommandRaw({
          delete: 'users',
          deletes: [{ q: { email: adminEmail }, limit: 0 }],
        });
      } catch {
        // Continua
      }
    }

    if (!user) {
      await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash: adminPasswordHash,
          name: 'Administrador ConformIA',
          role: 'ADMIN',
        },
      });
    } else {
      await prisma.user.update({
        where: { email: adminEmail },
        data: {
          name: 'Administrador ConformIA',
          role: 'ADMIN',
          passwordHash: adminPasswordHash,
        },
      });
    }
    console.log(`✅ [Seed] Administrador oficial ativo: ${adminEmail}`);

    // 2. Módulos Oficiais de Auditoria Deontológica & Sanitária
    const defaultModules = [
      {
        code: 'CFM-2336-PUBLICIDADE',
        name: 'Auditor de Publicidade Médica (CFM nº)',
        description: 'Verificação contínua de CRM/RQE, proibição de promessa de resultado, antes/depois educativo e mercantilização.',
        category: 'DEONTOLOGIA_MEDICA',
        rulesCount: 18,
        extractionMode: 'CHEERIO' as const,
        tags: ['CFM'],
        targetNorms: ['CFM-2336-ART-01', 'CFM-2336-ART-02', 'CFM-2336-ART-03', 'CFM-2336-ART-04', 'CFM-2336-ART-05'],
      },
      {
        code: 'LGPD-SAUDE-ART11',
        name: 'Guardião de Privacidade em Saúde (LGPD Art. 11)',
        description: 'Auditoria de formulários de agendamento online, proteção de dados biométricos e consentimento explícito.',
        category: 'PRIVACIDADE_DADOS',
        rulesCount: 12,
        extractionMode: 'CHEERIO' as const,
        tags: ['LGPD'],
        targetNorms: ['LGPD-SAUDE-ART-11'],
      },
      {
        code: 'ANS-TRANSPARENCIA-509',
        name: 'Conformidade Regulatória ANS (RN 509/2022)',
        description: 'Verificação de clareza em redes credenciadas, carências contratuais e ouvidoria acessível.',
        category: 'SAUDE_SUPLEMENTAR',
        rulesCount: 9,
        extractionMode: 'PUPPETEER' as const,
        tags: ['ANS'],
        targetNorms: ['ANS-RN-509-395'],
      },
      {
        code: 'ANVISA-PROPAGANDA-727',
        name: 'Vigilância Sanitária e Produtos (RDC 727/2022)',
        description: 'Proibição de propaganda direta de fármacos sob prescrição ao público leigo e alegações terapêuticas enganosas.',
        category: 'VIGILANCIA_SANITARIA',
        rulesCount: 14,
        extractionMode: 'CHEERIO' as const,
        tags: ['ANVISA'],
        targetNorms: ['ANVISA-RDC-727'],
      },
    ];

    for (const mod of defaultModules) {
      await prisma.agentModule.upsert({
        where: { code: mod.code },
        update: {
          name: mod.name,
          description: mod.description,
          category: mod.category,
          rulesCount: mod.rulesCount,
          extractionMode: mod.extractionMode,
          tags: mod.tags,
          targetNorms: mod.targetNorms,
        },
        create: {
          code: mod.code,
          name: mod.name,
          description: mod.description,
          category: mod.category,
          rulesCount: mod.rulesCount,
          extractionMode: mod.extractionMode,
          tags: mod.tags,
          targetNorms: mod.targetNorms,
        },
      });
    }
    console.log(`✅ [Seed] ${defaultModules.length} Módulos Regulatórios Oficiais provisionados.`);

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
            name: 'Google Gemini 2.0 Flash',
            provider: 'gemini',
            modelId: 'gemini-2.0-flash',
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

      // 5.2 Atualizar Clientes com email nulo ou vazio
      const clientsWithoutEmail = await prisma.client.findMany({
        where: { email: null },
      }).catch(() => []);

      for (const cl of clientsWithoutEmail) {
        await prisma.client.update({
          where: { id: cl.id },
          data: { email: 'contato@clinica.com' },
        }).catch(() => {});
      }
      if (clientsWithoutEmail.length > 0) {
        console.log(`🛡️ [AutoMigrate] ${clientsWithoutEmail.length} Cliente(s) legados sanitizados com e-mail de contato.`);
      }

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
