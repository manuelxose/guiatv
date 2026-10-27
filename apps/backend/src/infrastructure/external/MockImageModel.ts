import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { ImageModel, ImageRequest, ImageResult } from '../../application/services/EditorialImages';

/**
 * Local stand-in for an image provider: a deterministic gradient PNG of the requested size, derived from
 * the prompt. It exercises storage, checks, cost and preview end to end; its provider id is `mock`, which
 * the evidence gate refuses to publish.
 */
export class MockImageModel implements ImageModel {
  readonly provider = 'mock';

  async generate(request: ImageRequest): Promise<ImageResult> {
    return { bytes: gradientPng(request.width, request.height, request.prompt), provider: this.provider, model: request.model, contentType: 'image/png' };
  }
}

function gradientPng(width: number, height: number, seed: string): Buffer {
  const [r, g, b] = createHash('sha256').update(seed).digest();
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      row[1 + x * 3] = r * t;
      row[2 + x * 3] = g * (1 - t);
      row[3 + x * 3] = 40 + b * t * 0.5;
    }
    row.copy(raw, y * row.length);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
