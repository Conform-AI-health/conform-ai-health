import fs from 'fs';
import { env } from '../../config/env.js';

/**
 * Resolve a URL base para conexão com o Ollama com a seguinte ordem de precedência:
 * 1. Se OLLAMA_BASE_URL ou OLLAMA_HOST estiver explicitamente definido no ambiente
 *    com um IP ou host específico (ex: Tailscale http://100.106.169.126:11434 ou servidor externo),
 *    ele prevalece sobre o valor padrão de localhost gravado no MongoDB.
 * 2. Se o modelo no MongoDB tiver uma URL customizada própria (diferente de localhost/host.docker.internal), usa a do modelo.
 * 3. Se estiver rodando dentro do contêiner Docker e a URL apontar para localhost/127.0.0.1, faz o fallback para host.docker.internal.
 */
export function resolveOllamaBaseUrl(configuredUrl?: string | null): string {
  const envUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || env.OLLAMA_BASE_URL;

  const isCustomEnv =
    Boolean(envUrl) &&
    !envUrl.includes('localhost') &&
    !envUrl.includes('127.0.0.1') &&
    !envUrl.includes('host.docker.internal');

  const isDbUrlDefaultOrLocalhost =
    !configuredUrl ||
    configuredUrl.includes('localhost') ||
    configuredUrl.includes('127.0.0.1') ||
    configuredUrl.includes('host.docker.internal');

  // Se o administrador configurou um IP/host dedicado no servidor e o banco tem apenas localhost/default
  if (isCustomEnv && isDbUrlDefaultOrLocalhost) {
    return envUrl;
  }

  // Se o modelo no banco possui uma URL customizada válida
  if (configuredUrl && !isDbUrlDefaultOrLocalhost) {
    return configuredUrl;
  }

  const url = configuredUrl || envUrl || 'http://localhost:11434';

  const isInsideDocker =
    fs.existsSync('/.dockerenv') ||
    process.env.IS_DOCKER === 'true';

  if (isInsideDocker && (url.includes('localhost') || url.includes('127.0.0.1'))) {
    if (isCustomEnv) {
      return envUrl;
    }
    return url.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
  }

  return url;
}
