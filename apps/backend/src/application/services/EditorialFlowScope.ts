/**
 * M14-R7 — Ámbito explícito del diagnóstico del flujo editorial.
 *
 * Este módulo define el contrato de lectura del Observatorio: las colecciones que
 * se pueden consultar, el puerto de lectura (para poder probar sin MongoDB) y el
 * ámbito (`scope`) que se aplica de forma IDÉNTICA a todas las etapas.
 *
 * Reglas duras:
 * - Un filtro del ámbito que una etapa no sabe aplicar NO se ignora: la etapa se
 *   marca `unavailable` con el motivo en español. Nunca se devuelve 0 inventado.
 * - Toda la validación de entrada lanza `ValidationError` con mensaje español.
 */

import { ValidationError } from '../../shared/errors';
import { TOPIC_CATEGORIES } from './EditorialTopicQueue';

/* ────────────────────────────────────────────────────────────────────────────
 * Colecciones del flujo editorial (solo lectura desde el Observatorio)
 * ──────────────────────────────────────────────────────────────────────────── */

export const FLOW_COLLECTIONS = [
  'editorial_jobs',
  'editorial_job_ledger',
  'editorial_queue_snapshot',
  'blog_posts',
  'editorial_settings',
  'editorial_gsc_inspections',
  'editorial_policy_approvals',
  'editorial_audit',
  'editorial_cycles',
  'editorial_generation_requests',
  'editorial_runner',
] as const;
export type FlowCollection = (typeof FLOW_COLLECTIONS)[number];

export type FlowFilter = Record<string, unknown>;

/** Consulta real que se ejecutó (o se ejecutaría) para derivar un recuento. */
export interface FlowQuery {
  collection: FlowCollection;
  filter: FlowFilter;
  sort?: Record<string, 1 | -1>;
  projection?: Record<string, 0 | 1>;
  limit?: number;
  /** Aclaración honesta de cómo se obtuvo el número (p. ej. derivado en memoria). */
  note?: string;
}

export interface FlowReadOptions {
  sort?: Record<string, 1 | -1>;
  projection?: Record<string, 0 | 1>;
  limit?: number;
}

/**
 * Puerto de lectura del Observatorio. La implementación Mongo vive en
 * `infrastructure/database/EditorialFlowRepository.ts`; las pruebas usan una
 * implementación en memoria con los mismos documentos reales.
 */
export interface FlowReadPort {
  /** `false` cuando el proceso no tiene conexión a MongoDB: entonces TODO es `unavailable`. */
  connected(): boolean;
  find(collection: FlowCollection, filter: FlowFilter, options?: FlowReadOptions): Promise<Array<Record<string, unknown>>>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ámbito
 * ──────────────────────────────────────────────────────────────────────────── */

export const SCOPE_KEYS = [
  'from',
  'to',
  'cycleId',
  'origin',
  'category',
  'stage',
  'state',
  'failureReason',
  'model',
  'provider',
  'publicationStatus',
] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

export interface FlowScope {
  /** Inicio del periodo (ISO 8601). */
  from?: string;
  /** Fin del periodo (ISO 8601). */
  to?: string;
  /** Ciclo de descubrimiento/generación. */
  cycleId?: string;
  /** Origen de la ejecución: automática (runner) o manual (operador). */
  origin?: 'automatic' | 'manual';
  category?: string;
  /** Etapa del embudo (clave de etapa, p. ej. `candidate.rejected`). */
  stage?: string;
  /** Estado dentro de una dimensión. */
  state?: string;
  failureReason?: string;
  model?: string;
  provider?: string;
  publicationStatus?: 'publish' | 'draft';
}

/** Nombres españoles de cada clave, para los mensajes de error y de no-disponibilidad. */
export const SCOPE_LABELS: Record<ScopeKey, string> = {
  from: 'periodo desde',
  to: 'periodo hasta',
  cycleId: 'ciclo',
  origin: 'origen (automático/manual)',
  category: 'categoría',
  stage: 'etapa',
  state: 'estado',
  failureReason: 'motivo de fallo',
  model: 'modelo',
  provider: 'proveedor',
  publicationStatus: 'estado de publicación',
};

const asText = (value: unknown): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  return text ? text : undefined;
};

const asDate = (value: unknown, field: 'from' | 'to'): string | undefined => {
  const text = asText(value);
  if (!text) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`El parámetro «${field}» debe ser una fecha ISO 8601 válida (por ejemplo 2026-11-01T00:00:00Z)`, [
      { field, message: 'Fecha ISO 8601 esperada', value: text },
    ]);
  }
  return date.toISOString();
};

const bounded = (value: unknown, field: ScopeKey, max: number): string | undefined => {
  const text = asText(value);
  if (text && text.length > max) {
    throw new ValidationError(`El parámetro «${SCOPE_LABELS[field]}» no puede superar ${max} caracteres`, [
      { field, message: `Máximo ${max} caracteres`, value: text.slice(0, 40) },
    ]);
  }
  return text;
};

/**
 * Normaliza y valida el ámbito recibido por query string.
 * Cualquier valor fuera del dominio cerrado responde 400 con un motivo en español.
 */
export function parseScope(input: Record<string, unknown>): FlowScope {
  const scope: FlowScope = {};
  const from = asDate(input.from, 'from');
  const to = asDate(input.to, 'to');
  if (from) scope.from = from;
  if (to) scope.to = to;
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new ValidationError('El periodo es inválido: «desde» es posterior a «hasta»', [{ field: 'from', message: 'desde > hasta', value: from }]);
  }

  const cycleId = bounded(input.cycleId, 'cycleId', 120);
  if (cycleId) scope.cycleId = cycleId;

  const origin = asText(input.origin);
  if (origin) {
    if (origin !== 'automatic' && origin !== 'manual') {
      throw new ValidationError('El parámetro «origen» solo admite «automatic» o «manual»', [
        { field: 'origin', message: 'automatic | manual', value: origin },
      ]);
    }
    scope.origin = origin;
  }

  const category = bounded(input.category, 'category', 60);
  if (category) {
    if (!(TOPIC_CATEGORIES as readonly string[]).includes(category)) {
      throw new ValidationError('La categoría no pertenece al catálogo editorial', [
        { field: 'category', message: TOPIC_CATEGORIES.join(', '), value: category },
      ]);
    }
    scope.category = category;
  }

  const stage = bounded(input.stage, 'stage', 80);
  if (stage) scope.stage = stage;
  const state = bounded(input.state, 'state', 80);
  if (state) scope.state = state;
  const failureReason = bounded(input.failureReason, 'failureReason', 200);
  if (failureReason) scope.failureReason = failureReason;
  const model = bounded(input.model, 'model', 80);
  if (model) scope.model = model;
  const provider = bounded(input.provider, 'provider', 40);
  if (provider) scope.provider = provider;

  const publicationStatus = asText(input.publicationStatus);
  if (publicationStatus) {
    if (publicationStatus !== 'publish' && publicationStatus !== 'draft') {
      throw new ValidationError('El parámetro «estado de publicación» solo admite «publish» o «draft»', [
        { field: 'publicationStatus', message: 'publish | draft', value: publicationStatus },
      ]);
    }
    scope.publicationStatus = publicationStatus;
  }
  return scope;
}

/** Claves del ámbito efectivamente informadas, en orden estable. */
export function scopeEntries(scope: FlowScope): Array<[ScopeKey, string]> {
  const entries: Array<[ScopeKey, string]> = [];
  for (const key of SCOPE_KEYS) {
    const value = scope[key];
    if (value !== undefined) entries.push([key, String(value)]);
  }
  return entries;
}

/** Claves informadas que una etapa no sabe aplicar. */
export function unsupportedScopeKeys(scope: FlowScope, supported: readonly ScopeKey[]): ScopeKey[] {
  return scopeEntries(scope)
    .map(([key]) => key)
    .filter((key) => !supported.includes(key));
}

/** Motivo en español de una etapa que no puede acotarse con el mismo ámbito. */
export function scopeUnavailableReason(source: string, keys: ScopeKey[]): string {
  const names = keys.map((key) => `«${SCOPE_LABELS[key]}»`).join(', ');
  return `La etapa ${source} no puede aplicar ${names}: la colección que la alimenta no lo registra, así que el recuento se marca no disponible en lugar de devolver 0 o un número de otra población.`;
}

/**
 * Filtro de periodo sobre un campo de fecha (Date nativo) o de texto ISO
 * (`editorial_jobs.startedAt` se guarda como cadena ISO en producción).
 */
export function periodFilter(scope: FlowScope, field: string, mode: 'date' | 'iso-string' = 'date'): FlowFilter | null {
  if (!scope.from && !scope.to) return null;
  const range: Record<string, unknown> = {};
  if (mode === 'date') {
    if (scope.from) range.$gte = new Date(scope.from);
    if (scope.to) range.$lte = new Date(scope.to);
  } else {
    if (scope.from) range.$gte = scope.from;
    if (scope.to) range.$lte = scope.to;
  }
  return { [field]: range };
}

/** Combina filtros; los campos repetidos se anidan en `$and` para no perder ninguno. */
export function mergeFilters(...filters: Array<FlowFilter | null | undefined>): FlowFilter {
  const present = filters.filter((filter): filter is FlowFilter => Boolean(filter && Object.keys(filter).length));
  if (!present.length) return {};
  if (present.length === 1) return present[0];
  const merged: FlowFilter = {};
  const conflicts: FlowFilter[] = [];
  for (const filter of present) {
    for (const [key, value] of Object.entries(filter)) {
      if (merged[key] === undefined) merged[key] = value;
      else conflicts.push({ [key]: value });
    }
  }
  if (conflicts.length) merged.$and = conflicts;
  return merged;
}

/** Igualdad simple (solo se añade cuando hay valor). */
export function equalsFilter(field: string, value: string | undefined): FlowFilter | null {
  return value === undefined ? null : { [field]: value };
}
