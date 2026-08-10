import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { CatalogService } from './catalog.service.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly scope: StoreScopeService,
  ) {}

  @Get('store')
  async store(@StoreIdHeader() header?: string) {
    return this.catalog.getStore(await this.scope.resolve(header));
  }

  @Get('segments')
  async segments(@StoreIdHeader() header?: string) {
    return this.catalog.getSegments(await this.scope.resolve(header));
  }

  @Get('categories')
  async categories(@Query('segmentId') segmentId?: string, @StoreIdHeader() header?: string) {
    return this.catalog.getCategories(await this.scope.resolve(header), segmentId);
  }

  @Get('services')
  async services(@Query('categoryId') categoryId?: string, @StoreIdHeader() header?: string) {
    return this.catalog.getServices(await this.scope.resolve(header), categoryId);
  }

  @Get('home')
  async home(@Query('segmentId') segmentId?: string, @StoreIdHeader() header?: string) {
    return this.catalog.getHome(await this.scope.resolve(header), segmentId);
  }

  @Get('services/:idOrSlug')
  async service(@Param('idOrSlug') idOrSlug: string, @StoreIdHeader() header?: string) {
    return this.catalog.getService(await this.scope.resolve(header), idOrSlug);
  }
}
