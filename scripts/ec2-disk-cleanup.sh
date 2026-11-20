#!/usr/bin/env bash
# ==============================================================================
# Conform.AI Health - Script de Limpeza e Manutenção de Disco do Docker na EC2
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo "🧹 [ConformIA] Iniciando Manutenção e Limpeza de Disco..."
echo "=========================================================="

echo "📊 [1/5] Estado atual do disco e Docker:"
df -h /
docker system df || true

echo "🗑️ [2/5] Removendo contêineres parados e mortos..."
docker container prune -f || true

echo "🗑️ [3/5] Removendo todas as imagens antigas e não utilizadas (dangling & unreferenced)..."
docker image prune -af || true

echo "🗑️ [4/5] Removendo volumes anônimos órfãos não associados a contêineres ativos..."
docker volume prune -f || true

echo "🗑️ [5/5] Purgando caches do buildkit e redes não utilizadas..."
docker builder prune -af || true
docker network prune -f || true

# Truncar logs de contêineres com mais de 50MB se existirem
if [ -d "/var/lib/docker/containers" ]; then
    echo "📋 Verificando logs gigantes de contêineres..."
    find /var/lib/docker/containers/ -name "*-json.log" -size +50M -exec truncate -s 0 {} + 2>/dev/null || true
fi

echo "=========================================================="
echo "✅ [ConformIA] Limpeza concluída com sucesso!"
echo "📊 Estado final do disco:"
df -h /
docker system df || true
echo "=========================================================="
