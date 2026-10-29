import { Request, Response, NextFunction } from 'express';
import { UserModel } from '../../infrastructure/database/models/User.model';
import { successResponse } from '../../shared/types/ApiResponse';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { UserReportModel } from '../../infrastructure/database/models/UserReport.model';
import { UserNotificationService } from '../../application/services/UserNotificationService';

const ROLES = new Set(['admin', 'editor', 'user']);
const STATUSES = new Set(['active', 'suspended']);
const REPORT_STATUSES = new Set(['open', 'reviewing', 'resolved', 'dismissed']);

export class AdminUsersController {
  private notificationService = new UserNotificationService();

  /**
   * Weekly sign-up cohorts (last 4 weeks) with the share of users whose
   * lastLoginAt shows they came back in each following week. Real figures
   * computed from User.createdAt/lastLoginAt; weeks not fully elapsed yet
   * are reported as null instead of a made-up number.
   */
  async getRetention(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const since = new Date(now - 4 * weekMs);

      const users = await UserModel.find({ createdAt: { $gte: since } })
        .select({ createdAt: 1, lastLoginAt: 1 })
        .limit(10000)
        .lean()
        .exec();

      const cohorts = [3, 2, 1, 0].map((weeksAgo) => {
        const start = now - (weeksAgo + 1) * weekMs;
        const end = now - weeksAgo * weekMs;
        const members = users.filter((user) => {
          const created = new Date(user.createdAt).getTime();
          return created >= start && created < end;
        });
        const label = new Date(start).toISOString().slice(0, 10);
        const weeks: Array<number | null> = [1, 2, 3, 4].map((k) => {
          // Only measure week k when every member has had the chance to live it.
          if (end + k * weekMs > now) return null;
          const returned = members.filter((user) => {
            const lastLogin = user.lastLoginAt ? new Date(user.lastLoginAt).getTime() : 0;
            return lastLogin >= new Date(user.createdAt).getTime() + (k - 1) * weekMs + weekMs;
          }).length;
          return members.length ? Math.round((returned / members.length) * 100) : null;
        });
        return { cohort: label, size: members.length, weeks };
      });

      res.json(successResponse({ cohorts }));
    } catch (error) {
      next(error);
    }
  }

  async listUsers(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { search, role, status, page, limit } = req.query;
      const filters: Record<string, any> = {};

      if (search && typeof search === 'string') {
        const regex = new RegExp(search, 'i');
        filters.$or = [{ email: regex }, { name: regex }];
      }

      if (role && typeof role === 'string' && ROLES.has(role)) {
        filters.role = role;
      }

      if (status && typeof status === 'string' && STATUSES.has(status)) {
        filters.status = status;
      }

      const limitValue = this.parseNumber(limit, 20, 1, 100);
      const pageValue = this.parseNumber(page, 1, 1, 1000);
      const skip = (pageValue - 1) * limitValue;

      const [users, total, admins, suspended] = await Promise.all([
        UserModel.find(filters)
          .sort({ lastLoginAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limitValue)
          .lean()
          .exec(),
        UserModel.countDocuments(filters),
        UserModel.countDocuments({ role: 'admin' }),
        UserModel.countDocuments({ status: 'suspended' }),
      ]);

      const pages = Math.max(1, Math.ceil(total / limitValue));

      res.json(
        successResponse({
          users: users.map((user) => this.mapUser(user)),
          counts: { admins, suspended },
          pagination: {
            total,
            page: pageValue,
            limit: limitValue,
            pages,
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async updateUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { id } = req.params;
      const { role, status } = req.body || {};

      const updates: Record<string, any> = {};
      const details: Array<{ field: string; message: string; value: any }> = [];

      if (role !== undefined) {
        if (typeof role !== 'string' || !ROLES.has(role)) {
          details.push({ field: 'role', message: 'Invalid role', value: role });
        } else {
          updates.role = role;
        }
      }

      if (status !== undefined) {
        if (typeof status !== 'string' || !STATUSES.has(status)) {
          details.push({
            field: 'status',
            message: 'Invalid status',
            value: status,
          });
        } else {
          updates.status = status;
        }
      }

      if (details.length) {
        throw new ValidationError('Invalid update payload', details);
      }

      if (!Object.keys(updates).length) {
        throw new ValidationError('No fields to update', []);
      }

      const updated = await UserModel.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true }
      )
        .lean()
        .exec();

      if (!updated) {
        throw new NotFoundError('User not found');
      }

      res.json(
        successResponse({
          user: this.mapUser(updated),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async listReports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, page, limit } = req.query;
      const filters: Record<string, any> = {};
      if (status && typeof status === 'string' && REPORT_STATUSES.has(status)) {
        filters.status = status;
      }

      const limitValue = this.parseNumber(limit, 20, 1, 100);
      const pageValue = this.parseNumber(page, 1, 1, 1000);
      const skip = (pageValue - 1) * limitValue;

      const [reports, total] = await Promise.all([
        UserReportModel.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limitValue).lean().exec(),
        UserReportModel.countDocuments(filters),
      ]);

      const pages = Math.max(1, Math.ceil(total / limitValue));
      res.json(
        successResponse({
          reports: reports.map((report) => this.mapReport(report)),
          pagination: {
            total,
            page: pageValue,
            limit: limitValue,
            pages,
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async updateReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status, resolutionNote, action } = req.body || {};

      if (!status || typeof status !== 'string' || !REPORT_STATUSES.has(status)) {
        throw new ValidationError('Invalid report status', [
          { field: 'status', message: 'Invalid report status', value: status },
        ]);
      }

      const updates: Record<string, any> = {
        status,
        resolutionNote: resolutionNote ? String(resolutionNote).trim() : undefined,
        resolvedAt:
          status === 'resolved' || status === 'dismissed' ? new Date() : undefined,
      };

      const report = await UserReportModel.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true }
      )
        .lean()
        .exec();
      if (!report) {
        throw new NotFoundError('Report not found');
      }

      if (action === 'suspend' && report.targetUserId) {
        await UserModel.findByIdAndUpdate(report.targetUserId, {
          $set: { status: 'suspended' },
        }).exec();
      }

      await this.notificationService.notifyReportStatus({
        recipientId: String(report.reporterId),
        reportId: String(report._id),
        status: status as 'open' | 'reviewing' | 'resolved' | 'dismissed',
        note: updates.resolutionNote,
      });

      res.json(successResponse({ report: this.mapReport(report) }));
    } catch (error) {
      next(error);
    }
  }

  private mapUser(user: any): any {
    return {
      id: String(user._id),
      email: user.email,
      name: user.name,
      picture: user.picture,
      provider: user.provider || 'google',
      role: user.role || 'user',
      status: user.status || 'active',
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private mapReport(report: any): any {
    return {
      id: String(report._id),
      reporterId: String(report.reporterId),
      targetUserId: report.targetUserId ? String(report.targetUserId) : undefined,
      targetMessageId: report.targetMessageId ? String(report.targetMessageId) : undefined,
      type: report.type,
      reason: report.reason,
      details: report.details,
      status: report.status,
      resolutionNote: report.resolutionNote,
      resolvedBy: report.resolvedBy ? String(report.resolvedBy) : undefined,
      resolvedAt: report.resolvedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }

  private parseNumber(
    value: any,
    fallback: number,
    min: number,
    max: number
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  }
}
