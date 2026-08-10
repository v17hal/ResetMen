import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  blockCustomerInput,
  customerListQuery,
  staffInput,
  staffPasswordInput,
} from '@reset/types';
import type { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminCustomersService } from './admin-customers.service.js';
import { AdminStaffService } from './admin-staff.service.js';

/**
 * Customers.
 *
 * Readable by counter staff — they need to look someone up when the phone rings — but
 * blocking is a manager decision.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/customers')
@UseGuards(AdminGuard, RolesGuard)
export class AdminCustomersController {
  constructor(
    private readonly customers: AdminCustomersService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get()
  async list(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(customerListQuery)) query: z.infer<typeof customerListQuery>,
    @StoreIdHeader() header?: string,
  ) {
    return this.customers.list({
      storeId: await this.storeFor(auth, header),
      q: query.q,
      blocked: query.blocked,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get(':id')
  async detail(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    return this.customers.detail(await this.storeFor(auth, header), id);
  }

  @Post(':id/block')
  @Roles('OWNER', 'MANAGER')
  async block(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(blockCustomerInput)) body: z.infer<typeof blockCustomerInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const result = await this.customers.setBlocked({
      storeId,
      userId: id,
      blocked: body.blocked,
      reason: body.reason,
    });

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: body.blocked ? 'customer.blocked' : 'customer.unblocked',
      entityType: 'User',
      entityId: id,
      before: result.before,
      after: result.after,
    });

    return {
      isBlocked: result.after.isBlocked,
      blockedReason: result.after.blockedReason,
      upcomingBookings: result.upcomingBookings,
    };
  }
}

/**
 * Staff accounts. Owner-only — a manager who could create owners would be an owner.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/staff')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER')
export class AdminStaffController {
  constructor(
    private readonly staff: AdminStaffService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get()
  async list(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.staff.list(await this.storeFor(auth, header)) };
  }

  @Post()
  async create(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(staffInput)) body: z.infer<typeof staffInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.staff.create(storeId, body);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'staff.created',
      entityType: 'AdminUser',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  @Put(':id')
  async update(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(staffInput)) body: z.infer<typeof staffInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.staff.update(storeId, id, body, auth.sub);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'staff.updated',
      entityType: 'AdminUser',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  @Post(':id/password')
  async setPassword(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(staffPasswordInput)) body: z.infer<typeof staffPasswordInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const result = await this.staff.setPassword(storeId, id, body.password);

    // The password itself is never recorded — the audit service redacts it, and it is not
    // passed here in the first place.
    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'staff.password_reset',
      entityType: 'AdminUser',
      entityId: id,
    });

    return result;
  }

  @Delete(':id')
  async deactivate(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.staff.deactivate(storeId, id, auth.sub);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'staff.deactivated',
      entityType: 'AdminUser',
      entityId: id,
      before,
    });

    return { deactivated: true };
  }
}
