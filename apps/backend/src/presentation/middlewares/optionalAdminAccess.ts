import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../domain/services/AuthService';

export const BLOG_ADMIN_FLAG = 'blogAdmin';

/**
 * Marks the request as admin (sets req.blogAdmin = true) when the caller
 * authenticates with the admin key or with a session whose role is admin.
 * Never rejects: public callers just continue unflagged.
 */
export const createOptionalAdminAccess =
  (authService: AuthService) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const requiredKey = process.env.ANALYTICS_ADMIN_KEY;
      const headerKey = req.header('x-admin-key');
      const authHeader = req.header('authorization') || '';
      const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7)
        : undefined;

      if (requiredKey && (headerKey === requiredKey || bearerToken === requiredKey)) {
        (req as unknown as Record<string, unknown>)[BLOG_ADMIN_FLAG] = true;
        next();
        return;
      }

      if (bearerToken) {
        const user = await authService.getSession(bearerToken);
        if (user.role === 'admin') {
          (req as unknown as Record<string, unknown>)[BLOG_ADMIN_FLAG] = true;
        }
      }
    } catch {
      // Invalid or expired session: treat as a public caller.
    }
    next();
  };
