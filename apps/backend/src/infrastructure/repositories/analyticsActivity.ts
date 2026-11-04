export const LIVE_IDLE_LIMIT_SECONDS = 300;

export function isLongIdle(metadata?: Record<string, any>): boolean {
  const idleSeconds = metadata?.activity?.idleSec;
  return typeof idleSeconds === 'number' && Number.isFinite(idleSeconds) && idleSeconds >= LIVE_IDLE_LIMIT_SECONDS;
}
