import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../shared/errors';

/**
 * Constant-time string comparison (M06 / LOW-05).
 *
 * `provided !== requiredKey` leaks the length of the shared prefix through timing.
 * `timingSafeEqual` requires equal-length buffers, so a length mismatch is
 * rejected first — that still discloses only the length, never the content, and
 * the comparison itself runs in constant time.
 */
function safeEqual(provided: string, required: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(required, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const analyticsAdminGuard = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const requiredKey = process.env.ANALYTICS_ADMIN_KEY;
  // Fail closed: no configured key means no access, never an open door.
  if (!requiredKey) {
    throw new ForbiddenError('Admin key is not configured');
  }

  const headerKey = req.header('x-admin-key');
  const bearer = req.header('authorization');
  const bearerKey = bearer?.toLowerCase().startsWith('bearer ')
    ? bearer.slice(7)
    : undefined;
  const provided = headerKey || bearerKey;

  if (!provided || !safeEqual(provided, requiredKey)) {
    throw new ForbiddenError('Invalid admin key');
  }

  next();
};
