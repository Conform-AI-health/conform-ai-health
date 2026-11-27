export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Faz o parse incremental de um buffer SSE. Retorna os eventos completos e o resto ainda não terminado.
 */
export function parseSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];

  for (const block of blocks) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const sep = line.indexOf(':');
      const field = sep === -1 ? line : line.slice(0, sep);
      const value = sep === -1 ? '' : line.slice(sep + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join('\n') });
  }

  return { events, rest };
}

export class TelemetryStreamError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/**
 * Abre o stream SSE da telemetria via fetch (o EventSource nativo não envia o header Authorization).
 * Resolve quando o servidor encerra o stream; rejeita em erro de rede ou HTTP.
 */
export async function openTelemetryStream(onTelemetry: (data: any) => void, signal: AbortSignal): Promise<void> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('conformia_token') : null;
  const res = await fetch('/api/v1/system/telemetry/stream', {
    method: 'GET',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'text/event-stream',
      'X-Requested-With': 'XMLHttpRequest',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok || !res.body) {
    throw new TelemetryStreamError(`Stream de telemetria indisponível (HTTP ${res.status})`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const evt of parsed.events) {
      if (evt.event !== 'telemetry') continue;
      try {
        onTelemetry(JSON.parse(evt.data));
      } catch {
        // Ignora payload malformado
      }
    }
  }
}
