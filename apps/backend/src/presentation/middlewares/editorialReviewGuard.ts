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
  if (isPolicyKey(provided)) throw new ForbiddenError('The policy key cannot review');
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
  // The admin key is runner-held, so a human key equal to it is no human key at all.
  const adminKey = String(process.env.ANALYTICS_ADMIN_KEY || '').trim();
  if (!humanReviewKey || !provided || isPolicyKey(provided) || humanReviewKey === adminKey || !equalSecret(provided, humanReviewKey)) {
    throw new ForbiddenError('Invalid human editorial review key');
  }
  next();
};

const isPolicyKey = (provided: string) => {
  const policyKey = String(process.env.EDITORIAL_POLICY_KEY || '').trim();
  return Boolean(policyKey && provided) && equalSecret(provided, policyKey);
};

/**
 * M11-D: the unattended runner's only approval right is approve-by-policy, with its own key. It must never hold
 * a reviewer key, so a policy key equal to one of them (or to the admin key) is a misconfiguration and refused (fail closed).
 */
export const policyApprovalGuard = (req: Request, _res: Response, next: NextFunction): void => {
  const policyKey = String(process.env.EDITORIAL_POLICY_KEY || '').trim();
  const otherKeys = [process.env.EDITORIAL_REVIEW_KEY, process.env.AUCTORIO_EDITORIAL_REVIEW_KEY, process.env.ANALYTICS_ADMIN_KEY].map((k) => String(k || '').trim());
  if (!policyKey || otherKeys.includes(policyKey)) throw new ForbiddenError('Policy approval is not configured');
  if (!isPolicyKey(String(req.header('x-editorial-policy-key') || '').trim())) throw new ForbiddenError('Invalid editorial policy key');
  next();
};
