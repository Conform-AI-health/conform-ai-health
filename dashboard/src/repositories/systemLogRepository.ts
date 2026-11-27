import { prisma } from '../config/prisma.js';
import { Prisma, SystemLog } from '@prisma/client';
import { publishTelemetryEvent } from '../shared/telemetryEvents.js';

export class SystemLogRepository {
  public static async create(data: Prisma.SystemLogCreateInput): Promise<SystemLog | null> {
    try {
      const log = await prisma.systemLog.create({ data });
      publishTelemetryEvent('SYSTEM_LOG');
      return log;
    } catch {
      return null;
    }
  }
}
