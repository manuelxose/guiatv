// src/v2/presentation/controllers/AdminController.ts

import { Request, Response } from 'express';
import { SyncEPGData } from '../../application/use-cases/SyncEPGData';
import { PrecomputeSchedule } from '../../application/use-cases/PrecomputeSchedule';
import { CleanOldPrograms } from '../../application/use-cases/CleanOldPrograms';
import { ICacheRepository } from '../../domain/repositories/ICacheRepository';
import { DateUtils } from '../../shared/utils/dateUtils';
import { logger } from '../../shared/utils/logger';
import { ValidationError } from '../../shared/errors';
import { successResponse } from '../../shared/types/ApiResponse';
import { ResetSystem } from '../../application/use-cases/ResetSystem';
import { AdminEpgDiagnosticsService } from '../../application/services/AdminEpgDiagnosticsService';
import { AdminProviderRegistryService } from '../../application/services/AdminProviderRegistryService';
import { SECONDARY_EPG_SOURCE_URL } from '../../shared/config/epgSources';
import { AdminOperationsService } from '../../application/services/AdminOperationsService';

/**
 * Administrative controller that orchestrates maintenance and data workflows.
 */
export class AdminController {
  private readonly adminLogger = logger.child('AdminController');

  constructor(
    private readonly syncEPGData: SyncEPGData,
    private readonly precomputeSchedule: PrecomputeSchedule,
    private readonly cleanOldPrograms: CleanOldPrograms,
    private readonly cacheRepository: ICacheRepository,
    private readonly resetSystem: ResetSystem,
    private readonly epgDiagnostics: AdminEpgDiagnosticsService,
    private readonly providerRegistry: AdminProviderRegistryService,
    private readonly operations: AdminOperationsService
  ) {}

  async getEpgOverview(_req: Request, res: Response): Promise<void> {
    res.status(200).json(successResponse(await this.epgDiagnostics.getOverview()));
  }

  async listEpgChannels(req: Request, res: Response): Promise<void> {
    const query = req.query;
    res.status(200).json(successResponse(await this.epgDiagnostics.listChannels({
      page: Number(query.page) || 1, limit: Number(query.limit) || 25,
      search: typeof query.search === 'string' ? query.search : undefined,
      access: typeof query.access === 'string' ? query.access : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
    })));
  }

  async listProviders(_req: Request, res: Response): Promise<void> {
    res.status(200).json(successResponse(this.providerRegistry.list()));
  }
  async getFootballOverview(_req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.footballOverview())); }
  async listFootballCompetitions(req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.listCompetitions({ page: Number(req.query.page), limit: Number(req.query.limit), search: typeof req.query.search === 'string' ? req.query.search : undefined, stale: req.query.stale === 'true' }))); }
  async listFootballTeams(req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.listTeams({ page: Number(req.query.page), limit: Number(req.query.limit), search: typeof req.query.search === 'string' ? req.query.search : undefined, stale: req.query.stale === 'true' }))); }
  async listFootballFixtures(req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.listFixtures({ dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined, competitionSlug: typeof req.query.competition === 'string' ? req.query.competition : undefined, teamSlug: typeof req.query.team === 'string' ? req.query.team : undefined, status: typeof req.query.status === 'string' ? req.query.status as any : undefined, limit: Number(req.query.limit) || 50 }))); }
  async listJobs(req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.listJobs({ page: Number(req.query.page), limit: Number(req.query.limit), status: typeof req.query.status === 'string' ? req.query.status : undefined, type: typeof req.query.type === 'string' ? req.query.type : undefined }))); }
  async listScheduledJobs(_req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.scheduledJobs())); }
  async runScheduledJob(req: Request, res: Response): Promise<void> { res.status(202).json(successResponse(await this.operations.runScheduled(String(req.params.name || ''), this.actor(req)))); }
  async getCacheDiagnostics(_req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.cacheDiagnostics())); }
  async listOperationalEvents(req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.listEvents({ page: Number(req.query.page), limit: Number(req.query.limit), severity: typeof req.query.severity === 'string' ? req.query.severity : undefined, subsystem: typeof req.query.subsystem === 'string' ? req.query.subsystem : undefined, correlationId: typeof req.query.correlationId === 'string' ? req.query.correlationId : undefined }))); }
  async listAlerts(_req: Request, res: Response): Promise<void> { res.json(successResponse(await this.operations.listAlerts())); }
  async refreshFootball(req: Request, res: Response): Promise<void> { res.status(202).json(successResponse(await this.operations.refreshFootballData(this.actor(req)))); }
  async invalidateCacheNamespace(req: Request, res: Response): Promise<void> { const namespace = String(req.body?.namespace || ''); res.json(successResponse(await this.operations.invalidateCache(namespace, this.actor(req)))); }

  /**
   * @openapi
   * /v2/admin/sync:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Sincronizar EPG manualmente
   *     description: Descarga y procesa el archivo XMLTV
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               date:
   *                 type: string
   *                 description: Fecha a sincronizar (YYYYMMDD)
   *               forceRefresh:
   *                 type: boolean
   *                 description: Forzar descarga aunque exista cache
   *     responses:
   *       200:
   *         description: Sincronización completada
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  /**
   * Executes an on-demand EPG sync, optionally asynchronous.
   */
  async triggerSync(req: Request, res: Response): Promise<void> {
    const { date, forceRefresh, sourceUrl, async = false } = req.body;

    this.adminLogger.info('Manual sync triggered', {
      date,
      forceRefresh,
      sourceUrl,
      async,
    });

    const dateToSync = DateUtils.parseDateAlias(date || 'today');

    if (async) {
      const job = await this.operations.enqueue('epg.sync', this.actor(req), () => this.syncEPGData.execute({
          sourceUrl:
            sourceUrl || SECONDARY_EPG_SOURCE_URL,
          date: dateToSync,
          forceRefresh: forceRefresh === true,
        }));

      res.status(202).json(
        successResponse({ message: 'Sync started asynchronously', job })
      );
      return;
    }

    const result = await this.syncEPGData.execute({
      sourceUrl:
        sourceUrl || SECONDARY_EPG_SOURCE_URL,
      date: dateToSync,
      forceRefresh: forceRefresh === true,
    });

    res.status(200).json(
      successResponse(
        {
          message: result.success
            ? 'Sync completed successfully'
            : 'Sync completed with errors',
          result,
        },
        { cached: false }
      )
    );
  }

  /**
   * @openapi
   * /v2/admin/precompute:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Precomputar horarios
   *     description: Genera y guarda los JSONs estáticos para la fecha indicada
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               date:
   *                 type: string
   *                 description: Fecha a procesar (YYYYMMDD)
   *     responses:
   *       200:
   *         description: Precomputación completada
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  /**
   * Starts precomputation for a specific date.
   */
  async triggerPrecompute(req: Request, res: Response): Promise<void> {
    const { date, fields, async = false } = req.body;

    this.adminLogger.info('Manual precompute triggered', { date, fields, async });

    const dateToPrecompute = DateUtils.parseDateAlias(date || 'today');

    if (async) {
      const job = await this.operations.enqueue('schedule.precompute', this.actor(req), () => this.precomputeSchedule.execute({
          date: dateToPrecompute,
          fields: (fields as any) || 'full',
        }));

      res.status(202).json(
        successResponse({ message: 'Precompute started asynchronously', job })
      );
      return;
    }

    const result = await this.precomputeSchedule.execute({
      date: dateToPrecompute,
      fields: (fields as any) || 'full',
    });

    res.status(200).json(
      successResponse(
        {
          message: 'Precompute completed successfully',
          result,
        },
        { cached: false }
      )
    );
  }

  /**
   * @openapi
   * /v2/admin/precompute-window:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Precomputar el rango ayer/hoy/mañana/pasado
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               fields:
   *                 type: string
   *                 enum: [minimal, full]
   *                 default: full
   *     responses:
   *       200:
   *         description: Precomputación completada
   */
  /**
   * Precomputes the canonical rolling window of schedules.
   */
  async triggerPrecomputeWindow(req: Request, res: Response): Promise<void> {
    const { fields, async = false } = req.body || {};
    this.adminLogger.info('Triggering precompute for canonical window', {
      fields: fields || 'full',
      async,
    });

    if (async) {
      void this.precomputeSchedule
        .precomputeCanonicalWindow((fields as any) || 'full')
        .then(() => {
          this.adminLogger.info('Async window precompute completed');
        })
        .catch((error) => {
          this.adminLogger.error(
            'Async window precompute failed',
            error as Error
          );
        });

      res.status(202).json(
        successResponse({ message: 'Window precompute started asynchronously' })
      );
      return;
    }

    await this.precomputeSchedule.precomputeCanonicalWindow(
      (fields as any) || 'full'
    );

    res
      .status(200)
      .json(successResponse({ message: 'Window precompute completed' }));
  }

  /**
   * @openapi
   * /v2/admin/cleanup:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Limpiar programas antiguos
   *     description: Elimina programas anteriores a la fecha configurada
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               daysToKeep:
   *                 type: integer
   *                 description: Días de historial a mantener
   *                 default: 7
   *     responses:
   *       200:
   *         description: Limpieza completada
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  /**
   * Removes historical program data beyond a configurable retention window.
   */
  async triggerCleanup(req: Request, res: Response): Promise<void> {
    const { daysToKeep, async = false } = req.body;

    this.adminLogger.info('Manual cleanup triggered', { daysToKeep, async });

    if (daysToKeep && (typeof daysToKeep !== 'number' || daysToKeep < 1)) {
      throw new ValidationError('Invalid daysToKeep parameter', [
        {
          field: 'daysToKeep',
          message: 'Must be a positive number',
          value: daysToKeep,
        },
      ]);
    }

    if (async) {
      const job = await this.operations.enqueue('epg.cleanup', this.actor(req), () => this.cleanOldPrograms.execute({
          daysToKeep: daysToKeep || 7,
        }));

      res.status(202).json(
        successResponse({ message: 'Cleanup started asynchronously', job })
      );
      return;
    }

    const result = await this.cleanOldPrograms.execute({
      daysToKeep: daysToKeep || 7,
    });

    res.status(200).json(
      successResponse(
        {
          message: result.success
            ? 'Cleanup completed successfully'
            : 'Cleanup completed with errors',
          result,
        },
        { cached: false }
      )
    );
  }

  /**
   * @openapi
   * /v2/admin/cache/clear:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Limpiar caché
   *     description: Invalida entradas de caché que coincidan con el patrón
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               pattern:
   *                 type: string
   *                 description: Patrón de claves a eliminar (ej. "program:*")
   *     responses:
   *       200:
   *         description: Caché limpiada
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  /**
   * Clears cache entries optionally filtered by pattern.
   */
  async clearCache(req: Request, res: Response): Promise<void> {
    // Legacy endpoint remains deliberately constrained; arbitrary patterns and FLUSHDB are not admin UI capabilities.
    const namespace = String(req.body?.namespace || '');
    if (!namespace) throw new ValidationError('A supported cache namespace is required', []);
    res.status(200).json(successResponse(await this.operations.invalidateCache(namespace, this.actor(req)), { cached: false }));
  }

  /**
   * POST /v2/admin/reset
   * Borra cache, colecciones, ficheros EPG/schedules y reconstruye (sync + precompute window)
   */
  /**
   * Executes a full reset by re-importing the source EPG and clearing caches.
   */
  async triggerReset(req: Request, res: Response): Promise<void> {
    const { sourceUrl, fields, async = false } = req.body || {};
    this.adminLogger.warn('Full reset triggered', { sourceUrl, fields, async });

    // Deshabilitar timeout de respuesta mientras se ejecuta el reset
    res.setTimeout(0);

    if (async) {
      // Ejecutar en background y responder rápido
      void this.resetSystem
        .execute({
          sourceUrl: sourceUrl as string | undefined,
          fields: (fields as any) || 'full',
        })
        .then((result) => {
          this.adminLogger.info('Async reset completed', { result });
        })
        .catch((error) => {
          this.adminLogger.error('Async reset failed', error as Error);
        });

      res.status(202).json(
        successResponse(
          {
            message: 'Reset started asynchronously',
          },
          { cached: false }
        )
      );
      return;
    }

    try {
      const result = await this.resetSystem.execute({
        sourceUrl: sourceUrl as string | undefined,
        fields: (fields as any) || 'full',
      });

      res.status(200).json(
        successResponse(
          {
            message: 'Reset completed successfully',
            result,
          },
          { cached: false }
        )
      );
    } catch (error) {
      this.adminLogger.error('Reset failed', error as Error);
      res.status(500).json(
        successResponse(
          {
            message: 'Reset failed',
            error: (error as Error).message,
          },
          { cached: false }
        )
      );
    }
  }

  /**
   * @openapi
   * /v2/admin/health:
   *   get:
   *     tags:
   *       - Admin
   *     summary: Health check administrativo
   *     description: Verifica estado de servicios internos (DB, Cache, etc)
   *     responses:
   *       200:
   *         description: Sistema saludable
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: healthy
   *                 services:
   *                   type: object
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  /**
   * Returns operational health for internal services (DB, cache).
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    void req;
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    // Verificar conectividad de servicios
    const services = {
      cache: await this.checkCacheHealth(),
    };

    res.status(200).json(
      successResponse(
        {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: `${Math.floor(uptime)}s`,
          version: process.env.API_VERSION || '2.0.0',
          memory: {
            rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
          },
          services,
        },
        { cached: false }
      )
    );
  }

  private async checkCacheHealth(): Promise<{ status: string; details?: any }> {
    try {
      await this.cacheRepository.set('health_check', { test: true }, 10);
      const value = await this.cacheRepository.get<{ test: boolean }>(
        'health_check'
      );
      await this.cacheRepository.delete('health_check');

      return {
        status: value && value.test ? 'healthy' : 'degraded',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: (error as Error).message,
      };
    }
  }

  private actor(req: Request): string {
    const user = (req as any).user;
    return user?.id || user?.email || 'admin-key';
  }
}
