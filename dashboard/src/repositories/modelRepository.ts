import { prisma } from '../config/prisma.js';
import { AiModelConfig, Prisma } from '@prisma/client';

export class ModelRepository {
  public static async findById(id: string): Promise<AiModelConfig | null> {
    return await prisma.aiModelConfig.findUnique({
      where: { id },
    });
  }

  public static async findActive(): Promise<AiModelConfig | null> {
    return await prisma.aiModelConfig.findFirst({
      where: { isActive: true },
    });
  }

  public static async findFirst(where: Prisma.AiModelConfigWhereInput): Promise<AiModelConfig | null> {
    return await prisma.aiModelConfig.findFirst({
      where,
    });
  }

  public static async findMany(params: {
    where?: Prisma.AiModelConfigWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.AiModelConfigOrderByWithRelationInput[];
  }): Promise<AiModelConfig[]> {
    return await prisma.aiModelConfig.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy || [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  public static async count(where?: Prisma.AiModelConfigWhereInput): Promise<number> {
    return await prisma.aiModelConfig.count({ where });
  }

  public static async create(data: Prisma.AiModelConfigCreateInput): Promise<AiModelConfig> {
    return await prisma.aiModelConfig.create({ data });
  }

  public static async createMany(data: Prisma.AiModelConfigCreateManyInput[]): Promise<Prisma.BatchPayload> {
    return await prisma.aiModelConfig.createMany({ data });
  }

  public static async update(id: string, data: Prisma.AiModelConfigUpdateInput): Promise<AiModelConfig> {
    return await prisma.aiModelConfig.update({
      where: { id },
      data,
    });
  }

  public static async updateMany(
    where: Prisma.AiModelConfigWhereInput,
    data: Prisma.AiModelConfigUpdateManyMutationInput
  ): Promise<Prisma.BatchPayload> {
    return await prisma.aiModelConfig.updateMany({
      where,
      data,
    });
  }

  public static async delete(id: string): Promise<AiModelConfig> {
    return await prisma.aiModelConfig.delete({
      where: { id },
    });
  }
}
