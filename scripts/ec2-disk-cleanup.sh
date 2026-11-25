#!/usr/bin/env bash
# ==============================================================================
# Conform.AI Health - Limpeza Segura de Disco com Retenção de Releases (EC2)
# Preserva obrigatoriamente as últimas N versões (default: 3) + versão atual e
# anterior para garantir rollback imediato, e nunca trunca logs ativos.
# ==============================================================================
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/conformia}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
CURRENT_VERSION=""
PREVIOUS_VERSION=""

if [ -f "${DEPLOY_DIR}/.current_version" ]; then
  CURRENT_VERSION="$(tr -d '[:space:]' < "${DEPLOY_DIR}/.current_version" || true)"
fi
if [ -f "${DEPLOY_DIR}/.previous_version" ]; then
  PREVIOUS_VERSION="$(tr -d '[:space:]' < "${DEPLOY_DIR}/.previous_version" || true)"
fi

echo "=========================================================="
echo "🧹 [ConformIA] Iniciando Manutenção Segura de Disco..."
echo "📌 Versão atual protegida: ${CURRENT_VERSION:-nenhuma}"
echo "📌 Versão anterior protegida (rollback): ${PREVIOUS_VERSION:-nenhuma}"
echo "📦 Retenção de imagens por repositório: últimas ${KEEP_RELEASES} releases"
echo "=========================================================="

echo "📊 [1/4] Estado atual do disco e Docker:"
df -h /
docker system df || true

echo "🗑️ [2/4] Removendo contêineres finalizados e imagens dangling (<none>)..."
docker container prune -f || true
docker image prune -f || true

echo "🗑️ [3/4] Aplicando política de retenção das últimas ${KEEP_RELEASES} releases por imagem..."
cleanup_repo_images() {
  local repo="$1"
  local kept=0
  # Lista tags ordenadas da mais recente para a mais antiga
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local ref tag
    ref="$(echo "$line" | awk '{print $1}')"
    tag="${ref##*:}"

    if [ "$tag" = "<none>" ] || [ -z "$tag" ]; then
      continue
    fi

    # Nunca remover a versão atual nem a versão anterior de rollback
    if [ -n "$CURRENT_VERSION" ] && [ "$tag" = "$CURRENT_VERSION" ]; then
      echo "🛡️ Mantendo versão atual: $ref"
      continue
    fi
    if [ -n "$PREVIOUS_VERSION" ] && [ "$tag" = "$PREVIOUS_VERSION" ]; then
      echo "🛡️ Mantendo versão anterior (rollback): $ref"
      continue
    fi

    kept=$((kept + 1))
    if [ "$kept" -le "$KEEP_RELEASES" ]; then
      echo "🛡️ Mantendo release recente ($kept/${KEEP_RELEASES}): $ref"
    else
      echo "🗑️ Removendo release antiga excedente: $ref"
      docker rmi "$ref" || true
    fi
  done < <(docker images --format "{{.Repository}}:{{.Tag}} {{.CreatedAt}}" "$repo" 2>/dev/null || true)
}

# Descobre dinamicamente os repositórios dashboard-api e dashboard-web presentes no host
for repo in $(docker images --format "{{.Repository}}" | grep -E "conform-ai-health/(dashboard-api|dashboard-web)$" | sort -u || true); do
  cleanup_repo_images "$repo"
done

echo "🗑️ [4/4] Limpando cache antigo de buildkit (> 72h) e redes órfãs (volumes preservados)..."
docker builder prune -f --filter "until=72h" || true
docker network prune -f || true

# Nota de Compliance: a rotação de logs é gerenciada nativamente pelo Docker
# (driver json-file max-size=20m max-file=5). Nunca truncar logs em uso.

echo "=========================================================="
echo "✅ [ConformIA] Manutenção concluída com sucesso!"
echo "📊 Estado final do disco:"
df -h /
docker system df || true
echo "=========================================================="
