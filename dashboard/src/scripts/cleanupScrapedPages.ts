import fs from 'fs';
import path from 'path';
import { prisma } from '../config/prisma.js';

export interface CleanupOptions {
  dryRun?: boolean;
  backup?: boolean;
  backupDir?: string;
}

/**
 * T27: Script isolado de higienização de páginas scraped indevidas no repositório de normas
 * Não executa destrutivamente a cada boot; suporta dry-run e backup prévio de segurança.
 */
export async function executeScrapedPagesCleanup(options: CleanupOptions = {}): Promise<{
  candidatesCount: number;
  deletedCount: number;
  backupFile?: string;
}> {
  const { dryRun = false, backup = true, backupDir = './backups' } = options;

  console.log(`🧹 [Cleanup CLI] Iniciando análise de páginas de clínicas na coleção 'scraped_pages'... (Modo: ${dryRun ? 'DRY-RUN' : 'EXECUÇÃO REAL'})`);

  const allClients = await prisma.client.findMany({ select: { websiteUrl: true } });
  const clinicUrls = allClients.map((c) => c.websiteUrl).filter(Boolean) as string[];

  const queryWhere = {
    OR: [
      ...(clinicUrls.length > 0 ? [{ url: { in: clinicUrls } }] : []),
      { url: { contains: 'dermotologista' } },
    ],
  };

  const candidates = await prisma.scrapedPage.findMany({
    where: queryWhere,
  });

  const candidatesCount = candidates.length;
  console.log(`🔍 [Cleanup CLI] ${candidatesCount} página(s) candidata(s) a expurgo encontradas.`);

  if (candidatesCount === 0) {
    return { candidatesCount: 0, deletedCount: 0 };
  }

  let backupFile: string | undefined;
  if (backup && candidatesCount > 0) {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupFile = path.join(backupDir, `scraped_pages_backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(candidates, null, 2), 'utf-8');
    console.log(`💾 [Cleanup CLI] Backup prévio gerado com sucesso em: ${backupFile}`);
  }

  if (dryRun) {
    console.log(`ℹ️ [Cleanup CLI] Dry-run ativado. Nenhuma alteração foi persistida no MongoDB.`);
    return { candidatesCount, deletedCount: 0, backupFile };
  }

  const deleteResult = await prisma.scrapedPage.deleteMany({
    where: queryWhere,
  });

  console.log(`✅ [Cleanup CLI] ${deleteResult.count} página(s) removida(s) com sucesso.`);
  return { candidatesCount, deletedCount: deleteResult.count, backupFile };
}

// Execução direta via CLI se chamado via script de comando
if (process.argv[1] && process.argv[1].includes('cleanupScrapedPages')) {
  const isDryRun = process.argv.includes('--dry-run');
  const noBackup = process.argv.includes('--no-backup');

  executeScrapedPagesCleanup({ dryRun: isDryRun, backup: !noBackup })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ [Cleanup CLI] Erro fatal:', err.message);
      process.exit(1);
    });
}
