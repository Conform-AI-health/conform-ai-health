import { Request, Response, NextFunction } from 'express';
import { LinkTraceService } from '../shared/linkTrace.js';

export class LinkTraceController {
  /**
   * GET /system/link-trace?jobId=&status=&search=&limit=
   * Lista todos os links descobertos/consultados pelo crawler de normas, com resumo por status e jobs recentes.
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await LinkTraceService.query({
        jobId: typeof req.query.jobId === 'string' && req.query.jobId ? req.query.jobId : undefined,
        status: typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined,
        search: typeof req.query.search === 'string' && req.query.search ? req.query.search : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) || undefined : undefined,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
