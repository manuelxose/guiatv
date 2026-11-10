import { createHash } from 'node:crypto';
import type { IStorageRepository } from '../../domain/repositories/IStorageRepository';

export class AvatarRejected extends Error {}

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const SIZE = 256;
const MAX_SIDE = 8000;

/**
 * Stores a profile photo: decoded (not just sniffed) so a disguised or corrupt file is refused, rotated by its EXIF,
 * cropped to a 256 px square and re-encoded as WebP, which also drops every metadata block (GPS, camera…).
 * The key is content-addressed, so a new photo gets a new URL and caches never show the old one.
 */
export async function storeAvatar(storage: IStorageRepository, userId: string, bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw new AvatarRejected(`La imagen debe pesar menos de ${MAX_AVATAR_BYTES / 1024 / 1024} MB`);
  // Loaded on first upload: a missing native binary then fails this request, not the whole API at boot.
  const sharp = (await import('sharp')).default;
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta || !meta.width || !meta.height || !['png', 'jpeg', 'webp'].includes(String(meta.format))) {
    throw new AvatarRejected('Sube una imagen PNG, JPEG o WebP');
  }
  if (meta.width > MAX_SIDE || meta.height > MAX_SIDE) throw new AvatarRejected(`La imagen no puede superar ${MAX_SIDE} px por lado`);

  const webp = await sharp(bytes)
    .rotate()
    .resize(SIZE, SIZE, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toBuffer()
    .catch(() => {
      throw new AvatarRejected('No se pudo leer la imagen');
    });
  const owner = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'user';
  const hash = createHash('sha256').update(webp).digest('hex').slice(0, 16);
  return storage.upload(`avatars/${owner}-${hash}.webp`, webp, { contentType: 'image/webp', public: true });
}
