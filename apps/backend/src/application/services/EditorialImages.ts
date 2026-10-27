import { createHash } from 'node:crypto';
import { AI_IMAGE_RIGHTS, ImageAsset } from './EditorialEvidence';
import type { EditorialFinding } from './EditorialReviewPolicy';

/**
 * M11-C cover images (docs/adr/0001 Decision 2): brief → provider → checks → asset record. Original
 * illustrations only; never posters, stills, logos or real people. Storage and derivatives are the
 * media store's job (infrastructure); nothing here writes anywhere.
 */

/** Same shape as Auctorio's ImageProvider.generate(), so its adapter can be dropped in later. */
export interface ImageRequest { prompt: string; model: string; width: number; height: number; seed?: number }
export interface ImageResult { bytes: Buffer; provider: string; model: string; contentType: string }
export interface ImageModel {
  readonly provider: string;
  generate(request: ImageRequest): Promise<ImageResult>;
}
export interface ImageRoute { provider: string; model: string }

export const COVER = Object.freeze({ width: 1600, height: 900 });
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MEDIA_PREFIX = '/storage/editorial';
/** Public URL of the largest derivative the media store writes for an original. */
export const coverUrl = (sha256: string) => `${MEDIA_PREFIX}/${sha256}-${COVER.width}.webp`;

const HOUSE_STYLE = 'Ilustración editorial plana y abstracta, formas geométricas, paleta oscura con acentos de color, composición limpia 16:9.';
const NEVER = 'Sin texto, letras, números ni logotipos. Sin marcas, carteles de películas o series, fotogramas, capturas de pantalla, personajes reconocibles ni personas reales.';

/** The brief comes from the approved article only, so it is reviewable and never invents a scene. */
export function coverRequest(article: { title: string; categories: string[] }, model: string): ImageRequest {
  const theme = article.title.replace(/["«»]/g, '').slice(0, 140);
  return { prompt: `${HOUSE_STYLE} Tema: ${theme}. Categoría: ${article.categories.join(', ') || 'televisión'}. ${NEVER}`, model, ...COVER };
}

/** Alt text describes what the illustration is for; it never claims to show the film, programme or people. */
export const coverAltText = (title: string) => `Ilustración generada por IA para el artículo «${title.slice(0, 120)}»`;

/** Format and pixel size from the file header (PNG, JPEG, WebP); null for anything else. */
export function imageInfo(bytes: Buffer): { contentType: string; width: number; height: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('latin1', 12, 16) === 'IHDR') {
    return { contentType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { contentType: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { contentType: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = bytes.readUInt32LE(21);
      return { contentType: 'image/webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    return null;
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the segments to the first start-of-frame marker (SOF0-15 minus DHT, JPG, DAC).
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { contentType: 'image/jpeg', width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** What makes a generated file unusable: wrong format, size, or not the requested frame. */
export function imageProblems(result: ImageResult, request: ImageRequest): string[] {
  const info = imageInfo(result.bytes);
  if (!info) return ['el fichero no es PNG, JPEG ni WebP'];
  const out: string[] = [];
  if (result.bytes.length > MAX_IMAGE_BYTES) out.push(`${result.bytes.length} bytes > ${MAX_IMAGE_BYTES}`);
  if (info.contentType !== result.contentType) out.push(`declara ${result.contentType} pero es ${info.contentType}`);
  if (info.width < request.width * 0.75) out.push(`${info.width} px de ancho, mínimo ${Math.ceil(request.width * 0.75)}`);
  if (Math.abs(info.width / info.height - request.width / request.height) > 0.01) out.push(`proporción ${info.width}×${info.height}, se pidió ${request.width}×${request.height}`);
  return out;
}

/**
 * For every post, whatever its origin: a generated picture (under MEDIA_PREFIX) is publishable only as a
 * non-mock image recorded in the post's own provenance. Dropping the provenance cannot launder a test image.
 */
export function generatedImageFindings(post: { featuredImage?: { sourceUrl?: string }; seo?: { ogImage?: string }; editorial?: { images?: ImageAsset[] } }): EditorialFinding[] {
  const images = Array.isArray(post.editorial?.images) ? post.editorial!.images : [];
  return [post.featuredImage?.sourceUrl, post.seo?.ogImage]
    .filter((url): url is string => typeof url === 'string' && url.startsWith(`${MEDIA_PREFIX}/`))
    .filter((url) => !images.some((i) => i?.url === url && i.provider !== 'mock'))
    .map((url) => ({ severity: 'block' as const, code: 'generated-image-unverified', message: `Imagen generada sin procedencia válida: ${url}` }));
}

export function coverAsset(result: ImageResult, request: ImageRequest, title: string, costUsd: number, createdAt: string): ImageAsset {
  const sha256 = createHash('sha256').update(result.bytes).digest('hex');
  const info = imageInfo(result.bytes)!;
  return {
    assetId: `img-${sha256.slice(0, 16)}`, purpose: 'cover', url: coverUrl(sha256), width: info.width, height: info.height,
    contentType: info.contentType, sha256, provider: result.provider, model: result.model, prompt: request.prompt,
    altText: coverAltText(title), rights: AI_IMAGE_RIGHTS, costUsd, createdAt,
  };
}
