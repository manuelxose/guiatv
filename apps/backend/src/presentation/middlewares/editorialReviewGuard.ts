import { timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../shared/errors';

function equalSecret(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const editorialReviewGuard = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const humanReviewKey = String(process.env.EDITORIAL_REVIEW_KEY || '').trim();
  const automationReviewKey = String(process.env.AUCTORIO_EDITORIAL_REVIEW_KEY || '').trim();
  if (!humanReviewKey && !automationReviewKey) {
    throw new ForbiddenError('Editorial review is not configured');
  }

  const provided = String(req.header('x-editorial-review-key') || '').trim();
  const automationReviewer = String(process.env.AUCTORIO_EDITORIAL_REVIEWER || '').trim();
  const isHumanReview = Boolean(humanReviewKey) && equalSecret(provided, humanReviewKey);
  const isAutomationReview = Boolean(automationReviewKey)
    && equalSecret(provided, automationReviewKey)
    && Boolean(automationReviewer)
    && String(req.header('x-editorial-reviewer') || '').trim() === automationReviewer;

  if (!provided || (!isHumanReview && !isAutomationReview)) {
    throw new ForbiddenError('Invalid editorial review key');
  }
  next();
};

/** Only the human review key: an automated identity must not be able to undo a person's emergency stop. */
export const humanEditorialReviewGuard = (req: Request, _res: Response, next: NextFunction): void => {
  const humanReviewKey = String(process.env.EDITORIAL_REVIEW_KEY || '').trim();
  const provided = String(req.header('x-editorial-review-key') || '').trim();
  if (!humanReviewKey || !provided || !equalSecret(provided, humanReviewKey)) {
    throw new ForbiddenError('Invalid human editorial review key');
  }
  next();
};
