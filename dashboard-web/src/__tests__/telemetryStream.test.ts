import { describe, it, expect } from 'vitest';
import { parseSseBuffer } from '../services/telemetryStream';

describe('parseSseBuffer', () => {
  it('extrai eventos completos e mantém o resto incompleto', () => {
    const { events, rest } = parseSseBuffer('retry: 5000\n\nevent: telemetry\ndata: {"a":1}\n\nevent: telemetry\ndata: {"a"');
    expect(events).toEqual([{ event: 'telemetry', data: '{"a":1}' }]);
    expect(rest).toBe('event: telemetry\ndata: {"a"');
  });

  it('ignora heartbeats e aceita CRLF', () => {
    const { events, rest } = parseSseBuffer(': ping\r\n\r\nevent: telemetry\r\ndata: {"b":2}\r\n\r\n');
    expect(events).toEqual([{ event: 'telemetry', data: '{"b":2}' }]);
    expect(rest).toBe('');
  });
});
