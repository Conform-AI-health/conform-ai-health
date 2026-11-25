import { prisma } from '../config/prisma.js';
import { Prisma, SystemLog } from '@prisma/client';

export class SystemLogRepository {
  public static async create(data: Prisma.SystemLogCreateInput): Promise<SystemLog | null> {
    try {
      return await prisma.systemLog.create({ data });
    } catch {
      return null;
    }
  }
}
