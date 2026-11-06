/**
 * Football ops controller — admin-only diagnostics surface.
 *
 * The route factory mounts this behind the repo's existing `analyticsAdminGuard`
 * (never public). The controller delegates to the ingestion service and applies
 * a final deep redaction so no credential value or keyed URL can leak, even if a
 * future caller forgets to sanitize a field.
 */

import { Request, Response } from 'express';
import { successResponse } from '@/shared/types/ApiResponse';
import { FootballDiagnosticsReport } from '@/application/sports/ingestion/types';
import { redactDiagnostics } from '@/application/sports/ingestion/util';

export interface FootballDiagnosticsSource {
  diagnostics(): FootballDiagnosticsReport;
}

export class FootballOpsController {
  constructor(private readonly ingestion: FootballDiagnosticsSource) {}

  async diagnostics(_req: Request, res: Response): Promise<void> {
    const report = redactDiagnostics(this.ingestion.diagnostics());
    res.status(200).json(successResponse(report, { generatedAt: report.generatedAt }));
  }
}
