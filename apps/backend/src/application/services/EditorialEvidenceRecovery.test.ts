/**
 * M14-R7 — Recuperación segura de un tema: validación contra el estado real,
 * 409 con motivo en español, lote parcial y "no repetir la misma condición".
 *
 *   node --test dist/application/services/EditorialEvidenceRecovery.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFlowRead } from './EditorialFlow.fixtures';
import { EditorialFlowDiagnostics } from './EditorialFlowDiagnostics';
import { EditorialEvidenceRecovery } from './EditorialEvidenceRecovery';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const CNMC = 'cnmc-derechos-audiovisuales-accesibilidad-plataformas';
const APPLE = 'apple-tv-airplay-ajustes-imagen-television';
const DUPLICATE = 'control-parental-netflix-prime-video';
const BOE = 'https://www.boe.es/buscar/act.php?id=BOE-A-2022-12981';
const CNMC_SITE = 'https://www.cnmc.es/novedades';

function harness() {
  const auditRows: Array<Record<string, unknown>> = [];
  const generateCalls: Array<{ kind: string; input: Record<string, unknown>; actor: string }> = [];
  const queueCalls: Array<Record<string, unknown>> = [];
  const ledgerCalls: Array<Record<string, unknown>> = [];
  const read = new MemoryFlowRead();
  const diagnostics = new EditorialFlowDiagnostics({ read, clock: () => NOW });
  const recovery = new EditorialEvidenceRecovery({
    read,
    topic: (topicId) => diagnostics.topic(topicId),
    generate: {
      createRequest: async (kind, input, actor) => {
        generateCalls.push({ kind, input, actor });
        return { id: `req-${generateCalls.length}` };
      },
      createQueueAction: async (input, actor) => {
        queueCalls.push({ ...input, actor });
        return { id: `queue-${queueCalls.length}` };
      },
    },
    ledger: {
      retry: async (jobId, actor) => {
        ledgerCalls.push({ op: 'retry', jobId, actor });
        return { state: 'queued' };
      },
      archive: async (jobId, actor) => {
        ledgerCalls.push({ op: 'archive', jobId, actor });
        return { archivedAt: '2026-11-06T12:00:00.000Z' };
      },
    },
    audit: {
      insert: async (row) => {
        auditRows.push(row);
      },
      list: async (filter, options = {}) =>
        auditRows
          .filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value))
          .slice(0, options.limit ?? 50),
    },
    clock: () => NOW,
  });
  return { recovery, auditRows, generateCalls, queueCalls, ledgerCalls };
}

test('M14-R7 recuperación: acción admitida reutiliza la solicitud de generación y queda auditada', async () => {
  const { recovery, auditRows, generateCalls } = harness();
  const result = await recovery.recover({ topicId: CNMC, action: 'add-evidence', actor: 'admin@guia.tv', sources: [BOE, CNMC_SITE] });

  assert.equal(result.applied, true);
  assert.equal(result.gateway, 'generation-request');
  assert.equal(result.requestId, 'req-1');
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].kind, 'generate');
  assert.deepEqual(generateCalls[0].input.seedUrls, [BOE, CNMC_SITE]);
  assert.equal(generateCalls[0].input.slug, 'cnmc-derechos-audiovisuales-accesibilidad-plataformas');
  assert.equal(generateCalls[0].input.category, 'Televisión');
  assert.match(String(generateCalls[0].input.topic), /accesibilidad/i);

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'editorial-flow-recovery');
  assert.equal(auditRows[0].topicId, CNMC);
  assert.equal(auditRows[0].recoveryAction, 'add-evidence');
  assert.equal(auditRows[0].by, 'admin@guia.tv');
  assert.match(String(auditRows[0].fingerprint), /^[0-9a-f]{64}$/);
});

test('M14-R7 recuperación: si la causa no cambió no se relanza la misma petición', async () => {
  const { recovery, auditRows, generateCalls, ledgerCalls } = harness();
  await recovery.recover({ topicId: CNMC, action: 'add-evidence', actor: 'admin@guia.tv', sources: [BOE] });
  await assert.rejects(
    () => recovery.recover({ topicId: CNMC, action: 'add-evidence', actor: 'admin@guia.tv', sources: [BOE] }),
    /La causa del rechazo no ha cambiado/
  );
  assert.equal(generateCalls.length, 1, 'no se debe relanzar la misma petición');
  assert.equal(auditRows.length, 1, 'un rechazo por condición repetida no escribe acción aplicada');

  // Cambiar las fuentes sí permite reintentar: la condición es distinta.
  await recovery.recover({ topicId: CNMC, action: 'add-evidence', actor: 'admin@guia.tv', sources: [BOE, CNMC_SITE] });
  assert.equal(generateCalls.length, 2);

  // Lo mismo vale para un reintento de revisión sobre el ledger.
  await recovery.recover({ topicId: CNMC, action: 'retry-review', actor: 'admin@guia.tv' });
  await assert.rejects(
    () => recovery.recover({ topicId: CNMC, action: 'retry-review', actor: 'admin@guia.tv' }),
    /La causa del rechazo no ha cambiado/
  );
  assert.deepEqual(ledgerCalls.map((call) => call.op), ['retry']);
});

test('M14-R7 recuperación: acción no aplicable responde 409 con motivo en español', async () => {
  const { recovery, generateCalls, auditRows } = harness();
  await assert.rejects(
    () => recovery.recover({ topicId: CNMC, action: 'fix-slug', actor: 'admin@guia.tv' }),
    (error: Error & { statusCode?: number }) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /«Corregir slug» no aplica al estado real del tema/);
      assert.match(error.message, /candidato=retained/);
      assert.match(error.message, /Acciones admitidas:/);
      return true;
    }
  );
  assert.equal(generateCalls.length, 0);
  assert.equal(auditRows.length, 0);

  await assert.rejects(() => recovery.recover({ topicId: CNMC, action: 'inventada' as never, actor: 'admin@guia.tv' }), /no existe en el contrato/);
  await assert.rejects(
    () => recovery.recover({ topicId: 'no-existe-en-ninguna-coleccion', action: 'archive', actor: 'admin@guia.tv' }),
    /No existe ningún tema/
  );
});

test('M14-R7 recuperación: archivar, pedir revisión manual y revisar brief usan los mecanismos existentes', async () => {
  const { recovery, ledgerCalls, queueCalls } = harness();

  const archived = await recovery.recover({ topicId: CNMC, action: 'archive', actor: 'admin@guia.tv' });
  assert.equal(archived.gateway, 'ledger-archive');
  assert.deepEqual(ledgerCalls[0], { op: 'archive', jobId: 'm14-ledger-1', actor: 'admin@guia.tv' });

  const manual = await recovery.recover({ topicId: CNMC, action: 'request-manual-review', actor: 'admin@guia.tv' });
  assert.equal(manual.gateway, 'queue-action');
  assert.equal(queueCalls[0].action, 'approve');
  assert.equal(queueCalls[0].topicId, CNMC);
  assert.match(String(queueCalls[0].reason), /Revisión manual/);
  assert.match(manual.detail, /no lo publica/);

  await assert.rejects(
    () => recovery.recover({ topicId: CNMC, action: 'revise-brief', actor: 'admin@guia.tv' }),
    /exige indicar el nuevo título o la nueva intención/
  );
  const brief = await recovery.recover({
    topicId: CNMC,
    action: 'revise-brief',
    actor: 'admin@guia.tv',
    brief: { title: 'Accesibilidad audiovisual: obligaciones de las plataformas' },
  });
  assert.equal(brief.gateway, 'queue-action');
  assert.equal(queueCalls[1].action, 'edit');
  assert.equal((queueCalls[1].edit as { title: string }).title, 'Accesibilidad audiovisual: obligaciones de las plataformas');
});

test('M14-R7 recuperación: corregir slug e inspeccionar duplicado sin inventar datos', async () => {
  const { recovery, generateCalls } = harness();
  const fixed = await recovery.recover({ topicId: APPLE, action: 'fix-slug', actor: 'admin@guia.tv' });
  assert.equal(fixed.gateway, 'generation-request');
  const slug = String(generateCalls[0].input.slug);
  assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/);
  assert.notEqual(slug, 'apple-tv-airplay-ajustes-imagen-television');

  const inspection = await recovery.recover({ topicId: DUPLICATE, action: 'inspect-duplicate', actor: 'admin@guia.tv' });
  assert.equal(inspection.gateway, 'inspection');
  assert.equal(inspection.applied, true);
  assert.ok(Array.isArray(inspection.inspectedDuplicates));
  assert.ok((inspection.inspectedDuplicates ?? []).every((entry) => typeof entry.similarity === 'number'));
  assert.equal(generateCalls.length, 1, 'una inspección no crea solicitudes de generación');
});

test('M14-R7 recuperación en lote: resultado por ítem sin abortar el resto', async () => {
  const { recovery, generateCalls, auditRows } = harness();
  const batch = await recovery.recoverMany({
    topicIds: [CNMC, 'no-existe-en-ninguna-coleccion', APPLE],
    action: 'add-evidence',
    actor: 'admin@guia.tv',
    sources: [BOE],
  });
  assert.equal(batch.results.length, 3);
  assert.equal(batch.succeeded, 1);
  assert.equal(batch.failed, 2);
  assert.deepEqual(batch.results.map((row) => row.ok), [true, false, false]);

  const [first, missing, invalid] = batch.results;
  assert.equal(first.topicId, CNMC);
  assert.equal(first.code, undefined);
  assert.equal(missing.code, 'not-found');
  assert.match(missing.detail, /No existe ningún tema/);
  assert.equal(invalid.topicId, APPLE);
  // APPLE no admite add-evidence (candidato inválido): el lote lo explica por ítem.
  assert.equal(invalid.code, 'not-applicable');
  assert.match(invalid.detail, /no aplica al estado real/);
  assert.equal(generateCalls.length, 1);
  assert.equal(auditRows.filter((row) => row.action === 'editorial-flow-recovery').length, 1);
  assert.match(batch.note, /un fallo individual no cancela el resto/);

  await assert.rejects(() => recovery.recoverMany({ topicIds: [], action: 'archive', actor: 'admin@guia.tv' }), /al menos un tema/);
  const tooMany = Array.from({ length: 51 }, (_, index) => `tema-${index}`);
  await assert.rejects(() => recovery.recoverMany({ topicIds: tooMany, action: 'archive', actor: 'admin@guia.tv' }), /como máximo 50/);
});
