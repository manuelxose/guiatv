import path from 'path';
import { readFile } from 'node:fs/promises';
import { Request, Response, NextFunction } from 'express';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { PUBLIC_EDITORIAL_FILTER } from '../../application/services/EditorialReviewPolicy';
import { coverUrl } from '../../application/services/EditorialImages';

/** Same directory LocalStorageRepository writes to: STORAGE_LOCAL_PATH, otherwise <cwd>/tmp-storage. */
export const storageRoot = (): string => (process.env.STORAGE_LOCAL_PATH
  ? path.resolve(process.env.STORAGE_LOCAL_PATH)
  : path.join(process.cwd(), 'tmp-storage'));

const FILE = /^\/([0-9a-f]{64})(?:-\d+)?\.(?:webp|png|jpg)$/;

/** Published means a public post points at the cover or carries it in its provenance. */
const isPublished = (sha256: string) => BlogPostModel.exists({
  ...PUBLIC_EDITORIAL_FILTER,
  $or: [{ 'editorial.images.sha256': sha256 }, { 'featuredImage.sourceUrl': coverUrl(sha256) }],
}).exec();

/**
 * M11-D: generated covers under /storage/editorial are anonymous only once their article is public. A draft's cover
 * is a 404 for everyone, URL known or not; the Admin previews it through its own authenticated API (coverPreview).
 * shortcut: one unindexed lookup per image request; cache the published set if cover traffic ever matters.
 */
export const editorialMediaGate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sha256 = FILE.exec(req.path)?.[1];
    if (sha256 && (await isPublished(sha256))) { next(); return; }
    res.set('Cache-Control', 'no-store').status(404).end();
  } catch (error) {
    next(error);
  }
};

/** The 800 px derivative of an editorial cover as a data URL, for the authenticated Admin view only. */
export async function editorialCoverPreview(url: string | null | undefined): Promise<string | null> {
  const sha256 = /^\/storage\/editorial\/([0-9a-f]{64})-\d+\.webp$/.exec(url ?? '')?.[1];
  if (!sha256) return null;
  const bytes = await readFile(path.join(storageRoot(), 'editorial', `${sha256}-800.webp`)).catch(() => null);
  return bytes ? `data:image/webp;base64,${bytes.toString('base64')}` : null;
}
