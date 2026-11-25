import fs from 'fs';
import { env } from '../../config/env.js';

/**
 * Resolve a URL base para conexão com o Ollama considerando se a aplicação
 * está rodando localmente no host ou encapsulada em contêineres Docker (onde localhost aponta para o container).
 */
export function resolveOllamaBaseUrl(configuredUrl?: string | null): string {
  const defaultEnvUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const url = configuredUrl || defaultEnvUrl;
  const isInsideDocker =
    fs.existsSync('/.dockerenv') ||
    process.env.IS_DOCKER === 'true' ||
    defaultEnvUrl.includes('host.docker.internal');

  if (isInsideDocker && (url.includes('localhost') || url.includes('127.0.0.1'))) {
    return url.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
  }
  return url;
}
