import { AnalyticsSessionModel } from '../database/models/AnalyticsSession.model';

export function excludedAnalyticsIps(): string[] {
  const ips = ['127.0.0.1', '::1', ...(process.env.ANALYTICS_EXCLUDED_IPS || '').split(',')]
    .map((ip) => ip.trim()).filter(Boolean);
  return [...new Set(ips.flatMap((ip) => ip.includes(':') ? [ip] : [ip, `::ffff:${ip}`]))];
}

export async function analyticsExclusions(): Promise<{ sessions: Record<string, unknown>; events: Record<string, unknown> }> {
  const ips = excludedAnalyticsIps();
  const excludedSessions = await AnalyticsSessionModel.distinct('sessionId', {
    $or: [{ excluded: true }, { ip: { $in: ips } }],
  }).exec();
  return {
    sessions: { excluded: { $ne: true }, ip: { $nin: ips } },
    events: { excluded: { $ne: true }, sessionId: { $nin: excludedSessions }, ip: { $nin: ips } },
  };
}
