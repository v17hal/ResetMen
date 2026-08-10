import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  addonGroupInput,
  addonOptionInput,
  categoryInput,
  reorderInput,
  segmentInput,
  serviceInput,
} from '@reset/types';
import { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminCatalogService } from './admin-catalog.service.js';

const activeInput = z.object({ isActive: z.boolean() });
const addonGroupIds = z.object({ addonGroupIds: z.array(z.string().uuid()) });
const reorderEntity = z.enum(['segment', 'category', 'service', 'addonGroup']);

/**
 * Catalog administration.
 *
 * Owner and Manager only — pricing and menu structure are not a counter-shift concern.
 * Every mutation is audited, because "who changed the price of Head Reset" is a question
 * that gets asked eventually and cannot be answered retrospectively.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/catalog')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class AdminCatalogController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  private async log(
    auth: TokenClaims,
    storeId: string,
    action: string,
    entityType: string,
    entityId: string | null,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action,
      entityType,
      entityId,
      before,
      after,
    });
  }

  // ── Segments ───────────────────────────────────────────────────────────────

  @Get('segments')
  async listSegments(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.catalog.listSegments(await this.storeFor(auth, header)) };
  }

  @Post('segments')
  async createSegment(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(segmentInput)) body: z.infer<typeof segmentInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.catalog.createSegment(storeId, body);
    await this.log(auth, storeId, 'segment.created', 'Segment', created.id, null, created);
    return created;
  }

  @Put('segments/:id')
  async updateSegment(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(segmentInput)) body: z.infer<typeof segmentInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.catalog.updateSegment(storeId, id, body);
    await this.log(auth, storeId, 'segment.updated', 'Segment', id, before, after);
    return after;
  }

  @Delete('segments/:id')
  async deleteSegment(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.catalog.deleteSegment(storeId, id);
    await this.log(auth, storeId, 'segment.deleted', 'Segment', id, before);
    return { deleted: true };
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  @Get('categories')
  async listCategories(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.catalog.listCategories(await this.storeFor(auth, header)) };
  }

  @Post('categories')
  async createCategory(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(categoryInput)) body: z.infer<typeof categoryInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.catalog.createCategory(storeId, body);
    await this.log(auth, storeId, 'category.created', 'Category', created.id, null, created);
    return created;
  }

  @Put('categories/:id')
  async updateCategory(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(categoryInput)) body: z.infer<typeof categoryInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.catalog.updateCategory(storeId, id, body);
    await this.log(auth, storeId, 'category.updated', 'Category', id, before, after);
    return after;
  }

  @Delete('categories/:id')
  async deleteCategory(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.catalog.deleteCategory(storeId, id);
    await this.log(auth, storeId, 'category.deleted', 'Category', id, before);
    return { deleted: true };
  }

  // ── Services ───────────────────────────────────────────────────────────────

  @Get('services')
  async listServices(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.catalog.listServices(await this.storeFor(auth, header)) };
  }

  @Post('services')
  async createService(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(serviceInput)) body: z.infer<typeof serviceInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.catalog.createService(storeId, body);
    await this.log(auth, storeId, 'service.created', 'Service', created.id, null, created);
    return created;
  }

  @Put('services/:id')
  async updateService(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(serviceInput)) body: z.infer<typeof serviceInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.catalog.updateService(storeId, id, body);
    await this.log(auth, storeId, 'service.updated', 'Service', id, before, after);
    return after;
  }

  @Post('services/:id/active')
  async setServiceActive(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(activeInput)) body: z.infer<typeof activeInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const after = await this.catalog.setServiceActive(storeId, id, body.isActive);
    await this.log(
      auth,
      storeId,
      body.isActive ? 'service.published' : 'service.unpublished',
      'Service',
      id,
      null,
      after,
    );
    return after;
  }

  @Delete('services/:id')
  async deleteService(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.catalog.deleteService(storeId, id);
    await this.log(auth, storeId, 'service.deleted', 'Service', id, before);
    return { deleted: true };
  }

  @Put('services/:id/addon-groups')
  async setServiceAddonGroups(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addonGroupIds)) body: z.infer<typeof addonGroupIds>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const result = await this.catalog.setServiceAddonGroups(storeId, id, body.addonGroupIds);
    await this.log(auth, storeId, 'service.addon_groups_set', 'Service', id, null, result);
    return result;
  }

  // ── Add-ons ────────────────────────────────────────────────────────────────

  @Get('addon-groups')
  async listAddonGroups(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.catalog.listAddonGroups(await this.storeFor(auth, header)) };
  }

  @Post('addon-groups')
  async createAddonGroup(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(addonGroupInput)) body: z.infer<typeof addonGroupInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.catalog.createAddonGroup(storeId, body);
    await this.log(auth, storeId, 'addon_group.created', 'AddonGroup', created.id, null, created);
    return created;
  }

  @Put('addon-groups/:id')
  async updateAddonGroup(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addonGroupInput)) body: z.infer<typeof addonGroupInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.catalog.updateAddonGroup(storeId, id, body);
    await this.log(auth, storeId, 'addon_group.updated', 'AddonGroup', id, before, after);
    return after;
  }

  @Post('addon-groups/:id/options')
  async createAddonOption(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') groupId: string,
    @Body(new ZodValidationPipe(addonOptionInput)) body: z.infer<typeof addonOptionInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.catalog.createAddonOption(storeId, groupId, body);
    await this.log(auth, storeId, 'addon_option.created', 'AddonOption', created.id, null, created);
    return created;
  }

  @Put('addon-options/:id')
  async updateAddonOption(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addonOptionInput)) body: z.infer<typeof addonOptionInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.catalog.updateAddonOption(storeId, id, body);
    await this.log(auth, storeId, 'addon_option.updated', 'AddonOption', id, before, after);
    return after;
  }

  @Delete('addon-options/:id')
  async deleteAddonOption(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.catalog.deleteAddonOption(storeId, id);
    await this.log(auth, storeId, 'addon_option.deleted', 'AddonOption', id, before);
    return { deleted: true };
  }

  // ── Ordering ───────────────────────────────────────────────────────────────

  @Post('reorder/:entity')
  async reorder(
    @CurrentAuth() auth: TokenClaims,
    @Param('entity', new ZodValidationPipe(reorderEntity)) entity: z.infer<typeof reorderEntity>,
    @Body(new ZodValidationPipe(reorderInput)) body: z.infer<typeof reorderInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    return this.catalog.reorder(entity, storeId, body.items);
  }
}
