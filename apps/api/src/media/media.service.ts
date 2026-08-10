import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

import { AppError } from '../common/errors.js';
import { loadEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';

/** Only what a catalog needs. No SVG: it is a script container, not an image format. */
const ALLOWED_MIME = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
]);

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Rendition widths, in device-independent pixels.
 *
 * `thumb` is the catalog grid, `card` a service or product tile, `hero` a full-width header
 * on a large phone. Anything wider than `hero` is served as the original.
 */
const VARIANT_WIDTHS = { thumb: 200, card: 600, hero: 1200 } as const;

export interface UploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * Media storage.
 *
 * Local disk behind an interface shaped like object storage: keys are opaque, reads go
 * through `read(key)`, and nothing outside this file knows where the bytes live. Moving to
 * S3 or R2 later is then a change to two methods rather than to every call site — which
 * matters, because the client is on a single VPS today and will not stay there if the
 * business grows.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly root: string;
  private readonly publicBase: string;

  constructor(private readonly prisma: PrismaService) {
    const env = loadEnv();
    this.root = resolve(env.MEDIA_ROOT);
    this.publicBase = env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '');
  }

  async upload(params: { storeId: string; file: UploadedFile }) {
    const { file } = params;

    const extension = ALLOWED_MIME.get(file.mimetype);
    if (extension === undefined) {
      throw AppError.validation(
        `${file.mimetype} is not an accepted image type. Use JPEG, PNG, WebP or AVIF.`,
      );
    }

    if (file.size > MAX_BYTES) {
      throw AppError.validation(`Images must be under ${MAX_BYTES / 1024 / 1024} MB.`);
    }

    if (!hasMagicFor(file.mimetype, file.buffer)) {
      // The declared content-type is attacker-controlled. Checking the leading bytes stops
      // a .png header being put on something that is not a PNG.
      throw AppError.validation('That file does not look like the image type it claims to be.');
    }

    // Opaque key. The uploaded filename never reaches the filesystem — that is how path
    // traversal and unpleasant surprises with unicode filenames are avoided entirely.
    const stem = randomBytes(16).toString('hex');
    const key = `${params.storeId}/${stem}${extension}`;

    await mkdir(join(this.root, params.storeId), { recursive: true });
    await writeFile(this.pathFor(key), file.buffer);

    const { width, height, variants } = await this.deriveVariants({
      storeId: params.storeId,
      stem,
      buffer: file.buffer,
    });

    const asset = await this.prisma.mediaAsset.create({
      data: {
        storeId: params.storeId,
        key,
        mime: file.mimetype,
        bytes: file.size,
        width,
        height,
        variants,
      },
    });

    this.logger.log(
      `Stored ${key} (${file.size} bytes, ${width ?? '?'}×${height ?? '?'}, ` +
        `${Object.keys(variants).length} variant(s))`,
    );

    return {
      id: asset.id,
      key,
      url: `${this.publicBase}/${key}`,
      mime: asset.mime,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      variants: Object.fromEntries(
        Object.entries(variants).map(([name, variantKey]) => [
          name,
          `${this.publicBase}/${variantKey}`,
        ]),
      ),
      originalName: file.originalname,
    };
  }

  /**
   * Derives WebP renditions at the widths the apps actually request.
   *
   * This exists for the Flutter app more than the web: a catalog scrolling twenty full-size
   * JPEGs over a patchy 4G connection is slow enough that customers give up, and the data is
   * theirs to pay for. Downscaling a 3 MB phone photo of the menu to a 40 kB thumbnail is the
   * single largest performance win available in the whole product.
   *
   * Never widens an image — upscaling a small upload wastes bytes to produce a blurrier
   * picture — and never throws: a failed variant costs a rendition, while a failed upload
   * costs the person at the admin screen their afternoon.
   */
  private async deriveVariants(params: {
    storeId: string;
    stem: string;
    buffer: Buffer;
  }): Promise<{ width: number | null; height: number | null; variants: Record<string, string> }> {
    const variants: Record<string, string> = {};

    try {
      const image = sharp(params.buffer, { failOn: 'none' });
      const meta = await image.metadata();

      const width = meta.width ?? null;
      const height = meta.height ?? null;

      for (const [name, targetWidth] of Object.entries(VARIANT_WIDTHS)) {
        if (width !== null && width <= targetWidth) continue;

        const variantKey = `${params.storeId}/${params.stem}-${name}.webp`;

        const rendered = await sharp(params.buffer, { failOn: 'none' })
          .rotate() // Honour EXIF orientation; phone photos are routinely sideways without it.
          .resize({ width: targetWidth, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();

        await writeFile(this.pathFor(variantKey), rendered);
        variants[name] = variantKey;
      }

      return { width, height, variants };
    } catch (error) {
      this.logger.warn(
        `Stored the original but could not derive variants: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { width: null, height: null, variants };
    }
  }

  /**
   * Serves an original or one of its variants.
   *
   * Only the original has a row of its own, so a variant key is matched against the stored
   * `variants` map. Without that lookup every derived rendition would 404 and the apps would
   * silently fall back to full-size images — the exact bandwidth problem variants exist to
   * solve, failing invisibly.
   */
  async read(key: string): Promise<{ body: Buffer; mime: string }> {
    const original = await this.prisma.mediaAsset.findUnique({ where: { key } });

    const mime = original !== null ? original.mime : await this.variantMime(key);
    if (mime === null) throw AppError.notFound('Image');

    try {
      return { body: await readFile(this.pathFor(key)), mime };
    } catch {
      throw AppError.notFound('Image');
    }
  }

  async list(storeId: string, limit: number) {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return assets.map((a) => ({
      id: a.id,
      key: a.key,
      url: `${this.publicBase}/${a.key}`,
      mime: a.mime,
      bytes: a.bytes,
      width: a.width,
      height: a.height,
      variants: this.variantUrls(a.variants),
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async remove(storeId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, storeId } });
    if (asset === null) throw AppError.notFound('Image');

    await this.prisma.mediaAsset.delete({ where: { id } });

    // Variants go with the original. Leaving them behind would fill the disk with renditions
    // of images nothing references any more.
    const keys = [asset.key, ...Object.values(readVariants(asset.variants))];

    for (const key of keys) {
      try {
        await unlink(this.pathFor(key));
      } catch {
        // The row is gone, which is what callers observe. A file left behind is a cleanup
        // problem, not a correctness one, and failing here would leave the row deleted anyway.
        this.logger.warn(`Deleted asset ${key} but its file could not be removed`);
      }
    }

    return { deleted: true };
  }

  private async variantMime(key: string): Promise<string | null> {
    if (!key.endsWith('.webp')) return null;

    // Variant keys are `<storeId>/<stem>-<name>.webp`, so the original's stem identifies the
    // owning asset without needing a second table.
    const stem = key.replace(/-(thumb|card|hero)\.webp$/, '');
    if (stem === key) return null;

    const owner = await this.prisma.mediaAsset.findFirst({
      where: { key: { startsWith: stem } },
      select: { id: true },
    });

    return owner === null ? null : 'image/webp';
  }

  private variantUrls(variants: unknown): Record<string, string> {
    return Object.fromEntries(
      Object.entries(readVariants(variants)).map(([name, key]) => [
        name,
        `${this.publicBase}/${key}`,
      ]),
    );
  }

  /**
   * Resolves a key to a path inside the media root, and refuses anything that escapes it.
   *
   * Keys are generated here and should always be safe — but this is the one place a bad key
   * turns into arbitrary filesystem access, so it is checked rather than assumed.
   */
  private pathFor(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root)) {
      throw AppError.validation('Invalid media key.');
    }
    return target;
  }
}

function readVariants(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Leading bytes for the formats accepted above. */
function hasMagicFor(mime: string, buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  switch (mime) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      );
    case 'image/webp':
      return buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'image/avif':
      return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    default:
      return false;
  }
}
