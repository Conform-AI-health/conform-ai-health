import fs from 'fs';
import path from 'path';
import { prisma } from '../config/prisma.js';
import { DeontologicalTaxonomyService, TaxonomyInferenceInput } from '../services/deontologicalTaxonomyService.js';
import { OllamaTaxonomyService } from '../services/ollamaTaxonomyService.js';

interface CliOptions {
  normCode?: string;
  filePath?: string;
  all: boolean;
  apply: boolean;
  verbose: boolean;
  useOllama: boolean;
  saveJson?: string;
  clean: boolean;
  limit?: number;
  concurrency: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let normCode: string | undefined;
  let filePath: string | undefined;
  let all = false;
  let apply = false;
  let verbose = false;
  let useOllama = false;
  let saveJson: string | undefined;
  let clean = false;
  let limit: number | undefined;
  let concurrency = 15;

  for (const arg of args) {
    if (arg === '--all' || arg === '-a') {
      all = true;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--clean' || arg === '--recalc' || arg === '--force') {
      clean = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--ollama') {
      useOllama = true;
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1].trim(), 10);
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.split('=')[1].trim(), 10);
    } else if (arg.startsWith('--file=')) {
      filePath = arg.split('=')[1].trim();
    } else if (arg.startsWith('--save-json=') || arg.startsWith('--output=')) {
      saveJson = arg.split('=')[1].trim();
    } else if (arg.startsWith('--norm=')) {
      normCode = arg.split('=')[1].trim();
    } else if (!arg.startsWith('-')) {
      if (fs.existsSync(arg.trim())) {
        filePath = arg.trim();
      } else {
        normCode = arg.trim();
      }
    }
  }

  if (!normCode && !filePath && !all) {
    normCode = 'CFM-RES-2473-2026';
  }

  return { normCode, filePath, all, apply, verbose, useOllama, saveJson, clean, limit, concurrency };
}

function loadInputFromFile(filePath: string): TaxonomyInferenceInput {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo não encontrado no caminho: ${absolutePath}`);
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf-8');
  const fileExt = path.extname(absolutePath).toLowerCase();
  const baseName = path.basename(absolutePath, fileExt);

  if (fileExt === '.json') {
    try {
      const parsed = JSON.parse(fileContent);
      return {
        normId: parsed.normId || parsed.id || baseName,
        orgao: parsed.orgao || parsed.jurisdiction || 'CFM',
        tipo: parsed.tipo || parsed.normType || 'RESOLUCAO',
        numero: parsed.numero || '',
        ano: parsed.ano || '',
        ementa: parsed.ementa || parsed.ementaHigienizada || parsed.summary || '',
        content: parsed.content || parsed.cleanMarkdown || parsed.text || '',
        currentTags: Array.isArray(parsed.tags) ? parsed.tags : [],
        status: parsed.status || 'VIGENTE',
      };
    } catch {
      throw new Error(`Falha ao ler o formato JSON do arquivo: ${absolutePath}`);
    }
  }

  // Se for Markdown (.md) ou Texto (.txt)
  let ementa = '';
  let content = fileContent;

  // Tenta extrair ementa inicial se estiver marcada no Markdown
  const ementaMatch = fileContent.match(/(?:Ementa:|EMENTA:|\*\*Ementa:\*\*)\s*([^\n\r]+(?:\n[^\n\r#]+)?)/i);
  if (ementaMatch) {
    ementa = ementaMatch[1].trim();
  } else {
    // Primeiros 300 caracteres como ementa sintética
    ementa = fileContent.slice(0, 300).replace(/[#*`_]/g, ' ').trim();
  }

  return {
    normId: baseName,
    orgao: baseName.includes('CFM') ? 'CFM' : baseName.includes('CFO') ? 'CFO' : baseName.includes('ANVISA') ? 'ANVISA' : baseName.includes('ANS') ? 'ANS' : baseName.includes('LGPD') ? 'LGPD' : 'CFM',
    tipo: baseName.includes('RES') ? 'RESOLUCAO' : baseName.includes('RDC') ? 'RDC' : baseName.includes('LEI') ? 'LEI' : 'RESOLUCAO',
    ementa,
    content,
    currentTags: [],
    status: /revogada/i.test(fileContent) ? 'REVOGADA' : 'VIGENTE',
  };
}

async function main() {
  const options = parseArgs();

  console.log('='.repeat(78));
  console.log('⚖️  CLASSIFICADOR DE TAXONOMIA DEONTOLÓGICA & ENRIQUECIMENTO DE TAGS');
  console.log(`Modo de Execução: ${options.apply ? '🔴 APLICAR NO BANCO (PERSISTÊNCIA ATIVA)' : '🟡 SIMULAÇÃO DRY-RUN'}`);
  console.log(`Motor de Inferência: ${options.useOllama ? '🤖 LLM OLLAMA (Local AI)' : '⚡ REGRAS LÉXICAS DETERMINÍSTICAS'}`);
  if (options.filePath) {
    console.log(`Arquivo Local de Entrada: ${options.filePath}`);
  } else if (options.normCode) {
    console.log(`Filtro no Banco (normId): ${options.normCode}`);
  } else {
    console.log('Filtro no Banco: TODAS AS NORMAS DO ACERVO');
  }
  if (options.saveJson) {
    console.log(`Persistência em Arquivo JSON: ${options.saveJson}`);
  }
  console.log('='.repeat(78));

  // =========================================================================
  // CENÁRIO A: PROCESSAR UM ARQUIVO LOCAL
  // =========================================================================
  if (options.filePath) {
    try {
      const input = loadInputFromFile(options.filePath);
      console.log(`\n📄 Processando arquivo: ${options.filePath}`);
      console.log(`   NormId Detectado: ${input.normId}`);
      console.log(`   Órgão/Tipo: ${input.orgao} ${input.tipo}`);
      console.log(`   Ementa: ${(input.ementa || 'Sem ementa').slice(0, 100)}...`);

      let result: any;
      if (options.useOllama) {
        console.log('   ⏳ Consultando Ollama...');
        result = await OllamaTaxonomyService.inferTags(input);
      } else {
        result = DeontologicalTaxonomyService.inferTags(input);
      }

      console.log('-'.repeat(78));
      console.log(`   🏷️  Tags Originais (${(input.currentTags || []).length}): [ ${(input.currentTags || []).join(', ') || 'Nenhuma'} ]`);
      console.log(`   ✨ Tags Inferidas (${result.allTags.length}): [ ${result.allTags.join(', ')} ]`);
      console.log(`   🎯 Macro-Tema: ${result.macroTema}`);
      console.log(`   📌 Temáticas Específicas: [ ${result.thematicTags.join(', ') || 'Nenhuma'} ]`);
      console.log(`   ⚖️  Status de Vigência: ${result.statusTag}`);
      if (result.confidence) {
        console.log(`   🎯 Confiança: ${(result.confidence * 100).toFixed(1)}%`);
      }
      if (result.reasoning) {
        console.log(`   💡 Justificativa: ${result.reasoning}`);
      }

      // Persistência em arquivo JSON
      if (options.saveJson) {
        const outPath = path.resolve(process.cwd(), options.saveJson);
        const payload = {
          input,
          result,
          processedAt: new Date().toISOString(),
          engine: options.useOllama ? 'ollama' : 'heuristic',
        };
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
        console.log(`\n💾 Resultado gravado com sucesso no arquivo JSON: ${outPath}`);
      }

      // Persistência no MongoDB (se --apply)
      if (options.apply) {
        console.log('\n🔄 Gravando/atualizando no MongoDB...');
        const existingNorm = await prisma.norm.findFirst({
          where: { normId: { equals: input.normId, mode: 'insensitive' } },
        });

        if (existingNorm) {
          await prisma.norm.update({
            where: { id: existingNorm.id },
            data: {
              tags: result.allTags,
              macroTema: result.macroTema,
              status: result.statusTag,
            },
          });
          console.log(`   ✅ Norma [${input.normId}] ATUALIZADA no banco com sucesso.`);
        } else {
          await prisma.norm.create({
            data: {
              normId: input.normId,
              orgao: input.orgao || 'CFM',
              tipo: input.tipo || 'RESOLUCAO',
              numero: input.numero || 'S/N',
              ano: input.ano || String(new Date().getFullYear()),
              ementaHigienizada: input.ementa || '',
              conteudoOriginalBruto: input.content || '',
              conteudoHigienizado: input.content || '',
              cleanMarkdown: input.content || '',
              status: result.statusTag,
              macroTema: result.macroTema,
              tags: result.allTags,
              urlOriginal: 'file://' + path.resolve(options.filePath),
            },
          });
          console.log(`   ✅ Norma [${input.normId}] CRIADA e persistida no banco com sucesso.`);
        }
      }

      console.log('='.repeat(78));
      process.exit(0);
    } catch (err: any) {
      console.error(`\n❌ Erro ao processar o arquivo: ${err.message}`);
      process.exit(1);
    }
  }

  // =========================================================================
  // CENÁRIO B: PROCESSAR NORMAS DO BANCO DE DADOS MONGODB
  // =========================================================================
  try {
    const where: any = {};
    if (options.normCode) {
      where.normId = { contains: options.normCode, mode: 'insensitive' };
    }

    const queryArgs: any = {
      where,
      orderBy: { normId: 'asc' },
    };
    if (options.limit && options.limit > 0) {
      queryArgs.take = options.limit;
    }

    const norms = await prisma.norm.findMany(queryArgs);

    if (norms.length === 0) {
      console.log(`\n⚠️ Nenhuma norma encontrada no banco com o critério: "${options.normCode || 'all'}".`);
      console.log('DICA: Você pode rodar para um arquivo local com:');
      console.log('   npm run norms:tag -- --file=caminho/do/arquivo.md --save-json=resultado.json\n');
      process.exit(0);
    }

    console.log(`\n📚 Total de normas selecionadas para análise: ${norms.length}\n`);

    let updatedCount = 0;
    let unchangedCount = 0;
    const batchOutputs: any[] = [];
    const isBatchMode = norms.length > 5 && !options.verbose;
    const startTime = Date.now();

    // Se for modo lote (> 5 normas e não verbose), executa com concorrência otimizada
    if (isBatchMode) {
      const concurrency = options.useOllama ? 2 : Math.min(options.concurrency, 20);
      console.log(`⚡ Modo em Lote Ativado: Concorrência = ${concurrency} workers paralelos.`);
      let processed = 0;

      for (let i = 0; i < norms.length; i += concurrency) {
        const chunk = norms.slice(i, i + concurrency);

        await Promise.all(
          chunk.map(async (norm) => {
            const input: TaxonomyInferenceInput = {
              normId: norm.normId,
              orgao: norm.orgao,
              tipo: norm.tipo,
              numero: norm.numero,
              ano: norm.ano,
              ementa: norm.ementaHigienizada,
              content: norm.cleanMarkdown,
              currentTags: options.clean ? [] : norm.tags,
              status: norm.status,
            };

            let result: any;
            if (options.useOllama) {
              result = await OllamaTaxonomyService.inferTags(input);
            } else {
              result = DeontologicalTaxonomyService.inferTags(input);
            }

            const currentTagsSorted = [...norm.tags].sort();
            const newTagsSorted = [...result.allTags].sort();
            const hasChanges =
              JSON.stringify(currentTagsSorted) !== JSON.stringify(newTagsSorted) || norm.macroTema !== result.macroTema;

            if (hasChanges) {
              if (options.apply) {
                await prisma.norm.update({
                  where: { id: norm.id },
                  data: {
                    tags: result.allTags,
                    macroTema: result.macroTema,
                  },
                });
              }
              updatedCount++;
            } else {
              unchangedCount++;
            }

            if (options.saveJson) {
              batchOutputs.push({
                normId: norm.normId,
                tags: result.allTags,
                macroTema: result.macroTema,
                thematicTags: result.thematicTags,
              });
            }
          })
        );

        processed += chunk.length;
        if (processed % 100 === 0 || processed === norms.length) {
          const pct = ((processed / norms.length) * 100).toFixed(1);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`   ⏳ Progresso: [${processed}/${norms.length}] (${pct}%) — Alterações: ${updatedCount} (${elapsed}s)`);
        }
      }
    } else {
      // Modo detalhado / individual (<= 5 normas ou com --verbose)
      for (const norm of norms) {
        const input: TaxonomyInferenceInput = {
          normId: norm.normId,
          orgao: norm.orgao,
          tipo: norm.tipo,
          numero: norm.numero,
          ano: norm.ano,
          ementa: norm.ementaHigienizada,
          content: norm.cleanMarkdown,
          currentTags: options.clean ? [] : norm.tags,
          status: norm.status,
        };

        let result: any;
        if (options.useOllama) {
          result = await OllamaTaxonomyService.inferTags(input);
        } else {
          result = DeontologicalTaxonomyService.inferTags(input);
        }

        const currentTagsSorted = [...norm.tags].sort();
        const newTagsSorted = [...result.allTags].sort();
        const hasChanges =
          JSON.stringify(currentTagsSorted) !== JSON.stringify(newTagsSorted) || norm.macroTema !== result.macroTema;

        console.log('-'.repeat(78));
        console.log(`📄 Norma: [${norm.normId}] - ${norm.tipo} ${norm.numero}/${norm.ano}`);
        console.log(`   Ementa: ${(norm.ementaHigienizada || 'Sem ementa').slice(0, 100)}...`);
        console.log(`   🏷️  Tags Atuais (${norm.tags.length}): [ ${norm.tags.join(', ')} ]`);
        console.log(`   ✨ Tags Inferidas (${result.allTags.length}): [ ${result.allTags.join(', ')} ]`);
        console.log(`   🏷️  Temáticas Específicas (${result.thematicTags.length}): [ ${result.thematicTags.join(', ') || 'Nenhuma detectada'} ]`);
        console.log(`   🎯 Macro-Tema: ${result.macroTema}`);

        if (options.verbose && result.reasons && result.reasons.length > 0) {
          console.log('   🔍 Gatilhos Léxicos Detectados:');
          for (const r of result.reasons) {
            console.log(`      - ${r}`);
          }
        }

        if (hasChanges) {
          if (options.apply) {
            await prisma.norm.update({
              where: { id: norm.id },
              data: {
                tags: result.allTags,
                macroTema: result.macroTema,
              },
            });
            console.log('   ✅ ATUALIZADA NO BANCO com sucesso.');
            updatedCount++;
          } else {
            console.log('   ℹ️  [DRY-RUN] Alteração detectada (Execute com --apply para gravar no banco).');
            updatedCount++;
          }
        } else {
          console.log('   ✓ Tags já estão perfeitamente sincronizadas.');
          unchangedCount++;
        }

        if (options.saveJson) {
          batchOutputs.push({
            normId: norm.normId,
            tags: result.allTags,
            macroTema: result.macroTema,
            thematicTags: result.thematicTags,
          });
        }

        console.log('');
      }
    }

    if (options.saveJson && batchOutputs.length > 0) {
      const outPath = path.resolve(process.cwd(), options.saveJson);
      fs.writeFileSync(outPath, JSON.stringify(batchOutputs, null, 2), 'utf-8');
      console.log(`💾 Lote de resultados gravado com sucesso no arquivo JSON: ${outPath}`);
    }

    console.log('='.repeat(78));
    console.log('📊 RESUMO DO PROCESSAMENTO');
    console.log(`   - Normas avaliadas: ${norms.length}`);
    console.log(`   - Normas com novas tags ${options.apply ? 'aplicadas' : 'detectadas'}: ${updatedCount}`);
    console.log(`   - Normas inalteradas: ${unchangedCount}`);
    if (!options.apply && updatedCount > 0) {
      console.log('\n💡 DICA: Para persistir essas tags definitivamente no MongoDB, execute:');
      console.log(`   npm run norms:tag:apply -- ${options.normCode ? `--norm=${options.normCode}` : '--all'}\n`);
    }
    console.log('='.repeat(78));

    process.exit(0);
  } catch (err: any) {
    console.error(`\n❌ Erro durante o enriquecimento de tags: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
