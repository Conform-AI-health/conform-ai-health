import { prisma } from '../config/prisma.js';
import { Prisma, AuditReport } from '@prisma/client';

export class ReportRepository {
  public static async findById(id: string, options?: { includeClient?: boolean; includeViolations?: boolean }): Promise<any | null> {
    return await prisma.auditReport.findUnique({
      where: { id },
      include: {
        client: options?.includeClient
          ? {
              select: {
                id: true,
                name: true,
                tradeName: true,
                crmResponsavel: true,
                crmUf: true,
                rqeResponsavel: true,
                especialidade: true,
                email: true,
                phone: true,
                websiteUrl: true,
                users: { select: { email: true } },
              },
            }
          : false,
        violations: options?.includeViolations ?? true,
      },
    });
  }

  public static async findFirst(params: {
    where?: Prisma.AuditReportWhereInput;
    orderBy?: Prisma.AuditReportOrderByWithRelationInput;
  }): Promise<AuditReport | null> {
    return await prisma.auditReport.findFirst({
      where: params.where,
      orderBy: params.orderBy,
    });
  }

  public static async findUniqueWithRelations(id: string): Promise<any | null> {
    return await prisma.auditReport.findUnique({
      where: { id },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            tradeName: true,
            crmResponsavel: true,
            crmUf: true,
            rqeResponsavel: true,
            especialidade: true,
            email: true,
            phone: true,
            websiteUrl: true,
          },
        },
        violations: true,
      },
    });
  }

  public static async findMany(params: {
    where?: Prisma.AuditReportWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.AuditReportOrderByWithRelationInput;
    includeClient?: boolean;
    includeViolations?: boolean;
  }): Promise<any[]> {
    return await prisma.auditReport.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy || { createdAt: 'desc' },
      include: {
        client: params.includeClient !== false
          ? {
              select: {
                id: true,
                name: true,
                tradeName: true,
                crmResponsavel: true,
                crmUf: true,
                rqeResponsavel: true,
                especialidade: true,
                email: true,
                websiteUrl: true,
                users: { select: { email: true } },
              },
            }
          : false,
        violations: params.includeViolations
          ? {
              select: {
                id: true,
                auditReportId: true,
                severity: true,
                normCode: true,
                normArticle: true,
                detectedText: true,
                correctiveAdvice: true,
                resolved: true,
                createdAt: true,
              },
            }
          : false,
      },
    });
  }

  public static async count(where?: Prisma.AuditReportWhereInput): Promise<number> {
    return await prisma.auditReport.count({ where });
  }

  public static async create(data: Prisma.AuditReportCreateInput): Promise<AuditReport> {
    return await prisma.auditReport.create({ data });
  }

  public static async update(id: string, data: Prisma.AuditReportUpdateInput): Promise<AuditReport> {
    return await prisma.auditReport.update({
      where: { id },
      data,
    });
  }

  public static async delete(id: string): Promise<AuditReport> {
    return await prisma.auditReport.delete({
      where: { id },
    });
  }

  public static async findViolationById(violationId: string) {
    return await prisma.violation.findUnique({
      where: { id: violationId },
    });
  }

  public static async updateViolation(violationId: string, data: any) {
    return await prisma.violation.update({
      where: { id: violationId },
      data,
    });
  }

  public static async countUnresolvedViolations(reportId: string): Promise<number> {
    return await prisma.violation.count({
      where: {
        auditReportId: reportId,
        resolved: false,
      },
    });
  }
}
