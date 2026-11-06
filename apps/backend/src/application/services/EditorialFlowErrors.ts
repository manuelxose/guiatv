/**
 * M14-R7 — Errores del Observatorio editorial.
 *
 * El `NotFoundError` del repositorio compone el mensaje en inglés
 * ("<recurso> not found"); el Observatorio debe devolver todo el texto de usuario
 * en español, así que usa este error 404 equivalente.
 */

import { AppError } from '../../shared/errors';

export class EditorialFlowNotFound extends AppError {
  constructor(message: string) {
    super(message, 404, true, 'NOT_FOUND');
  }
}

/** 404 para un tema que no existe en ninguna de las colecciones del flujo. */
export const topicNotFound = (id: string): EditorialFlowNotFound =>
  new EditorialFlowNotFound(`No existe ningún tema, trabajo ni artículo con el identificador «${id || '(vacío)'}»`);

/** 404 para un artículo que no existe en el CMS. */
export const postNotFound = (id: string): EditorialFlowNotFound =>
  new EditorialFlowNotFound(`No existe ningún artículo con el identificador «${id || '(vacío)'}»`);
