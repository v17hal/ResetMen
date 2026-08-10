import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { registerDeviceRequest } from '@reset/types';
import { z } from 'zod';

import { CurrentUser, CustomerGuard } from '../auth/auth.guards.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationService } from './notification.service.js';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(CustomerGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * Called on every app start, not only on first grant.
   *
   * FCM rotates tokens without telling the app, so a registration that only happens at
   * install time quietly stops working after a few months — and nobody notices until
   * someone asks why the reminders stopped.
   */
  @Post('devices')
  async register(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(registerDeviceRequest)) body: z.infer<typeof registerDeviceRequest>,
  ) {
    return this.notifications.registerDevice(userId, body.token, body.platform);
  }

  @Delete('devices')
  async unregister(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(z.object({ token: z.string().min(1) })))
    body: { token: string },
  ) {
    return this.notifications.unregisterDevice(userId, body.token);
  }

  @Get()
  async list(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>,
  ) {
    return { data: await this.notifications.listForUser(userId, query.limit) };
  }
}
