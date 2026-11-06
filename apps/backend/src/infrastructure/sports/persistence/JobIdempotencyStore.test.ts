import test from 'node:test';
import assert from 'node:assert/strict';
import { JobDocumentLike, MongoJobIdempotencyStore } from './JobIdempotencyStore';

const JOB_KEY = 'football:ingestion:run:openligadb:2026-11-06';

function makeJobCollection() {
  const docs = new Map<string, JobDocumentLike>();
  return {
    docs,
    async findOne(filter: Record<string, any>): Promise<JobDocumentLike | null> {
      return docs.get(filter.jobKey as string) ?? null;
    },
    async updateOne(filter: Record<string, any>, update: Record<string, any>, options?: Record<string, any>) {
      const jobKey = filter.jobKey as string;
      const owner = filter.owner as string | undefined;
      const doc = docs.get(jobKey);
      if (options?.upsert && !doc) {
        docs.set(jobKey, { ...(update.$setOnInsert as JobDocumentLike) });
        return { upsertedCount: 1 };
      }
      // Honor the full filter (jobKey AND owner), like the real Mongo update.
      const matches = doc != null && (owner === undefined || doc.owner === owner);
      if (matches && update.$set && doc) {
        Object.assign(doc, update.$set);
      }
      return { upsertedCount: 0 };
    },
  };
}

test('the first claimant wins and a restart cannot duplicate the job', async () => {
  const collection = makeJobCollection();
  const workerA = new MongoJobIdempotencyStore(collection as any);
  const workerB = new MongoJobIdempotencyStore(collection as any);

  const first = await workerA.claim(JOB_KEY, 'openligadb', 'worker-a');
  assert.equal(first.claimed, true);
  assert.equal(first.status, 'claimed');

  // A "restarted" second worker claims the same logical job → no duplicate.
  const duplicate = await workerB.claim(JOB_KEY, 'openligadb', 'worker-b');
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.status, 'claimed');
  assert.equal(duplicate.owner, 'worker-a');

  await workerA.complete(JOB_KEY, 'worker-a');
  const afterComplete = await workerB.claim(JOB_KEY, 'openligadb', 'worker-b');
  assert.equal(afterComplete.claimed, false);
  assert.equal(afterComplete.status, 'completed');

  assert.equal(collection.docs.size, 1); // exactly one job document
});

test('only the owning worker can complete its job', async () => {
  const collection = makeJobCollection();
  const workerA = new MongoJobIdempotencyStore(collection as any);

  await workerA.claim(JOB_KEY, 'openligadb', 'worker-a');
  await workerA.complete(JOB_KEY, 'somebody-else'); // not the owner → no-op

  const doc = collection.docs.get(JOB_KEY);
  assert.equal(doc?.status, 'claimed');
  assert.equal(doc?.finishedAt, undefined);
});
