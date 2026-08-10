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
import { createProductOrderRequest } from '@reset/types';
import { z } from 'zod';

import { CurrentUser, CustomerGuard } from '../auth/auth.guards.js';
import { Idempotent, IdempotencyInterceptor } from '../common/idempotency.interceptor.js';
import { RateLimitGuard, RateLimited } from '../common/rate-limit.guard.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProductService } from './product.service.js';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly scope: StoreScopeService,
  ) {}

  /** Public — the storefront is browsable without an account, like the service catalog. */
  @Get()
  async list(@StoreIdHeader() header?: string) {
    return { data: await this.products.list(await this.scope.resolve(header)) };
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string, @StoreIdHeader() header?: string) {
    return this.products.detail(await this.scope.resolve(header), slug);
  }
}

@ApiTags('products')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(CustomerGuard)
export class ProductOrderController {
  constructor(
    private readonly products: ProductService,
    private readonly scope: StoreScopeService,
  ) {}

  /**
   * Creates a pending order. Payment goes through `/payments/order` with the returned id —
   * the same gateway path bookings use, so there is one checkout implementation, not two.
   */
  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimited({ limit: 20, windowSeconds: 3600 })
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  async create(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createProductOrderRequest))
    body: z.infer<typeof createProductOrderRequest>,
    @StoreIdHeader() header?: string,
  ) {
    return this.products.createOrder({
      storeId: await this.scope.resolve(header),
      userId,
      input: body,
    });
  }

  @Get()
  async list(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>,
  ) {
    return { data: await this.products.listOrders(userId, query.limit) };
  }

  @Get(':id')
  async detail(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.products.orderDetail(id, userId);
  }
}
