import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { AppError } from '../common/errors.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MediaService } from './media.service.js';
import type { UploadedFile as MediaFile } from './media.service.js';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

@ApiTags('media')
@ApiBearerAuth()
@Controller('admin/media')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class MediaAdminController {
  constructor(
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  /**
   * Held in memory rather than streamed to a temp file: the 5 MB cap makes that safe, and
   * it means the magic-byte check runs before anything touches the disk.
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @CurrentAuth() auth: TokenClaims,
    @UploadedFile() file: MediaFile | undefined,
    @Req() req: Request,
    @StoreIdHeader() header?: string,
  ) {
    if (file === undefined) {
      throw AppError.validation('No file was uploaded. Send it as multipart field "file".');
    }

    const storeId = await this.storeFor(auth, header);
    const asset = await this.media.upload({ storeId, file });

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'media.uploaded',
      entityType: 'MediaAsset',
      entityId: asset.id,
      after: { key: asset.key, bytes: asset.bytes, mime: asset.mime },
    });

    return absolute(asset, originOf(req));
  }

  @Get()
  async list(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>,
    @Req() req: Request,
    @StoreIdHeader() header?: string,
  ) {
    const assets = await this.media.list(await this.storeFor(auth, header), query.limit);
    return { data: assets.map((asset) => absolute(asset, originOf(req))) };
  }

  @Delete(':id')
  async remove(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const result = await this.media.remove(storeId, id);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'media.deleted',
      entityType: 'MediaAsset',
      entityId: id,
    });

    return result;
  }
}

/**
 * The API's own origin, as the caller reached it.
 *
 * `trust proxy` is on (main.ts), so behind Caddy this is `https://api.resetmen.in` rather
 * than the container's `http://api:4000`.
 */
function originOf(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

/**
 * Media URLs, made absolute.
 *
 * `MEDIA_PUBLIC_BASE_URL` defaults to the path `/api/v1/media`, which is only a URL on the
 * API's own host. The admin panel, the website and the app all live on other hosts, so a
 * path handed to them pointed at the wrong server: the first thing ever to upload through
 * here — the home-banner form — showed a blank preview and had its save refused as
 * "Invalid url." Nothing had uploaded before, so nothing had noticed.
 *
 * Resolved here, per request, rather than by adding a second setting that has to be kept in
 * step with the domain.
 */
function absolute<T extends { url: string; variants: Record<string, string> }>(asset: T, origin: string): T {
  const resolve = (url: string) => (url.startsWith('/') ? `${origin}${url}` : url);
  return {
    ...asset,
    url: resolve(asset.url),
    variants: Object.fromEntries(
      Object.entries(asset.variants).map(([name, url]) => [name, resolve(url)]),
    ),
  };
}

/**
 * Public read.
 *
 * Product and service images are shown to anyone browsing the catalog, so this is
 * unauthenticated by design. Keys are opaque random strings, so the route enumerates
 * nothing.
 *
 * In production a reverse proxy should serve the media directory directly and never reach
 * this handler — it exists so development and a single-VPS deployment work with no extra
 * moving parts.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':storeId/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async serve(
    @Param('storeId') storeId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.media.read(`${storeId}/${file}`);
    res.type(asset.mime).send(asset.body);
  }
}
