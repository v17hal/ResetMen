import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { csvExportQuery, reportRange } from '@reset/types';
import type { Response } from 'express';
import type { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReportsService } from './reports.service.js';

/**
 * Reports.
 *
 * Owner and Manager only. Every figure here is derived — nothing is stored pre-aggregated —
 * so a correction to a booking is reflected the next time the report is opened rather than
 * requiring a rebuild.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/reports')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get('dashboard')
  async dashboard(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.reports.dashboard(await this.storeFor(auth, header));
  }

  @Get('revenue')
  async revenue(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(reportRange)) query: z.infer<typeof reportRange>,
    @StoreIdHeader() header?: string,
  ) {
    return this.reports.revenue(await this.storeFor(auth, header), query);
  }

  @Get('utilisation')
  async utilisation(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(reportRange)) query: z.infer<typeof reportRange>,
    @StoreIdHeader() header?: string,
  ) {
    return this.reports.utilisation(await this.storeFor(auth, header), query);
  }

  @Get('no-show')
  async noShow(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(reportRange)) query: z.infer<typeof reportRange>,
    @StoreIdHeader() header?: string,
  ) {
    return this.reports.noShow(await this.storeFor(auth, header), query);
  }

  @Get('retention')
  async retention(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(reportRange)) query: z.infer<typeof reportRange>,
    @StoreIdHeader() header?: string,
  ) {
    return this.reports.retention(await this.storeFor(auth, header), query);
  }

  /**
   * CSV download.
   *
   * Audited, unlike the on-screen reports: an export is a copy of customer names and phone
   * numbers leaving the system, and under the DPDP Act the store needs to be able to say
   * who took one and when.
   */
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(csvExportQuery)) query: z.infer<typeof csvExportQuery>,
    @Res() res: Response,
    @StoreIdHeader() header?: string,
  ): Promise<void> {
    const storeId = await this.storeFor(auth, header);
    const file = await this.reports.csv(storeId, query, query.report);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'report.exported',
      entityType: 'Report',
      entityId: query.report,
      after: { from: query.from, to: query.to, report: query.report },
    });

    res
      .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
      // Excel assumes the system codepage for CSV unless a BOM says otherwise, which turns
      // ₹ and any non-ASCII customer name into mojibake on the owner's machine.
      .send(`﻿${file.body}`);
  }
}
