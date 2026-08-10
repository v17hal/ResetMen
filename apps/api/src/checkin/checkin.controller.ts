import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { checkinRequest, manualCheckinRequest } from '@reset/types';
import type { z } from 'zod';

import { AdminGuard, CurrentUser } from '../auth/auth.guards.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CheckinService } from './checkin.service.js';

/** Any signed-in staff member can check people in — that is the job at the counter. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/checkins')
@UseGuards(AdminGuard)
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Post()
  async scan(
    @CurrentUser() adminId: string,
    @Body(new ZodValidationPipe(checkinRequest)) body: z.infer<typeof checkinRequest>,
  ) {
    return this.checkin.redeemPayload(body.token, adminId);
  }

  /** Camera failed, screen cracked, battery dead — the queue does not stop. */
  @Post('manual')
  async manual(
    @CurrentUser() adminId: string,
    @Body(new ZodValidationPipe(manualCheckinRequest)) body: z.infer<typeof manualCheckinRequest>,
  ) {
    return this.checkin.redeemPublicId(body.publicId, adminId);
  }
}
