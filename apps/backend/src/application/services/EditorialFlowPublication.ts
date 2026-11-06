/**
 * M14-R7 — Comprobación de elegibilidad y publicación manual idempotente.
 *
 * Reglas duras:
 * - No se añade ningún camino de publicación: el gateway delega en la ruta real
 *   de publicación por política de BlogController, que vuelve a ejecutar TODOS
 *   los gates, el límite diario y la parada de emergencia.
 * - Repetir la operación con la misma clave de idempotencia no publica dos veces
 *   ni registra un segundo evento.
 * - Si el artículo no es elegible se devuelven los bloqueos NOMBRADOS, en español,
 *   conservando el motivo CONCRETO que aportó el gateway (p. ej. falta el bundle
 *   de evidencia o falta el borrador firmado) y añadiendo un subcódigo estable
 *   para que la UI no tenga que interpretar el texto.
 */

import { ConflictError, ValidationError } from '../../shared/errors';

export interface PublicationBlocker {
  /** Código del gate (contrato existente: `editorial`, `review`, `policy-paused`…). */
  code: string;
  /**
   * Subcódigo estable con el motivo concreto dentro de un gate. Hoy se usa para
   * la procedencia editorial incompleta: `editorial-provenance`, `editorial-bundle`
   * o `editorial-draft`.
   */
  subCode?: string;
  message: string;
}

export interface PublicationEligibility {
  postId: string;
  status: string | null;
  reviewState: string | null;
  eligible: boolean;
  alreadyPublished: boolean;
  blockers: PublicationBlocker[];
}

/** Error 409 con los bloqueos nombrados, para que la API los devuelva estructurados. */
export class PublicationNotEligibleError extends ConflictError {
  constructor(readonly eligibility: PublicationEligibility) {
    super(
      `El artículo no es elegible para publicación: ${eligibility.blockers
        .map((blocker) => `${blocker.subCode ?? blocker.code} (${blocker.message})`)
        .join('; ')}`
    );
  }
}

export interface PublicationGateway {
  /** Gates reales de publicación, sin publicar. */
  eligibility(postId: string): Promise<PublicationEligibility>;
  /** Publica reutilizando la ruta real (gates + límite diario + parada de emergencia). */
  publish(postId: string): Promise<{ post: Record<string, unknown>; qualityFindings: unknown[] }>;
}

export interface PublicationIdempotencyRecord {
  key: string;
  state: 'in-progress' | 'completed' | 'failed';
  postId: string;
  actor: string;
  at: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface PublicationIdempotencyStore {
  /** Inserta la reserva de la clave; devuelve 'existing' si otra petición la tiene. */
  claim(key: string, record: PublicationIdempotencyRecord): Promise<'claimed' | 'existing'>;
  complete(key: string, patch: Pick<PublicationIdempotencyRecord, 'state' | 'result' | 'error'>): Promise<void>;
  get(key: string): Promise<PublicationIdempotencyRecord | null>;
}

export interface FlowAuditPort {
  insert(row: Record<string, unknown>): Promise<void>;
}

/**
 * Mensajes españoles de respaldo por código de gate. Solo se usan cuando el
 * gateway no aportó un mensaje propio (o cuando su mensaje está en inglés, que es
 * el caso de `review`: los gates de calidad heredados redactan en inglés).
 */
const BLOCKER_MESSAGES: Record<string, string> = {
  editorial: 'El artículo no tiene la procedencia editorial del pipeline que exige la publicación por política.',
  review: 'El artículo no supera la revisión editorial de calidad.',
  canonicalUrl: 'La URL canónica debe ser la del propio artículo (/guias/<slug>).',
  'not-eligible': 'El artículo no cumple los gates de elegibilidad de publicación.',
  'policy-off': 'La publicación por política está apagada en el despliegue (EDITORIAL_POLICY_PUBLISHING).',
  'policy-paused': 'La publicación está detenida por la parada de emergencia del Admin.',
  'policy-inactive': 'La publicación por política no se ha activado desde el Admin con la clave de revisión humana.',
  'already-published': 'El artículo ya está publicado.',
};

/**
 * Gates cuyo mensaje llega en inglés desde los gates de calidad heredados: se
 * traducen con el mapa. El resto conserva el texto específico del gateway.
 */
const TRANSLATED_CODES: ReadonlySet<string> = new Set(['review']);

/**
 * Subcódigos del gate `editorial`. El gateway ya identifica qué falta; aquí se
 * publica como subcódigo estable para que la UI muestre el motivo sin parsear
 * texto. El orden importa: primero la procedencia ausente y luego cada pieza.
 */
const PROVENANCE_SUBCODES: ReadonlyArray<{ pattern: RegExp; subCode: string }> = [
  { pattern: /procedencia del pipeline editorial|ai-assisted con procedencia/i, subCode: 'editorial-provenance' },
  { pattern: /bundle de evidencia/i, subCode: 'editorial-bundle' },
  { pattern: /draftMarkdown|borrador firmado/i, subCode: 'editorial-draft' },
];

/** Subcódigo estable del motivo de procedencia, o `null` si el mensaje no lo detalla. */
export function provenanceSubCode(message: string): string | null {
  for (const entry of PROVENANCE_SUBCODES) {
    if (entry.pattern.test(message)) return entry.subCode;
  }
  return null;
}

/**
 * Bloqueo listo para la API: conserva el código de gate, mantiene el mensaje
 * específico del gateway y añade el subcódigo del motivo. El texto genérico solo
 * aparece cuando el gateway no aportó nada (o cuando su mensaje está en inglés).
 */
const spanishBlocker = (blocker: PublicationBlocker): PublicationBlocker => {
  const specific = String(blocker.message ?? '').trim();
  const translated = TRANSLATED_CODES.has(blocker.code);
  const message = translated
    ? BLOCKER_MESSAGES[blocker.code] ?? (specific || `No supera el gate «${blocker.code}».`)
    : specific || BLOCKER_MESSAGES[blocker.code] || `No supera el gate «${blocker.code}».`;
  const subCode = blocker.subCode ?? (blocker.code === 'editorial' ? provenanceSubCode(message) : null);
  return { code: blocker.code, ...(subCode ? { subCode } : {}), message };
};

export interface PublicationNowResult {
  postId: string;
  key: string;
  alreadyApplied: boolean;
  publishedAt: string | null;
  post: Record<string, unknown> | null;
  qualityFindings: unknown[];
  note: string;
}

export class EditorialFlowPublicationService {
  constructor(
    private readonly deps: {
      gateway: PublicationGateway;
      store: PublicationIdempotencyStore;
      audit: FlowAuditPort;
      clock?: () => Date;
    }
  ) {}

  private now(): Date {
    return (this.deps.clock ?? (() => new Date()))();
  }

  /** Elegibilidad con bloqueos nombrados; nunca publica. */
  async eligibility(postId: string): Promise<PublicationEligibility> {
    const id = String(postId || '').trim();
    if (!id) throw new ValidationError('El identificador del artículo es obligatorio', []);
    const eligibility = await this.deps.gateway.eligibility(id);
    return { ...eligibility, blockers: eligibility.blockers.map(spanishBlocker) };
  }

  /**
   * Publica una sola vez por clave de idempotencia. La reserva se escribe ANTES
   * de tocar la publicación, así que dos peticiones simultáneas no pueden
   * publicar dos veces; un fallo queda registrado y se reproduce sin republicar.
   */
  async publishNow(input: { postId: string; key: string; actor: string }): Promise<PublicationNowResult> {
    const postId = String(input.postId || '').trim();
    const key = String(input.key || '').trim();
    if (!postId) throw new ValidationError('El identificador del artículo es obligatorio', []);
    if (!key) {
      throw new ValidationError('La publicación manual exige una clave de idempotencia (cabecera Idempotency-Key)', [
        { field: 'Idempotency-Key', message: 'Cabecera obligatoria', value: 'ausente' },
      ]);
    }

    const existing = await this.deps.store.get(key);
    if (existing) return this.replay(existing);

    const eligibility = await this.eligibility(postId);
    if (!eligibility.eligible) throw new PublicationNotEligibleError(eligibility);

    const claim: PublicationIdempotencyRecord = {
      key,
      state: 'in-progress',
      postId,
      actor: input.actor,
      at: this.now().toISOString(),
    };
    const claimed = await this.deps.store.claim(key, claim);
    if (claimed === 'existing') {
      const current = await this.deps.store.get(key);
      if (!current) throw new ConflictError('No se pudo reservar la clave de idempotencia; vuelve a intentarlo.');
      return this.replay(current);
    }

    await this.deps.audit.insert({ at: this.now(), action: 'editorial-flow-publication-start', by: input.actor, postId, key });
    try {
      const published = await this.deps.gateway.publish(postId);
      const publishedAt = this.now().toISOString();
      const result = { postId, publishedAt, status: String((published.post as { status?: unknown }).status ?? 'publish') };
      await this.deps.store.complete(key, { state: 'completed', result, error: null });
      await this.deps.audit.insert({ at: this.now(), action: 'editorial-flow-publication', by: input.actor, postId, key, result });
      return {
        postId,
        key,
        alreadyApplied: false,
        publishedAt,
        post: published.post,
        qualityFindings: published.qualityFindings,
        note: 'Publicación manual ejecutada por la ruta real de publicación por política: todos los gates, el límite diario y la parada de emergencia se han vuelto a comprobar.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.store.complete(key, { state: 'failed', result: null, error: message }).catch(() => undefined);
      await this.deps.audit.insert({ at: this.now(), action: 'editorial-flow-publication-failed', by: input.actor, postId, key, error: message }).catch(() => undefined);
      throw error;
    }
  }

  private replay(record: PublicationIdempotencyRecord): PublicationNowResult {
    if (record.state === 'completed') {
      return {
        postId: record.postId,
        key: record.key,
        alreadyApplied: true,
        publishedAt: record.result?.publishedAt ? String(record.result.publishedAt) : null,
        post: null,
        qualityFindings: [],
        note: 'Esta clave de idempotencia ya se aplicó: no se ha vuelto a publicar ni se ha registrado un segundo evento.',
      };
    }
    if (record.state === 'failed') {
      throw new ConflictError(
        `La misma clave de idempotencia ya intentó publicar y falló (${record.error ?? 'sin detalle'}): no se vuelve a publicar con esa clave.`
      );
    }
    throw new ConflictError('Ya hay una publicación en curso con esta clave de idempotencia: espera a que termine antes de reintentar.');
  }
}
