/**
 * M14-R7 — Pruebas del estado del PLANIFICADOR (generación programada).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANNER_STATES,
  PLANNER_META,
  DEFAULT_PLANNER_ENABLED,
  GENERATION_ENABLED_TO_PLANNER,
  mapGenerationSettings,
} from './flow-planner';

test('PlannerState es un enum cerrado (enabled | disabled)', () => {
  assert.deepEqual([...PLANNER_STATES], ['enabled', 'disabled']);
});

test('el valor por defecto fail-closed del candidato es enabled:false', () => {
  assert.equal(DEFAULT_PLANNER_ENABLED, false);
});

test('cada estado del planificador tiene etiqueta, definición y no-implica', () => {
  for (const state of PLANNER_STATES) {
    const meta = PLANNER_META[state];
    assert.equal(meta.key, state);
    assert.ok(meta.label, `${state} debe tener etiqueta`);
    assert.ok(meta.definition, `${state} debe tener definición`);
    assert.ok(meta.notImplies.length > 0, `${state} debe declarar qué NO implica`);
  }
});

test('desactivado declara que la publicación manual sigue disponible de forma independiente', () => {
  assert.ok(PLANNER_META.disabled.notImplies.some((s) => /publicación manual/i.test(s)));
});

test('mapGenerationSettings: enabled:false → disabled', () => {
  assert.equal(mapGenerationSettings({ enabled: false }), 'disabled');
});

test('mapGenerationSettings: enabled:true → enabled (build desplegada observada)', () => {
  assert.equal(mapGenerationSettings({ enabled: true }), 'enabled');
});

test('mapGenerationSettings: sin documento o sin enabled → disabled (default fail-closed)', () => {
  assert.equal(mapGenerationSettings(undefined), 'disabled');
  assert.equal(mapGenerationSettings(null), 'disabled');
  assert.equal(mapGenerationSettings({}), 'disabled');
  assert.equal(mapGenerationSettings({ enabled: 'true' as unknown }), 'disabled');
});

test('GENERATION_ENABLED_TO_PLANNER cubre true y false', () => {
  assert.equal(GENERATION_ENABLED_TO_PLANNER.true, 'enabled');
  assert.equal(GENERATION_ENABLED_TO_PLANNER.false, 'disabled');
});
