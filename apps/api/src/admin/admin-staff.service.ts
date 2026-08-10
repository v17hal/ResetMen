import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StaffInput } from '@reset/types';

import { hashPassword } from '../auth/auth.service.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Staff accounts.
 *
 * Owner-only throughout. The guard rails here exist because the failure they prevent —
 * a store with no working owner login — cannot be fixed from inside the product.
 */
@Injectable()
export class AdminStaffService {
  private readonly logger = new Logger(AdminStaffService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(storeId: string) {
    const staff = await this.prisma.adminUser.findMany({
      where: { OR: [{ storeId }, { storeId: null }] },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    return staff.map((s) => ({
      ...s,
      lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async create(storeId: string, input: StaffInput) {
    if (input.password === undefined) {
      throw AppError.validation('A password is required when creating a staff account.');
    }

    try {
      const created = await this.prisma.adminUser.create({
        data: {
          storeId,
          email: input.email.toLowerCase(),
          name: input.name,
          role: input.role,
          passwordHash: await hashPassword(input.password),
          isActive: input.isActive,
        },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });

      this.logger.log(`Created ${created.role} account for ${created.email}`);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.validation('That email address already has an account.');
      }
      throw error;
    }
  }

  async update(storeId: string, id: string, input: StaffInput, actingAdminId: string) {
    const before = await this.find(storeId, id);

    // Demoting or deactivating the last active owner locks everyone out of the store's own
    // settings, with no way back in from the product. Refuse rather than repair later.
    if (before.role === 'OWNER' && (input.role !== 'OWNER' || !input.isActive)) {
      await this.assertNotLastOwner(storeId, id);
    }

    if (id === actingAdminId && !input.isActive) {
      throw AppError.validation('You cannot deactivate your own account.');
    }

    const after = await this.prisma.adminUser.update({
      where: { id },
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        isActive: input.isActive,
      },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    return { before, after };
  }

  async setPassword(storeId: string, id: string, password: string) {
    await this.find(storeId, id);

    await this.prisma.adminUser.update({
      where: { id },
      data: { passwordHash: await hashPassword(password) },
    });

    this.logger.log(`Password reset for admin ${id}`);
    return { updated: true };
  }

  /**
   * Deactivates rather than deletes.
   *
   * `AuditLog.adminUserId` and `CheckinToken.usedByAdminId` point here. Deleting the row
   * would blank out the name against every action that person ever took, which defeats the
   * purpose of having an audit log at all.
   */
  async deactivate(storeId: string, id: string, actingAdminId: string) {
    const staff = await this.find(storeId, id);

    if (id === actingAdminId) {
      throw AppError.validation('You cannot deactivate your own account.');
    }
    if (staff.role === 'OWNER') {
      await this.assertNotLastOwner(storeId, id);
    }

    await this.prisma.adminUser.update({ where: { id }, data: { isActive: false } });
    return staff;
  }

  private async find(storeId: string, id: string) {
    const staff = await this.prisma.adminUser.findFirst({
      where: { id, OR: [{ storeId }, { storeId: null }] },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (staff === null) throw AppError.notFound('Staff account');
    return staff;
  }

  private async assertNotLastOwner(storeId: string, excludingId: string): Promise<void> {
    const remaining = await this.prisma.adminUser.count({
      where: {
        role: 'OWNER',
        isActive: true,
        id: { not: excludingId },
        OR: [{ storeId }, { storeId: null }],
      },
    });

    if (remaining === 0) {
      throw AppError.validation(
        'This is the only active owner account. Promote another owner first — ' +
          'otherwise nobody can manage the store.',
      );
    }
  }
}
