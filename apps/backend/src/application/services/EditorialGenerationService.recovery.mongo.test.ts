/**
 * M15: manual requests abandoned in `running` by a dead runner (the 2026-11-06 production case) are recovered on a
 * throwaway database (`guiatv_test_m15_<pid>`, dropped after).
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27119 npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { CLAIM_LEASE_MS, EditorialGenerationService } from './EditorialGenerationService';

const topic = {
  title: 'Cómo ver la TDT en España paso a paso', slug: 'como-ver-tdt-espana', topic: 'Sintonizar la TDT en España con fuentes oficiales',
  intent: 'Explicar cómo resintonizar los canales de la TDT', category: 'Televisión', contentType: 'guide', length: 'medium', seedUrls: ['https://www.boe.es/a'],
};

test('M15 abandoned manual claims: one automatic retry, then failed; live claims and zombies are safe', { skip: !process.env.TEST_MONGO_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_m15_${process.pid}` });
  const service = new EditorialGenerationService();
  const requests = mongoose.connection.collection('editorial_generation_requests');
  try {
    await mongoose.connection.collection('editorial_settings').insertOne({ _id: 'generation' as never, settings: { categories: ['Televisión'], contentTypes: ['guide'], sourceDomains: ['boe.es'] } });
    const live = await service.createRequest('generate', topic, 'Revisora Prueba');
    const dead = await service.createRequest('generate', { ...topic, slug: 'como-ver-tdt-espana-dos' }, 'Revisora Prueba');
    await service.claimRequest(live.id, true);
    const { claimToken: zombieToken } = await service.claimRequest(dead.id, true);
    // The runner that claimed `dead` died long ago (crash before finish, like the TDZ ReferenceError of 2026-11-06).
    await requests.updateOne({ id: dead.id }, { $set: { claimedAt: new Date(Date.now() - CLAIM_LEASE_MS - 60e3) } });

    // The next runner's work fetch recovers it: queued again, its old token revoked.
    const work = await service.pendingRequests();
    assert.deepEqual(work.map((r) => r.id), [dead.id], 'the abandoned request is offered again; the live claim is not');
    assert.equal((await requests.findOne({ id: live.id }))!.status, 'running', 'a live claim is never touched');
    await assert.rejects(service.finishRequest(dead.id, 'completed', '', zombieToken), /not found/, 'a returning zombie cannot finish it');

    // Abandoned a second time: a person decides (no crash loop spending every cycle).
    await service.claimRequest(dead.id, true);
    await requests.updateOne({ id: dead.id }, { $set: { claimedAt: new Date(Date.now() - CLAIM_LEASE_MS - 60e3) } });
    const state = await service.operationalState();
    const failed = state.queue.find((r: { id?: string }) => r.id === dead.id) as { status: string; reason: string };
    assert.equal(failed.status, 'failed');
    assert.match(failed.reason, /interrumpida dos veces/);
    // The existing retry action brings it back for the person who decided to.
    assert.equal((await service.retryRequest(dead.id)).status, 'queued');
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
