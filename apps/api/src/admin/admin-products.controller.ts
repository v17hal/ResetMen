import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { productInput, productOrderStatusChange, stockAdjustment } from '@reset/types';
import { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PaymentService } from '../payments/payment.service.js';
import { ProductService } from '../products/product.service.js';
import { AdminProductsService } from './admin-products.service.js';

const orderListQuery = z.object({
  status: z.enum(['PENDING', 'PAID', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const markPaidRequest = z.object({
  method: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']).default('CASH'),
  note: z.string().max(200).optional(),
});

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/products')
@UseGuards(AdminGuard, RolesGuard)
export class AdminProductsController {
  constructor(
    private readonly products: AdminProductsService,
    private readonly storefront: ProductService,
    private readonly payments: PaymentService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get()
  async list(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.products.list(await this.storeFor(auth, header)) };
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(productInput)) body: z.infer<typeof productInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.products.create(storeId, body);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'product.created',
      entityType: 'Product',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  async update(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productInput)) body: z.infer<typeof productInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.products.update(storeId, id, body);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'product.updated',
      entityType: 'Product',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  /**
   * Stock adjustment as a signed delta, not an absolute count.
   *
   * Two staff members counting the shelf at the same time would otherwise overwrite each
   * other — and the one who saved second would win, regardless of who was right.
   */
  @Post(':id/stock')
  async adjustStock(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(stockAdjustment)) body: z.infer<typeof stockAdjustment>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const result = await this.products.adjustStock(storeId, id, body.delta);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'product.stock_adjusted',
      entityType: 'Product',
      entityId: id,
      before: { stockQty: result.before },
      after: { stockQty: result.after, delta: body.delta, reason: body.reason },
    });

    return result;
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  async remove(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.products.softDelete(storeId, id);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'product.deleted',
      entityType: 'Product',
      entityId: id,
      before,
    });

    return { deleted: true };
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  @Get('orders/all')
  async listOrders(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(orderListQuery)) query: z.infer<typeof orderListQuery>,
    @StoreIdHeader() header?: string,
  ) {
    return {
      data: await this.products.listOrders(
        await this.storeFor(auth, header),
        query.status,
        query.limit,
      ),
    };
  }

  /**
   * Money taken at the counter for an order.
   *
   * Same shape as the booking one, and for the same reason: there is no gateway, so an order
   * is settled in person and this is the row that says so. It is what moves the order off
   * the unpaid list, into revenue, and into a state that can be marked ready for pickup.
   */
  @Post('orders/:id/mark-paid')
  @Roles('OWNER', 'MANAGER')
  async markOrderPaid(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markPaidRequest)) body: z.infer<typeof markPaidRequest>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const result = await this.payments.recordCounterOrderPayment({
      productOrderId: id,
      adminUserId: auth.sub,
      method: body.method,
      note: body.note,
    });

    if (!result.alreadyRecorded) {
      await this.audit.record({
        storeId,
        adminUserId: auth.sub,
        action: 'product_order.paid',
        entityType: 'ProductOrder',
        entityId: id,
        after: result,
      });
    }

    return result;
  }

  @Post('orders/:id/status')
  async setOrderStatus(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productOrderStatusChange))
    body: z.infer<typeof productOrderStatusChange>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const result = await this.storefront.setOrderStatus({
      storeId,
      orderId: id,
      status: body.status,
      reason: body.reason,
    });

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: `product_order.${body.status.toLowerCase()}`,
      entityType: 'ProductOrder',
      entityId: id,
      after: result,
    });

    return result;
  }
}
