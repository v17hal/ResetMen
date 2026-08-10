import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { refundRequest } from '@reset/types';
import { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { Idempotent, IdempotencyInterceptor } from '../common/idempotency.interceptor.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaymentService } from '../payments/payment.service.js';

const auditQuery = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const paymentListQuery = z.object({
  status: z
    .enum(['CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Payments and refunds.
 *
 * Refunds are Owner and Manager only, and always audited — this is the one admin action
 * that moves money out of the business, and "who refunded ₹1,200 on the 14th" needs an
 * answer that does not depend on anyone's memory.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/payments')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get()
  async list(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(paymentListQuery)) query: z.infer<typeof paymentListQuery>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);

    const payments = await this.prisma.payment.findMany({
      where: { storeId, ...(query.status === undefined ? {} : { status: query.status }) },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        refunds: true,
        booking: { select: { publicId: true, serviceNameSnapshot: true } },
        productOrder: { select: { publicId: true } },
      },
    });

    return {
      data: payments.map((p) => ({
        id: p.id,
        status: p.status,
        amountPaise: p.amountPaise,
        refundedPaise: p.refunds
          .filter((r) => r.status !== 'FAILED')
          .reduce((sum, r) => sum + r.amountPaise, 0),
        method: p.method,
        gatewayOrderId: p.gatewayOrderId,
        gatewayPaymentId: p.gatewayPaymentId,
        failureReason: p.failureReason,
        reference: p.booking?.publicId ?? p.productOrder?.publicId ?? null,
        description: p.booking?.serviceNameSnapshot ?? 'Product order',
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Idempotent, and this is the route that needs it most: a manager whose browser times out
   * mid-refund will click again, and the second click must not send the money twice.
   */
  @Post(':id/refund')
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  async refund(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(refundRequest)) body: z.infer<typeof refundRequest>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);

    const result = await this.payments.refund({
      paymentId: id,
      amountPaise: body.amountPaise,
      reason: body.reason,
      adminId: auth.sub,
    });

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'payment.refunded',
      entityType: 'Payment',
      entityId: id,
      after: result,
    });

    return result;
  }

  /**
   * Webhook deliveries that failed processing.
   *
   * Razorpay will not retry them — the dedupe row means a retry is discarded — so this is
   * the only place they surface. An empty list here is a healthy payment pipeline.
   */
  @Get('webhook-failures')
  async webhookFailures() {
    const events = await this.prisma.paymentEvent.findMany({
      where: { processedAt: null, processingError: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      data: events.map((e) => ({
        id: e.id,
        eventId: e.eventId,
        eventType: e.eventType,
        error: e.processingError,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}

/** Read-only audit trail. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER')
export class AdminAuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  @Get()
  async list(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(auditQuery)) query: z.infer<typeof auditQuery>,
    @StoreIdHeader() header?: string,
  ) {
    return this.audit.list({
      storeId: auth.storeId ?? (await this.scope.resolve(header)),
      entityType: query.entityType,
      entityId: query.entityId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
