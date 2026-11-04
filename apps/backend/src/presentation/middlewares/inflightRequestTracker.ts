import type { NextFunction, Request, Response } from 'express';
import { inflightRequests } from '../../shared/utils/inflightRequests';

/**
 * M13-B3a: registers every request in the in-flight registry as early as possible (mounted first, so a stall inside
 * the sitemap routes, body parsing or compression is visible too). Observation only: it never alters the request or the
 * response and always calls `next()`, even if the registry fails.
 */
export const inflightRequestTracker = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const done = inflightRequests.begin(req);
    res.once('finish', () => done(false));
    // `close` also fires for a client that went away before the response finished.
    res.once('close', () => done(!res.writableFinished));
  } catch {
    // Observation must never affect the request.
  }
  next();
};
