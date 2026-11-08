import * as mongoose from 'mongoose';
import { Schema } from 'mongoose';

/**
 * Generic admin operation + football manual-sync job.
 *
 * F06: football sync uses a truthful terminal status per tick outcome
 * (`succeeded`/`empty`/`skipped`/`throttled`/`failed`); the legacy generic
 * operations keep `completed`. A queued 202 is never recorded as success.
 */
export type AdminJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'succeeded'
  | 'empty'
  | 'skipped'
  | 'throttled';

export type AdminOperationOutcome = 'success' | 'partial' | 'failed' | 'skipped' | 'empty';

export interface IAdminOperationDocument {
  type: string;
  status: AdminJobStatus;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  progress?: number;
  currentStep?: string;
  errorCode?: string;
  errorSummary?: string;
  attempts: number;
  triggeredBy: string;
  correlationId: string;
  target?: string;
  /** F06: client-supplied idempotency key (optional; unique per type when present). */
  idempotencyKey?: string;
  /** F06: requested scope (defaults to "full"). */
  scope?: string;
  /** F06: raw tick outcome once the run has finished. */
  outcome?: AdminOperationOutcome;
  recordsFetched?: number;
  recordsPersisted?: number;
  errors?: string[];
  skipReason?: string;
  quotaOutcome?: 'allowed' | 'exhausted';
}

const AdminOperationSchema = new Schema<IAdminOperationDocument>(
  {
    type: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'succeeded', 'empty', 'skipped', 'throttled'],
      required: true,
      index: true,
    },
    queuedAt: { type: Date, required: true, index: true },
    startedAt: Date,
    completedAt: Date,
    progress: Number,
    currentStep: String,
    errorCode: String,
    errorSummary: String,
    attempts: { type: Number, default: 1 },
    triggeredBy: { type: String, required: true },
    correlationId: { type: String, required: true, index: true },
    target: String,
    idempotencyKey: String,
    scope: String,
    outcome: { type: String, enum: ['success', 'partial', 'failed', 'skipped', 'empty'] },
    recordsFetched: Number,
    recordsPersisted: Number,
    errors: { type: [String] },
    skipReason: String,
    quotaOutcome: { type: String, enum: ['allowed', 'exhausted'] },
  },
  { timestamps: true, collection: 'admin_operations' }
);
AdminOperationSchema.index({ status: 1, queuedAt: -1 });
// F06: atomic idempotency — the DATABASE enforces one operation per (type, idempotencyKey),
// not a read-then-create. The partial filter excludes legacy rows and requests without a
// client key (no idempotencyKey), so auto-generated correlations never collide.
AdminOperationSchema.index(
  { type: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'idx_admin_operation_type_idempotency',
  }
);

export const AdminOperationModel = mongoose.model<IAdminOperationDocument>('AdminOperation', AdminOperationSchema);
