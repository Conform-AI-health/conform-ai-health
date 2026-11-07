import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';
import { Role } from '@prisma/client';

export class NormController {
  public static async listCatalog(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json({
        total: NORMS_CATALOG.length,
        norms: NORMS_CATALOG,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async customerRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let clientId = req.query.clientId as string;

      if (req.user?.role === Role.CLIENT) {
        clientId = req.user.clientId || '';
      }

      if (!clientId) {
        res.status(400).json({
          error: 'Parâmetro clientId é obrigatório.',
          code: 'CLIENT_ID_REQUIRED',
        });
        return;
      }

      // Busca violações acumuladas desta clínica para identificar regras mais frequentemente infringidas
      const violations = await prisma.violation.findMany({
        where: {
          auditReport: { clientId },
        },
        select: {
          normCode: true,
          normArticle: true,
          severity: true,
          resolved: true,
          createdAt: true,
        },
      });

      // Mapeia o catálogo enriquecido com o status de infrações da clínica
      const activeRules = NORMS_CATALOG.map((norm) => {
        const matchingViolations = violations.filter((v) => (v.normCode && v.normCode.includes(norm.normCode)) || v.normArticle === norm.article);
        const unresolvedCount = matchingViolations.filter((v) => !v.resolved).length;
        return {
          ...norm,
          totalOccurrences: matchingViolations.length,
          unresolvedOccurrences: unresolvedCount,
          status: unresolvedCount > 0 ? 'ATENCAO' : 'CONFORME',
        };
      });

      res.status(200).json({
        clientId,
        rules: activeRules,
        totalTrackedNorms: NORMS_CATALOG.length,
      });
    } catch (error) {
      next(error);
    }
  }
}

