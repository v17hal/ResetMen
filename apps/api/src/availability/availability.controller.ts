import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AvailabilityService } from './availability.service.js';

/** `?addonOptionIds=a,b` or repeated `?addonOptionIds=a&addonOptionIds=b`. */
const addonIds = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return [];
    const list = Array.isArray(value) ? value : value.split(',');
    return list.map((v) => v.trim()).filter((v) => v.length > 0);
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const slotsQuery = z.object({
  serviceId: z.string().uuid(),
  date: isoDate,
  addonOptionIds: addonIds,
});

const daysQuery = z.object({
  serviceId: z.string().uuid(),
  from: isoDate,
  to: isoDate,
  addonOptionIds: addonIds,
});

@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly scope: StoreScopeService,
  ) {}

  @Get('slots')
  async slots(
    @Query(new ZodValidationPipe(slotsQuery)) query: z.infer<typeof slotsQuery>,
    @StoreIdHeader() header?: string,
  ) {
    return this.availability.getSlots({
      storeId: await this.scope.resolve(header),
      serviceId: query.serviceId,
      date: query.date,
      addonOptionIds: query.addonOptionIds,
    });
  }

  @Get('days')
  async days(
    @Query(new ZodValidationPipe(daysQuery)) query: z.infer<typeof daysQuery>,
    @StoreIdHeader() header?: string,
  ) {
    return this.availability.getDays({
      storeId: await this.scope.resolve(header),
      serviceId: query.serviceId,
      from: query.from,
      to: query.to,
      addonOptionIds: query.addonOptionIds,
    });
  }
}
