import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';

export async function runAutoMigrateAndSeed() {
  console.log('🌱 [AutoMigrate & Seed] Iniciando verificação e carga de dados padrão...');

  try {
    // 1. Criar ou Obter Cliente Modelo Sintético
    let demoClient = await prisma.client.findFirst({
      where: { email: 'contato@dermatosaude.med.br' },
    });

    if (!demoClient) {
      demoClient = await prisma.client.create({
        data: {
          name: 'Clínica Dermatológica Pele & Saúde Digital Ltda',
          tradeName: 'Pele & Saúde Digital',
          cnpj: '12.345.678/0001-90',
          crmResponsavel: '123456',
          crmUf: 'SP',
          rqeResponsavel: '98765',
          especialidade: 'Dermatologia',
          websiteUrl: 'https://exemplo-clinica-saude-sintetica.med.br',
          instagramHandle: '@clinica.pelesaudedigital',
          status: 'ATIVO',
          phone: '(11) 98765-4321',
          email: 'contato@dermatosaude.med.br',
        },
      });
      console.log(`✅ [Seed] Cliente modelo criado: ${demoClient.name} (ID: ${demoClient.id})`);
    }

    // 2. Hash seguro das senhas
    const saltRounds = 12;
    const adminPasswordHash = await bcrypt.hash('Admin@2026', saltRounds);
    const auditorPasswordHash = await bcrypt.hash('Auditor@2026', saltRounds);
    const clientPasswordHash = await bcrypt.hash('Cliente@2026', saltRounds);

    // 3. Usuário Administrador
    await prisma.user.upsert({
      where: { email: 'admin@conformia.med.br' },
      update: {
        name: 'Administrador Master ConformIA',
        role: 'ADMIN',
      },
      create: {
        email: 'admin@conformia.med.br',
        passwordHash: adminPasswordHash,
        name: 'Administrador Master ConformIA',
        role: 'ADMIN',
      },
    });
    console.log('✅ [Seed] Usuário ADMIN pronto: admin@conformia.med.br');

    // 4. Usuário Auditor
    await prisma.user.upsert({
      where: { email: 'auditor@conformia.med.br' },
      update: {
        name: 'Auditor Deontológico Sênior',
        role: 'AUDITOR',
      },
      create: {
        email: 'auditor@conformia.med.br',
        passwordHash: auditorPasswordHash,
        name: 'Auditor Deontológico Sênior',
        role: 'AUDITOR',
      },
    });
    console.log('✅ [Seed] Usuário AUDITOR pronto: auditor@conformia.med.br');

    // 5. Usuário Cliente (Vinculado ao tenant da clínica)
    await prisma.user.upsert({
      where: { email: 'clinica@dermato.med.br' },
      update: {
        name: 'Dra. Mariana Santos (Responsável Técnica)',
        role: 'CLIENT',
        clientId: demoClient.id,
      },
      create: {
        email: 'clinica@dermato.med.br',
        passwordHash: clientPasswordHash,
        name: 'Dra. Mariana Santos (Responsável Técnica)',
        role: 'CLIENT',
        clientId: demoClient.id,
      },
    });
    console.log('✅ [Seed] Usuário CLIENT pronto: clinica@dermato.med.br (Isolado no Tenant)');

    // 6. Módulos de Agente Regulatórios
    const defaultModules = [
      {
        code: 'CFM-2336-PUBLICIDADE',
        name: 'Auditor de Publicidade Médica (CFM nº 2.336/2023)',
        description: 'Verificação contínua de CRM/RQE, proibição de promessa de resultado, antes/depois educativo e mercantilização.',
        category: 'DEONTOLOGIA_MEDICA',
        rulesCount: 18,
        extractionMode: 'CHEERIO' as const,
      },
      {
        code: 'LGPD-SAUDE-ART11',
        name: 'Guardião de Privacidade em Saúde (LGPD Art. 11)',
        description: 'Auditoria de formulários de agendamento online, proteção de dados biométricos e consentimento explícito.',
        category: 'PRIVACIDADE_DADOS',
        rulesCount: 12,
        extractionMode: 'CHEERIO' as const,
      },
      {
        code: 'ANS-TRANSPARENCIA-509',
        name: 'Conformidade Regulatória ANS (RN 509/2022)',
        description: 'Verificação de clareza em redes credenciadas, carências contratuais e ouvidoria acessível.',
        category: 'SAUDE_SUPLEMENTAR',
        rulesCount: 9,
        extractionMode: 'PUPPETEER' as const,
      },
      {
        code: 'ANVISA-PROPAGANDA-727',
        name: 'Vigilância Sanitária e Produtos (RDC 727/2022)',
        description: 'Proibição de propaganda direta de fármacos sob prescrição ao público leigo e alegações terapêuticas enganosas.',
        category: 'VIGILANCIA_SANITARIA',
        rulesCount: 14,
        extractionMode: 'CHEERIO' as const,
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
        },
        create: {
          code: mod.code,
          name: mod.name,
          description: mod.description,
          category: mod.category,
          rulesCount: mod.rulesCount,
          extractionMode: mod.extractionMode,
        },
      });
    }
    console.log(`✅ [Seed] ${defaultModules.length} Módulos de Agente configurados.`);

    // 7. Definição do Agente de Deontologia
    await prisma.agentDefinition.upsert({
      where: { name: 'CFM_DEONTOLOGY_AUDITOR_V1' },
      update: {
        systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista na Resolução CFM nº 2.336/2023...',
        targetNorm: 'Resolução CFM nº 2.336/2023, ANS RN 509 e LGPD Art. 11',
      },
      create: {
        name: 'CFM_DEONTOLOGY_AUDITOR_V1',
        systemPrompt: 'Você é o Auditor Deontológico da ConformIA, especialista na Resolução CFM nº 2.336/2023...',
        targetNorm: 'Resolução CFM nº 2.336/2023, ANS RN 509 e LGPD Art. 11',
        defaultMode: 'CHEERIO',
        temperature: 0.1,
      },
    });
    console.log('✅ [Seed] Definição de Agente pronta.');

    console.log('✨ [AutoMigrate & Seed] Concluído com sucesso!');
  } catch (error) {
    console.error('❌ [AutoMigrate & Seed] Erro ao executar migração/seed:', error);
    throw error;
  }
}

// Executar se chamado diretamente
if (process.argv[1]?.includes('autoMigrate.ts')) {
  runAutoMigrateAndSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

