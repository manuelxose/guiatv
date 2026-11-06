/**
 * M14-R7 — Pruebas del contrato de estados: enums cerrados, metadatos por estado
 * (etiqueta, definición, no-implica) y acciones de recuperación admitidas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_STATES,
  EDITORIAL_STATES,
  EXECUTION_STATES,
  PUBLICATION_STATES,
  SEO_STATES,
  RECOVERY_ACTIONS,
  RECOVERY_ACTIONS_META,
  CANDIDATE_META,
  EDITORIAL_META,
  EXECUTION_META,
  PUBLICATION_META,
  SEO_META,
  FLOW_STATE_GUIDE,
  FLOW_CONTRACT_VERSION,
} from './flow-states';

function assertClosedEnum(name: string, actual: readonly string[], expected: readonly string[]): void {
  assert.deepEqual([...actual], [...expected], `${name} debe ser un enum cerrado con exactamente los valores esperados`);
}

test('CandidateState es un enum cerrado con los seis valores esperados', () => {
  assertClosedEnum('CandidateState', CANDIDATE_STATES, ['discovered', 'eligible', 'invalid', 'rejected', 'duplicate', 'retained']);
});

test('EditorialState es un enum cerrado con los seis valores esperados', () => {
  assertClosedEnum('EditorialState', EDITORIAL_STATES, ['researching', 'drafting', 'reviewing', 'revision-required', 'approved', 'rejected']);
});

test('ExecutionState es un enum cerrado con los ocho valores esperados', () => {
  assertClosedEnum('ExecutionState', EXECUTION_STATES, ['queued', 'running', 'paused', 'retrying', 'blocked', 'cancelled', 'failed', 'completed']);
});

test('PublicationState es un enum cerrado con los seis valores esperados', () => {
  assertClosedEnum('PublicationState', PUBLICATION_STATES, ['unpublished', 'ready', 'scheduled', 'publishing', 'published', 'unpublished-after-publication']);
});

test('SeoState es un enum cerrado con los ocho valores esperados', () => {
  assertClosedEnum('SeoState', SEO_STATES, ['no-inspeccionado', 'no-reconocida', 'descubierta-sin-indexar', 'crawleada-sin-indexar', 'indexada', 'error-de-fetch', 'bloqueada', 'evidencia-insuficiente']);
});

test('el catálogo de acciones de recuperación es cerrado y tiene metadatos completos', () => {
  assertClosedEnum('RecoveryAction', RECOVERY_ACTIONS, ['retry-source', 'replace-source', 'fix-slug', 'inspect-duplicate', 'revise-brief', 'add-evidence', 'targeted-rewrite', 'retry-review', 'request-manual-review', 'archive']);
  for (const action of RECOVERY_ACTIONS) {
    assert.equal(RECOVERY_ACTIONS_META[action].key, action);
    assert.ok(RECOVERY_ACTIONS_META[action].label, `${action} debe tener etiqueta`);
    assert.ok(RECOVERY_ACTIONS_META[action].definition, `${action} debe tener definición`);
  }
});

interface MetaLike { key: string; label: string; definition: string; notImplies: string[]; admittedActions: string[] }

function assertStateMeta(name: string, states: readonly string[], meta: Record<string, MetaLike>): void {
  for (const state of states) {
    const entry = meta[state];
    assert.ok(entry, `${name}.${state} debe tener metadatos`);
    assert.equal(entry.key, state, `${name}.${state} debe tener key == estado`);
    assert.ok(entry.label, `${name}.${state} debe tener etiqueta española`);
    assert.ok(entry.definition, `${name}.${state} debe tener definición`);
    assert.ok(entry.notImplies.length > 0, `${name}.${state} debe declarar qué NO implica`);
    for (const action of entry.admittedActions) {
      assert.ok(RECOVERY_ACTIONS.includes(action as (typeof RECOVERY_ACTIONS)[number]), `${name}.${state} referencia una acción de recuperación válida (${action})`);
    }
    // Sin acciones repetidas.
    assert.equal(new Set(entry.admittedActions).size, entry.admittedActions.length, `${name}.${state} no debe repetir acciones`);
  }
}

test('cada estado de candidato tiene etiqueta, definición, no-implica y acciones admitidas', () => {
  assertStateMeta('CandidateState', CANDIDATE_STATES, CANDIDATE_META);
});

test('cada estado editorial tiene etiqueta, definición, no-implica y acciones admitidas', () => {
  assertStateMeta('EditorialState', EDITORIAL_STATES, EDITORIAL_META);
});

test('cada estado de ejecución tiene etiqueta, definición, no-implica y acciones admitidas', () => {
  assertStateMeta('ExecutionState', EXECUTION_STATES, EXECUTION_META);
});

test('cada estado de publicación tiene etiqueta, definición, no-implica y acciones admitidas', () => {
  assertStateMeta('PublicationState', PUBLICATION_STATES, PUBLICATION_META);
});

test('cada estado SEO tiene etiqueta, definición, no-implica y acciones admitidas', () => {
  assertStateMeta('SeoState', SEO_STATES, SEO_META);
});

test('las distinciones exigidas están declaradas en los metadatos (no-implica)', () => {
  // approved no implica publicado
  assert.ok(EDITORIAL_META.approved.notImplies.some((s) => /no implica publicado/i.test(s)), 'approved debe declarar que no implica publicado');
  // published no implica indexado
  assert.ok(PUBLICATION_META.published.notImplies.some((s) => /no implica indexado/i.test(s)), 'published debe declarar que no implica indexado');
  // retained no equivale a pausado
  assert.ok(CANDIDATE_META.retained.notImplies.some((s) => /pausado/i.test(s)), 'retained debe declarar que no equivale a pausado');
  // rejected (editorial) no equivale a fallo técnico
  assert.ok(EDITORIAL_META.rejected.notImplies.some((s) => /fallo técnico/i.test(s)), 'rejected debe declarar que no equivale a fallo técnico');
  // completed no implica publicado
  assert.ok(EXECUTION_META.completed.notImplies.some((s) => /no implica publicado/i.test(s)), 'completed debe declarar que no implica publicado');
  // published no implica reconocido por Google (publicado vs indexado)
  assert.ok(PUBLICATION_META.published.notImplies.some((s) => /Google|indexad/i.test(s)), 'published debe declarar que no implica indexación/reconocimiento');
});

test('FLOW_STATE_GUIDE expone la versión y las cinco dimensiones + acciones', () => {
  assert.equal(FLOW_STATE_GUIDE.version, FLOW_CONTRACT_VERSION);
  assert.equal(FLOW_STATE_GUIDE.candidate, CANDIDATE_META);
  assert.equal(FLOW_STATE_GUIDE.editorial, EDITORIAL_META);
  assert.equal(FLOW_STATE_GUIDE.execution, EXECUTION_META);
  assert.equal(FLOW_STATE_GUIDE.publication, PUBLICATION_META);
  assert.equal(FLOW_STATE_GUIDE.seo, SEO_META);
  assert.equal(FLOW_STATE_GUIDE.recoveryActions, RECOVERY_ACTIONS_META);
});
