/**
 * Football ops controller — admin-only diagnostics + read-model surface.
 *
 * Mounted behind `createAdminAccessGuard` (never public). Every handler answers
 * from stored projections only: no handler ever triggers an upstream provider
 * call. Query parameters are validated with the hand-rolled parsers in
 * `FootballAdminDTO`; a malformed value is answered 400 before any database
 * access.
 */

import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@/shared/types/ApiResponse';
import { FootballDiagnosticsReport } from '@/application/sports/ingestion/types';
import { redactDiagnostics } from '@/application/sports/ingestion/util';
import { FootballAdminService } from '@/application/sports/services/FootballAdminService';
import {
  parseMatchListQuery,
  parseAuditQuery,
  parseEntityMappingQuery,
  parseSearch,
} from '@/application/sports/dto/FootballAdminDTO';

export interface FootballDiagnosticsSource {
  diagnostics(): FootballDiagnosticsReport;
}

export class FootballOpsController {
  constructor(
    private readonly ingestion: FootballDiagnosticsSource,
    private readonly adminService: FootballAdminService = new FootballAdminService()
  ) {}

  async diagnostics(_req: Request, res: Response): Promise<void> {
    const report = redactDiagnostics(this.ingestion.diagnostics());
    res.status(200).json(successResponse(report, { generatedAt: report.generatedAt }));
  }

  async dashboard(_req: Request, res: Response): Promise<void> {
    const data = await this.adminService.dashboard();
    res.status(200).json(successResponse(data, { generatedAt: data.generatedAt }));
  }

  async listProviders(_req: Request, res: Response): Promise<void> {
    const providers = await this.adminService.listProviders();
    res.status(200).json(successResponse({ providers }));
  }

  async providerDetail(req: Request, res: Response): Promise<void> {
    const provider = parseSearch(req.params.provider, 'provider');
    if (!provider.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', provider.message));
      return;
    }
    const detail = await this.adminService.providerDetail(provider.value!);
    if (!detail) {
      res.status(404).json(errorResponse('NOT_FOUND', `Unknown provider "${provider.value}"`));
      return;
    }
    res.status(200).json(successResponse(detail));
  }

  async coverage(_req: Request, res: Response): Promise<void> {
    const matrix = await this.adminService.coverageMatrix();
    res.status(200).json(successResponse(matrix));
  }

  async listMatches(req: Request, res: Response): Promise<void> {
    const query = parseMatchListQuery(req.query as Record<string, unknown>);
    if (!query.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', query.message));
      return;
    }
    res.status(200).json(successResponse(await this.adminService.listMatches(query.value)));
  }

  async matchDetail(req: Request, res: Response): Promise<void> {
    const idOrSlug = parseSearch(req.params.idOrSlug, 'idOrSlug');
    if (!idOrSlug.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', idOrSlug.message));
      return;
    }
    const match = await this.adminService.matchDetail(idOrSlug.value!);
    if (!match) {
      res.status(404).json(errorResponse('NOT_FOUND', 'Match not found in stored snapshots'));
      return;
    }
    res.status(200).json(successResponse(match));
  }

  async listEntityMappings(req: Request, res: Response): Promise<void> {
    const query = parseEntityMappingQuery(req.query as Record<string, unknown>);
    if (!query.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', query.message));
      return;
    }
    res.status(200).json(successResponse(await this.adminService.listEntityMappings(query.value)));
  }

  async listBroadcasts(req: Request, res: Response): Promise<void> {
    const query = parseMatchListQuery(req.query as Record<string, unknown>);
    if (!query.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', query.message));
      return;
    }
    res.status(200).json(successResponse(await this.adminService.listBroadcasts(query.value)));
  }

  async ingestionStatus(_req: Request, res: Response): Promise<void> {
    res.status(200).json(successResponse(await this.adminService.ingestionStatus()));
  }

  async qualityIssues(req: Request, res: Response): Promise<void> {
    const query = parseMatchListQuery(req.query as Record<string, unknown>);
    if (!query.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', query.message));
      return;
    }
    res.status(200).json(successResponse(await this.adminService.qualityIssues(query.value)));
  }

  async listAudit(req: Request, res: Response): Promise<void> {
    const query = parseAuditQuery(req.query as Record<string, unknown>);
    if (!query.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', query.message));
      return;
    }
    res.status(200).json(successResponse(await this.adminService.listAudit(query.value)));
  }

  async sync(req: Request, res: Response): Promise<void> {
    const idempotencyKey = parseSearch(req.body?.idempotencyKey, 'idempotencyKey');
    if (!idempotencyKey.ok) {
      res.status(400).json(errorResponse('INVALID_PARAMS', idempotencyKey.message));
      return;
    }
    const actor = typeof req.header('x-admin-key') === 'string' ? 'admin-key' : 'admin';
    res.status(202).json(successResponse(await this.adminService.enqueueSync(actor, idempotencyKey.value)));
  }
}
