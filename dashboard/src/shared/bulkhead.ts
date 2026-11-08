export interface BulkheadOptions {
  name: string;
  maxConcurrent?: number; // Máximo de execuções concorrentes permitidas
  maxQueue?: number;      // Tamanho máximo da fila de espera
  timeoutMs?: number;     // Timeout máximo aguardando na fila
}

export class BulkheadRejectedError extends Error {
  constructor(public readonly bulkheadName: string) {
    super(`[Bulkhead] Capacidade máxima atingida para "${bulkheadName}". Requisição rejeitada por proteção de recursos.`);
    this.name = 'BulkheadRejectedError';
  }
}

interface QueuedTask<T> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  action: () => Promise<T>;
  timeoutTimer: NodeJS.Timeout;
}

export class Bulkhead {
  private activeCount = 0;
  private readonly queue: QueuedTask<any>[] = [];

  private readonly name: string;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly timeoutMs: number;

  constructor(options: BulkheadOptions) {
    this.name = options.name;
    this.maxConcurrent = options.maxConcurrent ?? 5;
    this.maxQueue = options.maxQueue ?? 20;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  public async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.activeCount < this.maxConcurrent) {
      return this.runAction(action);
    }

    if (this.queue.length >= this.maxQueue) {
      console.warn(`🛡️ [Bulkhead:${this.name}] Fila saturada (${this.queue.length}/${this.maxQueue}). Rejeitando chamada.`);
      throw new BulkheadRejectedError(this.name);
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        const index = this.queue.findIndex(q => q.timeoutTimer === timeoutTimer);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error(`[Bulkhead:${this.name}] Tempo limite de espera na fila excedido (${this.timeoutMs}ms)`));
        }
      }, this.timeoutMs);

      this.queue.push({
        resolve,
        reject,
        action,
        timeoutTimer,
      });
    });
  }

  private async runAction<T>(action: () => Promise<T>): Promise<T> {
    this.activeCount++;
    try {
      return await action();
    } finally {
      this.activeCount--;
      this.dequeueNext();
    }
  }

  private dequeueNext(): void {
    if (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        clearTimeout(nextTask.timeoutTimer);
        this.runAction(nextTask.action)
          .then(nextTask.resolve)
          .catch(nextTask.reject);
      }
    }
  }

  public getStats(): { active: number; queued: number; maxConcurrent: number; maxQueue: number } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
    };
  }
}
