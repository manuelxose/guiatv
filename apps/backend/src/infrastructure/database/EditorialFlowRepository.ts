/**
 * M14-R7 — Adaptador Mongo del Observatorio editorial.
 *
 * Solo lectura para el diagnóstico (las consultas se devuelven tal cual al cliente
 * para poder contrastarlas) y escritura ACOTADA para:
 * - la auditoría del Observatorio (colección `editorial_audit`, la misma del Admin),
 * - la reserva de idempotencia de la publicación manual (`editorial_flow_publications`).
 *
 * Ninguna de estas escrituras publica, cambia estados del flujo ni toca la
 * configuración del planificador.
 */

import mongoose from 'mongoose';
import type { FlowFilter, FlowQuery, FlowReadOptions, FlowReadPort } from '../../application/services/EditorialFlowScope';
import type {
  FlowAuditPort,
  PublicationIdempotencyRecord,
  PublicationIdempotencyStore,
} from '../../application/services/EditorialFlowPublication';
import { BlogPostModel } from './models/BlogPost.model';

export const PUBLICATION_IDEMPOTENCY_COLLECTION = 'editorial_flow_publications';

interface PublicationDocument {
  _id: string;
  state: PublicationIdempotencyRecord['state'];
  postId: string;
  actor: string;
  at: string;
  result: Record<string, unknown> | null;
  error: string | null;
  completedAt?: string;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const db = () => BlogPostModel.db;

/** Identificador de Mongo a partir de la cadena, solo cuando es un ObjectId válido. */
function normalizeId(value: unknown): unknown {
  return typeof value === 'string' && OBJECT_ID.test(value) ? new mongoose.Types.ObjectId(value) : value;
}

function normalizeFilter(filter: FlowFilter): FlowFilter {
  if (!filter || !Object.prototype.hasOwnProperty.call(filter, '_id')) return filter;
  return { ...filter, _id: normalizeId(filter._id) };
}

/** Puerto de lectura real contra MongoDB. */
export class MongoEditorialFlowRead implements FlowReadPort {
  connected(): boolean {
    try {
      return db()?.readyState === 1;
    } catch {
      return false;
    }
  }

  async find(collection: FlowQuery['collection'], filter: FlowFilter, options: FlowReadOptions = {}): Promise<Array<Record<string, unknown>>> {
    if (!this.connected()) return [];
    const docs = await db()
      .collection(collection)
      .find(normalizeFilter(filter) as mongoose.mongo.Filter<Record<string, unknown>>, {
        ...(options.projection ? { projection: options.projection } : {}),
        ...(options.sort ? { sort: options.sort } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      })
      .toArray();
    return docs as Array<Record<string, unknown>>;
  }
}

/** Auditoría del Observatorio: escribe en la colección `editorial_audit` existente. */
export class MongoEditorialFlowAudit implements FlowAuditPort {
  async insert(row: Record<string, unknown>): Promise<void> {
    await db().collection('editorial_audit').insertOne(row);
  }

  async list(filter: Record<string, unknown>, options: { limit?: number; sort?: Record<string, 1 | -1> } = {}): Promise<Array<Record<string, unknown>>> {
    const docs = await db()
      .collection('editorial_audit')
      .find(filter, {
        ...(options.sort ? { sort: options.sort } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      })
      .toArray();
    return docs as Array<Record<string, unknown>>;
  }
}

/**
 * Reserva de idempotencia: el `_id` es la clave enviada por el operador, así que
 * dos peticiones con la misma clave chocan en el índice único y solo una publica.
 */
export class MongoEditorialFlowPublicationStore implements PublicationIdempotencyStore {
  private collection() {
    return db().collection<PublicationDocument>(PUBLICATION_IDEMPOTENCY_COLLECTION);
  }

  async claim(key: string, record: PublicationIdempotencyRecord): Promise<'claimed' | 'existing'> {
    try {
      await this.collection().insertOne({
        _id: key,
        state: record.state,
        postId: record.postId,
        actor: record.actor,
        at: record.at,
        result: record.result ?? null,
        error: record.error ?? null,
      });
      return 'claimed';
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return 'existing';
      throw error;
    }
  }

  async complete(key: string, patch: Pick<PublicationIdempotencyRecord, 'state' | 'result' | 'error'>): Promise<void> {
    await this.collection().updateOne(
      { _id: key },
      { $set: { state: patch.state, result: patch.result ?? null, error: patch.error ?? null, completedAt: new Date().toISOString() } }
    );
  }

  async get(key: string): Promise<PublicationIdempotencyRecord | null> {
    const doc = await this.collection().findOne({ _id: key });
    if (!doc) return null;
    return {
      key: String(doc._id),
      state: doc.state,
      postId: String(doc.postId ?? ''),
      actor: String(doc.actor ?? ''),
      at: String(doc.at ?? ''),
      result: doc.result ?? null,
      error: doc.error ?? null,
    };
  }
}
