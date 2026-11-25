import { prisma } from '../config/prisma.js';
import { User, Prisma } from '@prisma/client';

export class UserRepository {
  public static async findById(id: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { id },
    });
  }

  public static async findByEmail(email: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { email },
    });
  }

  public static async findFirst(where: Prisma.UserWhereInput): Promise<User | null> {
    return await prisma.user.findFirst({
      where,
    });
  }

  public static async create(
    data: Prisma.UserCreateInput | Prisma.UserUncheckedCreateInput
  ): Promise<User>;
  public static async create(
    data: Prisma.UserCreateInput | Prisma.UserUncheckedCreateInput,
    select: Prisma.UserSelect
  ): Promise<Record<string, any>>;
  public static async create(
    data: Prisma.UserCreateInput | Prisma.UserUncheckedCreateInput,
    select?: Prisma.UserSelect
  ): Promise<User | Record<string, any>> {
    if (select) {
      return await prisma.user.create({ data, select });
    }
    return await prisma.user.create({ data });
  }

  public static async update(
    id: string,
    data: Prisma.UserUpdateInput | Prisma.UserUncheckedUpdateInput
  ): Promise<User>;
  public static async update(
    id: string,
    data: Prisma.UserUpdateInput | Prisma.UserUncheckedUpdateInput,
    select: Prisma.UserSelect
  ): Promise<Record<string, any>>;
  public static async update(
    id: string,
    data: Prisma.UserUpdateInput | Prisma.UserUncheckedUpdateInput,
    select?: Prisma.UserSelect
  ): Promise<User | Record<string, any>> {
    if (select) {
      return await prisma.user.update({ where: { id }, data, select });
    }
    return await prisma.user.update({ where: { id }, data });
  }

  public static async updateMany(
    where: Prisma.UserWhereInput,
    data: Prisma.UserUpdateManyMutationInput
  ): Promise<Prisma.BatchPayload> {
    return await prisma.user.updateMany({
      where,
      data,
    });
  }

  public static async delete(id: string): Promise<User> {
    return await prisma.user.delete({
      where: { id },
    });
  }
}
