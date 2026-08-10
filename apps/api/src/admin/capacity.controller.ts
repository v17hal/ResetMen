import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  allocationRuleInput,
  blackoutInput,
  localDate,
  stationInput,
  stationServices,
  storeHoursInput,
  storeSettingsInput,
  uuid,
} from '@reset/types';
import { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CapacityService } from './capacity.service.js';

const previewBody = z.object({
  rule: allocationRuleInput,
  date: localDate,
  excludeRuleId: uuid.optional(),
});

/**
 * Capacity administration — the client's 02/08/2026 requirements.
 *
 * Owner and Manager only. Counter staff can check people in and take walk-ins, but must not
 * be able to reshape the store's capacity mid-shift.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class CapacityController {
  constructor(
    private readonly capacity: CapacityService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  // ── Stations ───────────────────────────────────────────────────────────────

  @Get('stations')
  async listStations(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.capacity.listStations(await this.storeFor(auth, header));
  }

  @Post('stations')
  async createStation(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(stationInput)) body: z.infer<typeof stationInput>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.createStation(await this.storeFor(auth, header), body);
  }

  @Put('stations/:id')
  async updateStation(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(stationInput.partial())) body: Partial<z.infer<typeof stationInput>>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.updateStation(await this.storeFor(auth, header), id, body);
  }

  /** Client requirement: "certain beds may be designated only for head massage". */
  @Put('stations/:id/services')
  async setStationServices(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(stationServices)) body: z.infer<typeof stationServices>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.setStationServices(await this.storeFor(auth, header), id, body);
  }

  @Get('stations/coverage')
  async coverage(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.capacity.coverageWarnings(await this.storeFor(auth, header));
  }

  // ── Allocation rules ───────────────────────────────────────────────────────

  @Get('allocation-rules')
  async listRules(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.capacity.listAllocationRules(await this.storeFor(auth, header));
  }

  @Post('allocation-rules')
  async createRule(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(allocationRuleInput)) body: z.infer<typeof allocationRuleInput>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.createAllocationRule(await this.storeFor(auth, header), body);
  }

  @Put('allocation-rules/:id')
  async updateRule(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(allocationRuleInput)) body: z.infer<typeof allocationRuleInput>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.updateAllocationRule(await this.storeFor(auth, header), id, body);
  }

  @Delete('allocation-rules/:id')
  async deleteRule(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.deleteAllocationRule(await this.storeFor(auth, header), id);
  }

  /**
   * The dry-run. P0, not a nicety: a rule that strands existing bookings or wipes out a
   * service's morning availability is the kind of mistake an owner makes once and never
   * trusts the system again afterwards.
   */
  @Post('allocation-rules/preview')
  async previewRule(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(previewBody)) body: z.infer<typeof previewBody>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.previewAllocationRule(
      await this.storeFor(auth, header),
      body.rule,
      body.date,
      body.excludeRuleId,
    );
  }

  // ── Hours, blackouts, settings ─────────────────────────────────────────────

  @Get('store-hours')
  async getHours(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.capacity.getStoreHours(await this.storeFor(auth, header));
  }

  @Put('store-hours')
  async setHours(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(storeHoursInput)) body: z.infer<typeof storeHoursInput>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.setStoreHours(await this.storeFor(auth, header), body.hours);
  }

  @Get('blackouts')
  async listBlackouts(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.capacity.listBlackouts(await this.storeFor(auth, header));
  }

  @Post('blackouts')
  async createBlackout(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(blackoutInput)) body: z.infer<typeof blackoutInput>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.createBlackout(await this.storeFor(auth, header), body);
  }

  @Delete('blackouts/:id')
  async deleteBlackout(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.deleteBlackout(await this.storeFor(auth, header), id);
  }

  @Get('settings')
  async getSettings(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.capacity.getSettings(await this.storeFor(auth, header));
  }

  @Put('settings')
  async updateSettings(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(storeSettingsInput)) body: z.infer<typeof storeSettingsInput>,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.updateSettings(await this.storeFor(auth, header), body);
  }

  @Get('availability-preview')
  async availabilityPreview(
    @Query('date') _date: string,
    @CurrentAuth() auth: TokenClaims,
    @StoreIdHeader() header?: string,
  ) {
    return this.capacity.coverageWarnings(await this.storeFor(auth, header));
  }
}
