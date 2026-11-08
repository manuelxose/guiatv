/**
 * Durable job idempotency key.
 *
 * A logical ingestion job is keyed by a stable `jobKey` (for example
 * `football:ingestion:run:<providerId>:<utc-day>`). The unique index on `jobKey`
 * makes the first claim win atomically, so a worker that crashes and restarts
 * (or a second worker racing for the same job) can never execute the same
 * logical job twice: the re-claim observes the existing claim/completion.
 */

export type JobStatus = 'claimed' | 'completed';

export interface JobClaim {
  claimed: boolean;
  status: JobStatus;
  owner?: string;
}

export interface JobCollection {
  findOne(filter: Record<string, unknown>): Promise<JobDocumentLike | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ upsertedCount?: number } | null>;
}

export interface JobDocumentLike {
  jobKey: string;
  providerId: string;
  status: JobStatus;
  owner: string;
  claimedAt?: Date;
  finishedAt?: Date;
  expiresAt?: Date;
}

export interface JobIdempotencyStore {
  claim(jobKey: string, providerId: string, owner: string, now?: Date): Promise<JobClaim>;
  complete(jobKey: string, owner: string, now?: Date): Promise<void>;
}

export class MongoJobIdempotencyStore implements JobIdempotencyStore {
  constructor(
    private readonly collection: JobCollection,
    private readonly ttlMs: number = 7 * 24 * 60 * 60 * 1000
  ) {}

  async claim(jobKey: string, providerId: string, owner: string, now: Date = new Date()): Promise<JobClaim> {
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const result = await this.collection.updateOne(
      { jobKey },
      {
        $setOnInsert: {
          jobKey,
          providerId,
          status: 'claimed',
          owner,
          claimedAt: now,
          expiresAt,
        },
      },
      { upsert: true }
    );

    // `upsertedCount === 1` means THIS call inserted the document: it owns the
    // job. A match (0) means another worker already claimed or completed it.
    if (result?.upsertedCount === 1) {
      return { claimed: true, status: 'claimed', owner };
    }

    const existing = await this.collection.findOne({ jobKey });
    return { claimed: false, status: existing?.status ?? 'claimed', owner: existing?.owner };
  }

  async complete(jobKey: string, owner: string, now: Date = new Date()): Promise<void> {
    await this.collection.updateOne(
      { jobKey, owner },
      { $set: { status: 'completed', finishedAt: now } }
    );
  }
}
