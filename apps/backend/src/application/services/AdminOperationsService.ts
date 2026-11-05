import { randomUUID } from 'node:crypto';
import { ICacheRepository } from '../../domain/repositories/ICacheRepository';
import { FootballDataProvider, FootballMatchQuery } from '../../domain/sports/football/types';
import { FootballCompetitionModel } from '../../infrastructure/sports/models/FootballCompetition.model';
import { FootballTeamModel } from '../../infrastructure/sports/models/FootballTeam.model';
import { FootballBroadcastMappingModel } from '../../infrastructure/sports/models/FootballBroadcastMapping.model';
import { AdminOperationModel } from '../../infrastructure/database/models/AdminOperation.model';
import { AdminOperationalEventModel } from '../../infrastructure/database/models/AdminOperationalEvent.model';
import { runtimeMetricsSnapshot } from '../../shared/utils/runtimeMetrics';
import { listScheduledJobs, runScheduledJob } from '../../jobs';

const STALE_MS = 6 * 60 * 60 * 1000;
const SAFE_CACHE_NAMESPACES: Record<string, string> = {
  epg: 'v2:epg:*', football: 'v2:football:*', catalog: 'v2:catalog:*', schedules: 'schedule:*',
};

/** Persisted, bounded operations projection. It deliberately never exposes cache values or provider credentials. */
export class AdminOperationsService {
  constructor(private readonly cache: ICacheRepository, private readonly football?: FootballDataProvider, private readonly refreshFootball?: () => Promise<unknown>) {}

  async footballOverview() {
    const now = new Date(); const staleAt = new Date(now.getTime() - STALE_MS);
    const [competitions, teams, mappings, jobs] = await Promise.all([
      FootballCompetitionModel.find({}, { name: 1, providerIds: 1, lastUpdatedAt: 1, currentSeason: 1 }).lean(),
      FootballTeamModel.find({}, { name: 1, providerIds: 1, lastUpdatedAt: 1, aliases: 1 }).lean(),
      FootballBroadcastMappingModel.countDocuments(),
      AdminOperationModel.find({ type: /^football\./ }).sort({ queuedAt: -1 }).limit(5).lean(),
    ]);
    let matches: any[] = [];
    let providerError: string | undefined;
    if (this.football) try { matches = await this.football.getMatches({ dateFrom: isoDate(now), dateTo: isoDate(new Date(now.getTime() + 7 * 86400000)), limit: 200 }); } catch { providerError = 'Latest provider request failed'; }
    const mapped = matches.filter((match) => match.broadcasts?.length).length;
    return {
      generatedAt: now, provider: { configured: Boolean(this.football), state: providerError ? 'degraded' : this.football ? 'healthy' : 'unconfigured', lastError: providerError },
      activeCompetitions: competitions.length, totalTeams: teams.length, upcomingFixtures: matches.length,
      fixturesMissingBroadcast: Math.max(matches.length - mapped, 0), broadcastMappings: mappings,
      staleCompetitions: competitions.filter((item) => item.lastUpdatedAt < staleAt).length,
      staleTeams: teams.filter((item) => item.lastUpdatedAt < staleAt).length,
      unmappedCompetitions: competitions.filter((item) => !Object.keys(item.providerIds || {}).length).length,
      unmappedTeams: teams.filter((item) => !Object.keys(item.providerIds || {}).length).length,
      lastSuccessfulSync: jobs.find((job) => job.status === 'completed')?.completedAt,
      lastFailedSync: jobs.find((job) => job.status === 'failed')?.completedAt,
    };
  }

  async listCompetitions(input: { page?: number; limit?: number; search?: string; stale?: boolean }) {
    const filter: any = input.search ? { name: new RegExp(escape(input.search), 'i') } : {};
    if (input.stale) filter.lastUpdatedAt = { $lt: new Date(Date.now() - STALE_MS) };
    return this.paginate(FootballCompetitionModel, filter, input, { name: 1, providerIds: 1, lastUpdatedAt: 1, currentSeason: 1, country: 1 });
  }
  async listTeams(input: { page?: number; limit?: number; search?: string; stale?: boolean }) {
    const filter: any = input.search ? { name: new RegExp(escape(input.search), 'i') } : {};
    if (input.stale) filter.lastUpdatedAt = { $lt: new Date(Date.now() - STALE_MS) };
    return this.paginate(FootballTeamModel, filter, input, { name: 1, providerIds: 1, lastUpdatedAt: 1, aliases: 1, crest: 1 });
  }
  async listFixtures(query: FootballMatchQuery & { page?: number }) {
    if (!this.football) return { page: 1, limit: 50, total: 0, items: [] };
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const matches = await this.football.getMatches({ ...query, limit });
    return { page: 1, limit, total: matches.length, items: matches };
  }
  async listJobs(input: { page?: number; limit?: number; status?: string; type?: string }) {
    const filter: any = {}; if (input.status) filter.status = input.status; if (input.type) filter.type = input.type;
    return this.paginate(AdminOperationModel, filter, input, { errorSummary: 1, errorCode: 1, correlationId: 1, currentStep: 1, progress: 1, type: 1, status: 1, queuedAt: 1, startedAt: 1, completedAt: 1, attempts: 1, triggeredBy: 1, target: 1 });
  }
  /** Every scheduled job with its schedule and the last recorded run, so nothing runs without being visible. */
  async scheduledJobs() {
    const jobs = listScheduledJobs();
    const last = await Promise.all(jobs.map((job) => AdminOperationModel.findOne({ type: job.name }).sort({ queuedAt: -1 }).select({ status: 1, queuedAt: 1, startedAt: 1, completedAt: 1, errorSummary: 1, triggeredBy: 1 }).lean()));
    return jobs.map((job, i) => ({ ...job, lastRun: last[i] ?? null }));
  }
  async runScheduled(name: string, actor: string) {
    if (!listScheduledJobs().some((job) => job.name === name && job.runnable)) throw new Error('Unknown or non-runnable scheduled job');
    return this.enqueue(name, actor, () => runScheduledJob(name), name);
  }
  async listEvents(input: { page?: number; limit?: number; severity?: string; subsystem?: string; correlationId?: string }) {
    const filter: any = {}; if (input.severity) filter.severity = input.severity; if (input.subsystem) filter.subsystem = input.subsystem; if (input.correlationId) filter.correlationId = input.correlationId;
    const page = Math.max(1, Number(input.page) || 1); const limit = Math.min(100, Math.max(1, Number(input.limit) || 25));
    const [items, total] = await Promise.all([AdminOperationalEventModel.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(), AdminOperationalEventModel.countDocuments(filter)]);
    return { page, limit, total, items };
  }
  async listAlerts() {
    const [football, jobs, cache] = await Promise.all([this.footballOverview(), AdminOperationModel.countDocuments({ status: 'failed', queuedAt: { $gte: new Date(Date.now() - 24 * 3600000) } }), this.cacheDiagnostics()]);
    const alerts: Array<{ id: string; severity: 'info' | 'warning' | 'critical'; subsystem: string; message: string; correlationId?: string }> = [];
    if (football.provider.state === 'degraded') alerts.push({ id: 'football-provider', severity: 'warning', subsystem: 'football', message: 'Football provider request is degraded' });
    if (football.staleCompetitions + football.staleTeams > 0) alerts.push({ id: 'football-stale', severity: 'warning', subsystem: 'football', message: `${football.staleCompetitions + football.staleTeams} football entities are stale` });
    if (jobs > 0) alerts.push({ id: 'job-failures', severity: jobs > 3 ? 'critical' : 'warning', subsystem: 'jobs', message: `${jobs} background job failures in the last 24 hours` });
    if (!(cache.runtime as any)?.connected) alerts.push({ id: 'cache-unavailable', severity: 'critical', subsystem: 'cache', message: 'Redis/Valkey is unavailable; fallback cache may be in use' });
    return { generatedAt: new Date(), items: alerts };
  }
  async cacheDiagnostics() { return { generatedAt: new Date(), runtime: runtimeMetricsSnapshot().cache, namespaces: Object.keys(SAFE_CACHE_NAMESPACES) }; }
  async invalidateCache(namespace: string, actor = 'admin-key') { const pattern = SAFE_CACHE_NAMESPACES[namespace]; if (!pattern) throw new Error('Unsupported cache namespace'); await this.cache.clear(pattern); await this.event('info', 'cache', `Invalidated ${namespace} cache namespace`, { actor, namespace }); return { namespace }; }
  async refreshFootballData(actor: string) { if (!this.refreshFootball) throw new Error('Football refresh is unavailable'); return this.enqueue('football.refresh', actor, async () => { await this.refreshFootball!(); }, 'upcoming-fixtures'); }

  async enqueue(type: string, triggeredBy: string, task: () => Promise<unknown>, target?: string) {
    const correlationId = randomUUID();
    const job = await AdminOperationModel.create({ type, status: 'queued', queuedAt: new Date(), attempts: 1, triggeredBy, correlationId, target });
    await this.event('info', 'jobs', `Queued ${type}`, { actor: triggeredBy, target: target || '' }, String(job._id), correlationId);
    void (async () => { try { await AdminOperationModel.updateOne({ _id: job._id }, { status: 'running', startedAt: new Date(), currentStep: 'Executing' }); await task(); await AdminOperationModel.updateOne({ _id: job._id }, { status: 'completed', completedAt: new Date(), progress: 100, currentStep: 'Completed' }); await this.event('info', 'jobs', `${type} completed`, {}, String(job._id), correlationId); } catch (error) { const summary = safeError(error); await AdminOperationModel.updateOne({ _id: job._id }, { status: 'failed', completedAt: new Date(), errorCode: 'OPERATION_FAILED', errorSummary: summary, currentStep: 'Failed' }); await this.event('critical', 'jobs', `${type} failed: ${summary}`, {}, String(job._id), correlationId, 'OPERATION_FAILED'); } })();
    return { id: String(job._id), status: job.status, correlationId };
  }
  private async paginate(model: any, filter: any, input: any, projection: any) { const page = Math.max(1, Number(input.page) || 1); const limit = Math.min(100, Math.max(1, Number(input.limit) || 25)); const [items, total] = await Promise.all([model.find(filter, projection).sort({ lastUpdatedAt: -1, queuedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), model.countDocuments(filter)]); return { page, limit, total, items }; }
  private async event(severity: 'info' | 'warning' | 'critical', subsystem: string, message: string, context: Record<string, string>, jobId?: string, correlationId?: string, errorCode?: string) { await AdminOperationalEventModel.create({ timestamp: new Date(), severity, subsystem, message, context: redact(context), jobId, correlationId, errorCode }); }
}
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function escape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function safeError(error: unknown) { return String(error instanceof Error ? error.message : 'Operation failed').replace(/(api[_-]?key|token|password)=?[^\s]*/gi, '$1=[redacted]').slice(0, 240); }
function redact(context: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(context).map(([key, value]) => {
    return [key, /token|key|secret|password/i.test(key) ? '[redacted]' : String(value).slice(0, 160)];
  }));
}
