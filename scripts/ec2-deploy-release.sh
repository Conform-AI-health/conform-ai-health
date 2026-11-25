#!/usr/bin/env bash
# ==============================================================================
# Conform.AI Health - Script Idempotente de Deploy e Rollback por Versão Imutável
# - Proíbe deploys usando tag :latest ou :dev
# - Registra .current_version, .previous_version e trilha auditável releases.log
# - Executa rollback automático se o healthcheck da API ou do Worker falhar
# ==============================================================================
set -euo pipefail

DEPLOY_ENV="${DEPLOY_ENV:-production}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/conformia}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-conformia}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
ACTION="${ACTION:-DEPLOY}"
DEPLOY_ACTOR="${DEPLOY_ACTOR:-ci-automation}"
DEPLOY_REASON="${DEPLOY_REASON:-Automated release deployment}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3333/health}"
WORKER_HEALTH_URL="${WORKER_HEALTH_URL:-http://127.0.0.1:3001/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-12}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-3}"

TARGET_VERSION="${APP_VERSION:-}"

if [ -z "$TARGET_VERSION" ] || [ "$TARGET_VERSION" = "latest" ] || [ "$TARGET_VERSION" = "dev" ]; then
  echo "❌ [ERRO DE COMPLIANCE] APP_VERSION inválida ('${TARGET_VERSION}'). Utilize uma tag imutável (ex: sha-abc1234 ou v1.2.3). Deploy abortado."
  exit 1
fi

mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

CURRENT_FILE="${DEPLOY_DIR}/.current_version"
PREVIOUS_FILE="${DEPLOY_DIR}/.previous_version"
RELEASES_LOG="${DEPLOY_DIR}/releases.log"

PREVIOUS_VERSION=""
if [ -f "$CURRENT_FILE" ]; then
  PREVIOUS_VERSION="$(tr -d '[:space:]' < "$CURRENT_FILE" || true)"
fi

if [ "$TARGET_VERSION" = "previous" ]; then
  TARGET_VERSION=""
  if [ -f "$PREVIOUS_FILE" ]; then
    TARGET_VERSION="$(tr -d '[:space:]' < "$PREVIOUS_FILE" || true)"
  fi
  if [ -z "$TARGET_VERSION" ] || [ "$TARGET_VERSION" = "latest" ] || [ "$TARGET_VERSION" = "dev" ]; then
    echo "❌ Nenhuma versão anterior válida encontrada em ${PREVIOUS_FILE} para rollback."
    exit 1
  fi
fi

log_release_event() {
  local status="$1"
  local version="$2"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '%s env=%s action=%s status=%s version=%s previous=%s actor="%s" reason="%s"\n' \
    "$timestamp" "$DEPLOY_ENV" "$ACTION" "$status" "$version" "${PREVIOUS_VERSION:-none}" "$DEPLOY_ACTOR" "$DEPLOY_REASON" >> "$RELEASES_LOG"
}

run_compose() {
  local ver="$1"
  shift
  # shellcheck disable=SC2086
  APP_VERSION="$ver" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" docker compose $COMPOSE_FILES "$@"
}

verify_health() {
  local expected_ver="$1"
  local i=1
  while [ "$i" -le "$HEALTH_ATTEMPTS" ]; do
    local api_body=""
    if api_body="$(curl -fsS --max-time 5 "$API_HEALTH_URL" 2>/dev/null)"; then
      local worker_code
      worker_code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$WORKER_HEALTH_URL" 2>/dev/null || echo "000")"
      if [ "$worker_code" = "200" ]; then
        # Verifica se /health reporta a versão esperada (quando disponível no JSON)
        if echo "$api_body" | grep -q "\"status\":\"UP\""; then
          if echo "$api_body" | grep -q "\"version\"" && ! echo "$api_body" | grep -q "\"version\":\"${expected_ver}\""; then
            echo "⏳ Tentativa $i/${HEALTH_ATTEMPTS}: API respondeu UP, aguardando convergência da versão ${expected_ver}..."
          else
            echo "✅ Healthcheck validado (API UP + Worker HTTP ${worker_code}) para versão ${expected_ver}!"
            return 0
          fi
        fi
      fi
    fi
    echo "⏳ Aguardando inicialização saudável (${i}/${HEALTH_ATTEMPTS})..."
    sleep "$HEALTH_INTERVAL_SECONDS"
    i=$((i + 1))
  done
  return 1
}

echo "=========================================================="
echo "🚀 [ConformIA] ${ACTION} iniciado em ${DEPLOY_ENV}"
echo "📌 Versão alvo: ${TARGET_VERSION}"
echo "📌 Versão anterior: ${PREVIOUS_VERSION:-nenhuma}"
echo "👤 Ator: ${DEPLOY_ACTOR} | Motivo: ${DEPLOY_REASON}"
echo "=========================================================="

echo "📥 [1/4] Baixando imagens imutáveis (${TARGET_VERSION})..."
run_compose "$TARGET_VERSION" pull

echo "🔄 [2/4] Atualizando containers sem recriar estado persistido..."
run_compose "$TARGET_VERSION" up -d --remove-orphans

echo "🩺 [3/4] Executando healthchecks de API e Worker..."
if verify_health "$TARGET_VERSION"; then
  if [ -n "$PREVIOUS_VERSION" ] && [ "$PREVIOUS_VERSION" != "$TARGET_VERSION" ]; then
    echo "$PREVIOUS_VERSION" > "$PREVIOUS_FILE"
  fi
  echo "$TARGET_VERSION" > "$CURRENT_FILE"
  log_release_event "SUCCESS" "$TARGET_VERSION"

  echo "🧹 [4/4] Executando limpeza segura com retenção de releases..."
  if [ -f "${DEPLOY_DIR}/scripts/ec2-disk-cleanup.sh" ]; then
    chmod +x "${DEPLOY_DIR}/scripts/ec2-disk-cleanup.sh"
    DEPLOY_DIR="$DEPLOY_DIR" KEEP_RELEASES=3 "${DEPLOY_DIR}/scripts/ec2-disk-cleanup.sh" || true
  elif [ -f "${DEPLOY_DIR}/ec2-disk-cleanup.sh" ]; then
    chmod +x "${DEPLOY_DIR}/ec2-disk-cleanup.sh"
    DEPLOY_DIR="$DEPLOY_DIR" KEEP_RELEASES=3 "${DEPLOY_DIR}/ec2-disk-cleanup.sh" || true
  fi

  echo "✅ ${ACTION} da versão ${TARGET_VERSION} concluído com sucesso!"
  exit 0
fi

echo "❌ Healthcheck falhou para a versão ${TARGET_VERSION}. Últimos logs:"
run_compose "$TARGET_VERSION" logs --tail=60 dashboard-api audit-worker || true
log_release_event "FAILED" "$TARGET_VERSION"

if [ -n "$PREVIOUS_VERSION" ] && [ "$PREVIOUS_VERSION" != "$TARGET_VERSION" ]; then
  echo "⏪ [AUTO-ROLLBACK] Revertendo imediatamente para a versão estável anterior: ${PREVIOUS_VERSION}..."
  run_compose "$PREVIOUS_VERSION" up -d --remove-orphans
  if verify_health "$PREVIOUS_VERSION"; then
    echo "$PREVIOUS_VERSION" > "$CURRENT_FILE"
    log_release_event "AUTO_ROLLBACK_SUCCESS" "$PREVIOUS_VERSION"
    echo "✅ Auto-rollback para ${PREVIOUS_VERSION} concluído com sistema saudável."
  else
    log_release_event "AUTO_ROLLBACK_FAILED" "$PREVIOUS_VERSION"
    echo "🚨 Falha crítica também no auto-rollback para ${PREVIOUS_VERSION}!"
  fi
else
  echo "⚠️ Nenhuma versão anterior distinta disponível para rollback automático."
fi

exit 1
