import { Request, Response } from 'express';
import { AuthService } from '../../domain/services/AuthService';
import { BadRequestError, UnauthorizedError } from '../../shared/errors';

/**
 * HTTP controller for authentication endpoints.
 */
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * POST /v2/auth/google
   * Body: { idToken: string }
   *
   * Exchanges a Google token for an application session.
   */
  async loginWithGoogle(req: Request, res: Response): Promise<void> {
    const idToken = req.body?.idToken;
    if (!idToken) {
      throw new BadRequestError('idToken is required');
    }

    const result = await this.authService.loginWithGoogle(idToken, this.buildSessionContext(req));
    res.json({
      success: true,
      data: result,
    });
  }

  /**
   * POST /v2/auth/login
   * Body: { email: string, password: string }
   */
  async loginWithPassword(req: Request, res: Response): Promise<void> {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const password =
      typeof req.body?.password === 'string' ? req.body.password : '';

    const result = await this.authService.loginWithPassword(
      {
        email,
        password,
      },
      this.buildSessionContext(req)
    );
    res.json({
      success: true,
      data: result,
    });
  }

  /**
   * POST /v2/auth/register
   * Body: { name?: string, email: string, password: string }
   */
  async registerWithPassword(req: Request, res: Response): Promise<void> {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const password =
      typeof req.body?.password === 'string' ? req.body.password : '';
    const name = typeof req.body?.name === 'string' ? req.body.name : undefined;

    const result = await this.authService.registerWithPassword(
      {
        email,
        password,
        name,
      },
      this.buildSessionContext(req)
    );
    res.json({
      success: true,
      data: result,
    });
  }

  /**
   * GET /v2/auth/me
   * Header: Authorization: Bearer <jwt>
   *
   * Returns the user associated with the provided JWT.
   */
  async me(req: Request, res: Response): Promise<void> {
    const token = extractAccessToken(req);
    if (!token) {
      throw new UnauthorizedError('Authorization token missing');
    }

    const user = await this.authService.getSession(token);
    res.json({
      success: true,
      data: user,
    });
  }

  async refresh(req: Request, res: Response): Promise<void> {
    const refreshToken = typeof req.body?.refreshToken === 'string'
      ? req.body.refreshToken
      : '';
    if (!refreshToken) {
      throw new BadRequestError('refreshToken is required');
    }

    const result = await this.authService.refreshSession(
      refreshToken,
      this.buildSessionContext(req)
    );

    res.json({
      success: true,
      data: result,
    });
  }

  async sessions(req: Request, res: Response): Promise<void> {
    const token = extractAccessToken(req);
    if (!token) {
      throw new UnauthorizedError('Authorization token missing');
    }

    const payload = this.authService.getAccessTokenPayload(token);
    const sessions = await this.authService.getSessionsForUser(payload.sub, payload.sid);
    res.json({
      success: true,
      data: { sessions },
    });
  }

  async revokeSession(req: Request, res: Response): Promise<void> {
    const token = extractAccessToken(req);
    if (!token) {
      throw new UnauthorizedError('Authorization token missing');
    }

    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) {
      throw new BadRequestError('session id is required');
    }

    const payload = this.authService.getAccessTokenPayload(token);
    await this.authService.revokeSessionById(payload.sub, sessionId);

    res.json({ success: true, data: { revoked: true } });
  }

  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = typeof req.body?.refreshToken === 'string'
      ? req.body.refreshToken
      : '';
    if (refreshToken) {
      await this.authService.revokeSessionByRefreshToken(refreshToken);
    }
    res.json({ success: true, data: { revoked: true } });
  }

  async logoutAll(req: Request, res: Response): Promise<void> {
    const token = extractAccessToken(req);
    if (!token) {
      throw new UnauthorizedError('Authorization token missing');
    }

    const payload = this.authService.getAccessTokenPayload(token);
    await this.authService.revokeAllSessions(payload.sub);

    res.json({ success: true, data: { revokedAll: true } });
  }

  async forgotPassword(req: Request, res: Response): Promise<void> {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const resetBaseUrl = typeof req.body?.resetBaseUrl === 'string'
      ? req.body.resetBaseUrl
      : undefined;

    if (!email) {
      throw new BadRequestError('email is required');
    }

    await this.authService.requestPasswordReset(email, resetBaseUrl);
    res.json({
      success: true,
      data: {
        accepted: true,
      },
    });
  }

  async resetPassword(req: Request, res: Response): Promise<void> {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const password = typeof req.body?.password === 'string'
      ? req.body.password
      : '';

    if (!token || !password) {
      throw new BadRequestError('token and password are required');
    }

    await this.authService.resetPassword(token, password);
    res.json({
      success: true,
      data: { reset: true },
    });
  }

  async changePassword(req: Request, res: Response): Promise<void> {
    const token = extractAccessToken(req);
    if (!token) {
      throw new UnauthorizedError('Authorization token missing');
    }

    const payload = this.authService.getAccessTokenPayload(token);
    const currentPassword = typeof req.body?.currentPassword === 'string'
      ? req.body.currentPassword
      : '';
    const newPassword = typeof req.body?.newPassword === 'string'
      ? req.body.newPassword
      : '';

    if (!currentPassword || !newPassword) {
      throw new BadRequestError('currentPassword and newPassword are required');
    }

    await this.authService.changePassword(payload.sub, currentPassword, newPassword);
    res.json({
      success: true,
      data: { changed: true },
    });
  }

  private buildSessionContext(req: Request): {
    userAgent?: string;
    ipAddress?: string;
    deviceName?: string;
  } {
    return {
      userAgent: String(req.header('user-agent') || '').trim() || undefined,
      // req.ip, not the leftmost X-Forwarded-For entry: that one is whatever the client sent (trustProxy.ts).
      ipAddress: req.ip || undefined,
      deviceName:
        (typeof req.body?.deviceName === 'string'
          ? req.body.deviceName
          : ''
        ).trim() || undefined,
    };
  }
}

/**
 * Extracts a bearer token from Authorization header only.
 */
function extractAccessToken(req: Request): string | null {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}
