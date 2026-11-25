import { prisma } from '../config/prisma.js';
import { Client, Prisma } from '@prisma/client';

export class ClientRepository {
  public static async findById(
    id: string,
    options?: { includeUsers?: boolean; includeScrapeData?: boolean }
  ): Promise<Client | null> {
    return await prisma.client.findUnique({
      where: { id },
      include: {
        users: options?.includeUsers ? { select: { id: true, name: true, email: true, role: true } } : false,
        scrapedData: options?.includeScrapeData ? { orderBy: { createdAt: 'desc' }, take: 20 } : false,
      },
    });
  }

  public static async findByCrm(crm: string, uf: string): Promise<Client | null> {
    return await prisma.client.findFirst({
      where: {
        crmResponsavel: crm,
        crmUf: uf,
      },
    });
  }

  public static async findMany(params: {
    where?: Prisma.ClientWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.ClientOrderByWithRelationInput;
    includeUsers?: boolean;
  }): Promise<Client[]> {
    return await prisma.client.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy || { createdAt: 'desc' },
      include: {
        users: params.includeUsers ? { select: { id: true, name: true, email: true, role: true } } : false,
      },
    });
  }

  public static async count(where?: Prisma.ClientWhereInput): Promise<number> {
    return await prisma.client.count({ where });
  }

  public static async create(data: Prisma.ClientCreateInput): Promise<Client> {
    return await prisma.client.create({ data });
  }

  public static async update(id: string, data: Prisma.ClientUpdateInput): Promise<Client> {
    return await prisma.client.update({
      where: { id },
      data,
    });
  }

  public static async delete(id: string): Promise<Client> {
    return await prisma.client.delete({
      where: { id },
    });
  }

  public static async findScrapedData(clientId: string, take: number = 20) {
    return await prisma.moduleScrapeData.findMany({
      where: {
        module: { clientId },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  public static async createClientScrapedData(data: Prisma.ClientScrapedDataCreateInput) {
    return await prisma.clientScrapedData.create({ data });
  }

  public static async findClientScrapedData(clientId: string) {
    return await prisma.clientScrapedData.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
