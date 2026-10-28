import { Request, Response, NextFunction } from 'express';
import { factsAsText, loadEditorialFacts, parseFactsQuery } from '../../application/services/EditorialFirstPartyFacts';

/**
 * M11-G GET /v2/editorial/facts: GuíaTV's own data as citable facts for the editorial pipeline (an internal source).
 * Read-only and built from data the public schedule pages already show; never indexed.
 */
export async function editorialFactsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = parseFactsQuery(req.query as Record<string, unknown>);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (typeof query === 'string') { res.status(400).json({ success: false, error: query }); return; }
    const result = await loadEditorialFacts(query);
    res.set('Cache-Control', 'public, max-age=300');
    if (req.query.format === 'text') res.type('text/plain; charset=utf-8').send(factsAsText(result));
    else res.json({ success: true, data: result });
  } catch (error) { next(error); }
}
