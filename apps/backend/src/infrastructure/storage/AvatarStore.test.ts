import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { IStorageRepository } from '../../domain/repositories/IStorageRepository';
import { AvatarRejected, MAX_AVATAR_BYTES, storeAvatar } from './AvatarStore';

const memoryStorage = () => {
  const files = new Map<string, { bytes: Buffer; contentType?: string }>();
  const storage = {
    upload: async (path: string, content: Buffer | string, options?: { contentType?: string; public?: boolean }) => {
      files.set(path, { bytes: Buffer.from(content), contentType: options?.contentType });
      return options?.public ? `/storage/${path}` : path;
    },
  } as unknown as IStorageRepository;
  return { storage, files };
};

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();

test('a photo is stored as a 256 px WebP square under avatars/', async () => {
  const { storage, files } = memoryStorage();

  const url = await storeAvatar(storage, 'user-42', await png(800, 500));

  assert.match(url, /^\/storage\/avatars\/user42-[0-9a-f]{16}\.webp$/);
  const [stored] = [...files.values()];
  assert.equal(stored.contentType, 'image/webp');
  const meta = await sharp(stored.bytes).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
});

test('anything that is not a real PNG, JPEG or WebP is refused', async () => {
  const { storage, files } = memoryStorage();

  await assert.rejects(storeAvatar(storage, 'u1', Buffer.from('<svg onload=alert(1)>')), AvatarRejected);
  await assert.rejects(storeAvatar(storage, 'u1', Buffer.alloc(0)), AvatarRejected);
  await assert.rejects(storeAvatar(storage, 'u1', Buffer.alloc(MAX_AVATAR_BYTES + 1)), AvatarRejected);
  assert.equal(files.size, 0);
});
