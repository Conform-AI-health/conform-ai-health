export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number; // Número de falhas consecutivas para abrir o circuito
  resetTimeoutMs?: number;   // Tempo em ms que o circuito permanece OPEN antes de ir para HALF_OPEN
  successThreshold?: number; // Número de sucessos em HALF_OPEN para fechar o circuito novamente
  fallback?: () => Promise<any> | any;
}

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly circuitName: string) {
    super(`[CircuitBreaker] Circuito "${circuitName}" está ABERTO (OPEN). Requisições externas suspensas temporariamente.`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptAt = 0;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly fallback?: () => Promise<any> | any;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 15000;
    this.successThreshold = options.successThreshold ?? 2;
    this.fallback = options.fallback;
  }

  public getState(): CircuitBreakerState {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptAt) {
      this.state = 'HALF_OPEN';
      this.successCount = 0;
      console.log(`🟡 [CircuitBreaker:${this.name}] Transição para HALF_OPEN. Testando recuperação com requisições parciais...`);
    }
    return this.state;
  }

  public async execute<T>(action: () => Promise<T>, fallback?: () => Promise<T> | T): Promise<T> {
    const activeFallback = fallback ?? this.fallback;
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      console.warn(`⚡ [CircuitBreaker:${this.name}] Chamada bloqueada: circuito em estado OPEN.`);
      if (activeFallback) {
        return activeFallback();
      }
      throw new CircuitBreakerOpenError(this.name);
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      if (activeFallback) {
        return activeFallback();
      }
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        console.log(`🟢 [CircuitBreaker:${this.name}] Circuito restabelecido com sucesso! Estado: CLOSED.`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(error: any): void {
    this.failureCount++;
    console.warn(`🔴 [CircuitBreaker:${this.name}] Falha registrada (${this.failureCount}/${this.failureThreshold}): ${error?.message || error}`);

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
      console.error(`🚨 [CircuitBreaker:${this.name}] Limiar atingido! Circuito ABERTO (OPEN) por ${this.resetTimeoutMs / 1000}s.`);
    }
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = 0;
  }
}
