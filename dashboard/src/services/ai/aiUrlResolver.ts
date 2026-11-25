import fs from 'fs';
import { env } from '../../config/env.js';

/**
 * Normaliza URL garantindo protocolo http:// ou https://
 */
function normalizeUrlProtocol(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

/**
 * Resolve a URL base para conexão com o Ollama com a seguinte ordem de precedência:
 * 1. Se OLLAMA_HOST ou OLLAMA_BASE_URL estiver explicitamente definido no ambiente (.env)
 *    com um IP ou host específico (ex: servidor remoto, VPN ou Tailscale),
 *    ele prevalece sobre o valor padrão de localhost/host.docker.internal gravado no MongoDB.
 * 2. Se o modelo no MongoDB tiver uma URL customizada própria (diferente de localhost/host.docker.internal/0.0.0.0), usa a do modelo.
 * 3. Se estiver rodando dentro do contêiner Docker e a URL apontar para localhost/127.0.0.1/0.0.0.0, faz o fallback para host.docker.internal.
 */
export function resolveOllamaBaseUrl(configuredUrl?: string | null): string {
  const rawEnv = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || env.OLLAMA_HOST || env.OLLAMA_BASE_URL;
  const envUrl = rawEnv && rawEnv.trim() ? normalizeUrlProtocol(rawEnv) : '';

  const isCustomEnv =
    Boolean(envUrl) &&
    !envUrl.includes('localhost') &&
    !envUrl.includes('127.0.0.1') &&
    !envUrl.includes('0.0.0.0') &&
    !envUrl.includes('host.docker.internal');

  const isDbUrlDefaultOrLocalhost =
    !configuredUrl ||
    configuredUrl.includes('localhost') ||
    configuredUrl.includes('127.0.0.1') ||
    configuredUrl.includes('0.0.0.0') ||
    configuredUrl.includes('host.docker.internal');

  // Se o administrador configurou OLLAMA_HOST dedicado no servidor e o banco tem apenas localhost/default
  if (isCustomEnv && isDbUrlDefaultOrLocalhost) {
    return envUrl;
  }

  // Se o modelo no banco possui uma URL customizada válida
  if (configuredUrl && !isDbUrlDefaultOrLocalhost) {
    return normalizeUrlProtocol(configuredUrl);
  }

  const url = (configuredUrl && normalizeUrlProtocol(configuredUrl)) || envUrl || 'http://localhost:11434';

  const isInsideDocker =
    fs.existsSync('/.dockerenv') ||
    process.env.IS_DOCKER === 'true';

  if (isInsideDocker && (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0'))) {
    if (isCustomEnv) {
      return envUrl;
    }
    return url
      .replace('localhost', 'host.docker.internal')
      .replace('127.0.0.1', 'host.docker.internal')
      .replace('0.0.0.0', 'host.docker.internal');
  }

  return url;
}
