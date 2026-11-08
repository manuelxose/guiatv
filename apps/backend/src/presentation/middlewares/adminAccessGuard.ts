import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../domain/services/AuthService';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors';
import { AuthenticatedRequest } from './authGuard';

/**
 * Constant-time string comparison (M06 / LOW-05).
 *
 * `provided !== requiredKey` leaks the length of the shared prefix through
 * timing. `timingSafeEqual` requires equal-length buffers, so a length mismatch
 * is rejected first — that still discloses only the length, never the content,
 * and the comparison itself runs in constant time.
 */
function safeEqual(provided: string, required: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(required, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extracts the bearer token from an `Authorization` header, or null.
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * The single shared admin authorization boundary.
 *
 * Accepts EITHER:
 *   - the shared `ANALYTICS_ADMIN_KEY` (via `x-admin-key` header or a
 *     `Bearer` token), compared in constant time; OR
 *   - an authenticated session whose role is `admin` (via `authService`).
 *
 * Rejects everything else. Fails closed: when neither a configured key nor a
 * usable auth service exists, an authenticated request can never be admitted,
 * and a request without any credential is rejected outright.
 *
 * `authService` is injectable so routes can be unit-tested without a live
 * MongoDB.
 */
export const createAdminAccessGuard =
  (authService?: AuthService) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const requiredKey = process.env.ANALYTICS_ADMIN_KEY;
      const headerKey = req.header('x-admin-key');
      const bearerToken = extractToken(req);

      const keyMatches =
        requiredKey != null &&
        requiredKey.length > 0 &&
        ((headerKey != null && safeEqual(headerKey, requiredKey)) ||
          (bearerToken != null && safeEqual(bearerToken, requiredKey)));

      if (keyMatches) {
        next();
        return;
      }

      // No key matched — require an authenticated admin session.
      if (!bearerToken) {
        throw new UnauthorizedError('Authorization token missing');
      }

      // Fail closed: without a usable auth service no session can be verified,
      // so an unkeyed request must never be admitted.
      if (!authService || typeof authService.getSession !== 'function') {
        throw new ForbiddenError('Admin authorization is not configured');
      }

      const user = await authService.getSession(bearerToken);
      (req as AuthenticatedRequest).user = user;

      if (user.role !== 'admin') {
        throw new ForbiddenError('Admin access required');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
