import { createHash } from 'node:crypto';
import type { IStorageRepository } from '../../domain/repositories/IStorageRepository';
import { COVER, coverUrl, imageInfo, MAX_IMAGE_BYTES } from '../../application/services/EditorialImages';

export class EditorialMediaRejected extends Error {}

const WIDTHS = [COVER.width, 800] as const;
const MAX_SIDE = 4096;

/**
 * Stores a generated cover: the original, then WebP derivatives at fixed widths, content-addressed by the
 * original's SHA-256 so the URL in the signed provenance is known before upload and a re-upload is a no-op.
 * The bytes are decoded here (not only sniffed), so a corrupt or disguised file never reaches /storage.
 */
export async function storeEditorialCover(storage: IStorageRepository, bytes: Buffer, expectedSha256: string): Promise<{ url: string; width: number; height: number; sha256: string }> {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new EditorialMediaRejected(`size ${bytes.length} outside 1..${MAX_IMAGE_BYTES} bytes`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256) throw new EditorialMediaRejected('sha256 does not match the provenance asset');
  const info = imageInfo(bytes);
  // A tiny file can declare enormous dimensions; refuse before anything decodes it.
  if (info && (info.width > MAX_SIDE || info.height > MAX_SIDE)) throw new EditorialMediaRejected(`${info.width}×${info.height} exceeds ${MAX_SIDE} px`);
  // Loaded on first upload: a missing native binary then fails this request, not the whole API at boot.
  const sharp = (await import('sharp')).default;
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!info || !meta || meta.width !== info.width || meta.height !== info.height || !['png', 'jpeg', 'webp'].includes(String(meta.format))) {
    throw new EditorialMediaRejected('not a decodable PNG, JPEG or WebP image');
  }
  const ext = info.contentType.split('/')[1];
  const original = `editorial/${sha256}.${ext}`;
  if (!(await storage.exists(original))) {
    for (const width of WIDTHS) {
      const webp = await sharp(bytes).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
        .catch((error: Error) => { throw new EditorialMediaRejected(`cannot decode: ${error.message}`); });
      const url = await storage.upload(`editorial/${sha256}-${width}.webp`, webp, { contentType: 'image/webp', public: true });
      // shortcut: the signed cover URL assumes the local adapter served at /storage; an S3 adapter needs its own URL scheme.
      if (width === COVER.width && url !== coverUrl(sha256)) throw new EditorialMediaRejected(`storage returned ${url}, expected ${coverUrl(sha256)}`);
    }
    // Original last: its presence marks a complete set for the idempotency check above.
    await storage.upload(original, bytes, { contentType: info.contentType, public: true });
  }
  return { url: coverUrl(sha256), width: info.width, height: info.height, sha256 };
}
