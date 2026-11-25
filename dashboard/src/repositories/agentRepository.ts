import { prisma } from '../config/prisma.js';
import { AgentModule, Prisma } from '@prisma/client';

export class AgentRepository {
  public static async findById(id: string, includeScrapeData: boolean = false): Promise<AgentModule | null> {
    return await prisma.agentModule.findUnique({
      where: { id },
      include: {
        scrapeData: includeScrapeData ? { orderBy: { createdAt: 'desc' }, take: 20 } : false,
      },
    });
  }

  public static async findByCode(code: string): Promise<AgentModule | null> {
    return await prisma.agentModule.findUnique({
      where: { code },
    });
  }

  public static async findFirst(where: Prisma.AgentModuleWhereInput): Promise<AgentModule | null> {
    return await prisma.agentModule.findFirst({
      where,
    });
  }

  public static async findMany(params: {
    where?: Prisma.AgentModuleWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.AgentModuleOrderByWithRelationInput;
    includeScrapeData?: boolean;
  }): Promise<AgentModule[]> {
    return await prisma.agentModule.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy || { createdAt: 'desc' },
      include: {
        scrapeData: params.includeScrapeData ? { orderBy: { createdAt: 'desc' }, take: 10 } : false,
      },
    });
  }

  public static async count(where?: Prisma.AgentModuleWhereInput): Promise<number> {
    return await prisma.agentModule.count({ where });
  }

  public static async create(data: Prisma.AgentModuleCreateInput): Promise<AgentModule> {
    return await prisma.agentModule.create({ data });
  }

  public static async update(id: string, data: Prisma.AgentModuleUpdateInput): Promise<AgentModule> {
    return await prisma.agentModule.update({
      where: { id },
      data,
    });
  }

  public static async updateMany(
    where: Prisma.AgentModuleWhereInput,
    data: Prisma.AgentModuleUpdateManyMutationInput
  ): Promise<Prisma.BatchPayload> {
    return await prisma.agentModule.updateMany({
      where,
      data,
    });
  }

  public static async delete(id: string): Promise<AgentModule> {
    return await prisma.agentModule.delete({
      where: { id },
    });
  }
}
