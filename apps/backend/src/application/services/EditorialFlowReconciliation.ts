/**
 * M14-R7 — Reconciliación de los registros legacy.
 *
 * Devuelve los artículos aprobados o en revisión con MASA DE 'DESCONOCIDO'
 * EXPLÍCITA: para cada registro se dice qué consta (colección propietaria,
 * status, reviewState, publishedAt, URL, sitemap, inspección GSC, solape con la
 * cola, job en el ledger) y qué no consta. El veredicto es
 * publicado / no publicado / desconocido, y 'desconocido' es un resultado válido:
 * nunca se convierte en 'publicado' por omisión.
 */

import { provenanceSignatureValid } from './EditorialEvidence';
import type { EditorialProvenance } from './EditorialEvidence';
import type { FlowScope } from './EditorialFlowScope';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isoOrNull = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export type GateStatus = 'ok' | 'missing' | 'unknown';

export interface ReconciliationGate {
  gate: string;
  label: string;
  status: GateStatus;
  detail: string;
  source: string;
}

export type ReconciliationVerdict = 'publicado' | 'no publicado' | 'desconocido';

export interface ReconciliationRecord {
  postId: string;
  slug: string;
  title: string;
  collection: 'blog_posts';
  workflowVersion: string;
  status: string | null;
  reviewState: string | null;
  publishedAt: string | null;
  publicUrl: string | null;
  inSitemap: boolean;
  sitemapRule: string;
  gsc: { inspected: boolean; coverageState: string | null; inspectedAt: string | null; seoState: string } | null;
  overlapsTopic: { matched: string | null; rule: string } | null;
  ledgerJob: { jobId: string; state: string; attempt: number | null } | null;
  eligibilityGates: ReconciliationGate[];
  verdict: ReconciliationVerdict;
  verdictReason: string;
  unknowns: string[];
}

export interface ReconciliationReport {
  generatedAt: string;
  scope: FlowScope;
  rule: string;
  count: number;
  records: ReconciliationRecord[];
  mass: { total: number; published: number; notPublished: number; unknown: number; note: string };
  gateSummary: Array<{ gate: string; label: string; ok: number; missing: number; unknown: number }>;
  dataGaps: string[];
}

export interface ReconciliationInput {
  posts: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
  queueItems: Array<Record<string, unknown>>;
  ledgerJobs: Array<Record<string, unknown>>;
  scope: FlowScope;
  now: Date;
  signingKeyConfigured: boolean;
  signingKey?: string;
}

const SITEMAP_RULE = 'Un artículo está en el sitemap si cumple status="publish" y reviewState="approved" (PUBLIC_EDITORIAL_FILTER, la misma regla que usa SitemapController).';

function evaluateGates(input: {
  post: Record<string, unknown>;
  editorial: EditorialProvenance | undefined;
  inSitemap: boolean;
  inspection: Record<string, unknown> | undefined;
  ledger: Record<string, unknown> | undefined;
  signingKeyConfigured: boolean;
  signingKey?: string;
}): ReconciliationGate[] {
  const { post, editorial, inSitemap, inspection, ledger, signingKeyConfigured, signingKey } = input;
  const status = text(post.status);
  const reviewState = text(post.reviewState);
  const canonical = text((post.seo as { canonicalUrl?: unknown } | undefined)?.canonicalUrl);
  const slug = text(post.slug);

  let signatureStatus: GateStatus = 'unknown';
  let signatureDetail = 'No hay clave de firma configurada en este proceso: la firma no se puede verificar aquí.';
  if (!editorial) {
    signatureStatus = 'missing';
    signatureDetail = 'El registro no tiene procedencia del pipeline (editorial), así que no hay nada que firmar.';
  } else if (signingKeyConfigured) {
    try {
      const valid = provenanceSignatureValid(editorial, signingKey);
      signatureStatus = valid ? 'ok' : 'missing';
      signatureDetail = valid ? 'La firma del pipeline es válida con la clave configurada.' : 'La firma del pipeline no valida con la clave configurada.';
    } catch {
      signatureStatus = 'unknown';
      signatureDetail = 'No se pudo verificar la firma: el registro de procedencia está incompleto.';
    }
  }

  return [
    {
      gate: 'editorial-aprobado',
      label: 'Aprobación editorial',
      status: reviewState === 'approved' ? 'ok' : reviewState ? 'missing' : 'unknown',
      detail: reviewState === 'approved' ? 'reviewState="approved".' : `reviewState="${reviewState || 'no consta'}".`,
      source: 'blog_posts.reviewState',
    },
    {
      gate: 'publicado',
      label: 'Publicación',
      status: status === 'publish' ? 'ok' : status ? 'missing' : 'unknown',
      detail: status === 'publish' ? 'status="publish".' : `status="${status || 'no consta'}": el artículo no está en el sitio público.`,
      source: 'blog_posts.status',
    },
    {
      gate: 'procedencia-pipeline',
      label: 'Procedencia del pipeline',
      status: editorial ? 'ok' : 'missing',
      detail: editorial ? `Procedencia presente (workflow ${text((editorial as { pipelineVersion?: unknown }).pipelineVersion) || 'no consta'}).` : 'Registro legacy sin procedencia del pipeline.',
      source: 'blog_posts.editorial',
    },
    {
      gate: 'firma-procedencia',
      label: 'Firma de la procedencia',
      status: signatureStatus,
      detail: signatureDetail,
      source: 'blog_posts.editorial + EDITORIAL_PIPELINE_SIGNING_KEY',
    },
    {
      gate: 'url-canonica',
      label: 'URL canónica',
      status: canonical === `/guias/${slug}` ? 'ok' : canonical ? 'missing' : 'unknown',
      detail: canonical ? `canonicalUrl="${canonical}".` : 'No consta canonicalUrl en el documento.',
      source: 'blog_posts.seo.canonicalUrl',
    },
    {
      gate: 'en-sitemap',
      label: 'Presencia en sitemap',
      status: inSitemap ? 'ok' : 'missing',
      detail: inSitemap ? 'Cumple la regla del sitemap.' : 'No cumple la regla del sitemap: no se publica en él.',
      source: 'blog_posts.status + reviewState',
    },
    {
      gate: 'inspeccion-gsc',
      label: 'Inspección de Search Console',
      status: inspection ? 'ok' : 'missing',
      detail: inspection ? `Última cobertura: "${text(inspection.coverageState) || 'no consta'}".` : 'No hay inspección registrada para la URL.',
      source: 'editorial_gsc_inspections',
    },
    {
      gate: 'job-en-ledger',
      label: 'Trabajo en el libro de ejecución',
      status: ledger ? 'ok' : 'missing',
      detail: ledger ? `Job ${text(ledger.jobId)} en estado ${text(ledger.state)}.` : 'No hay job en editorial_job_ledger para este slug.',
      source: 'editorial_job_ledger',
    },
  ];
}

function verdictOf(post: Record<string, unknown>, gates: ReconciliationGate[]): { verdict: ReconciliationVerdict; reason: string } {
  const status = text(post.status);
  const reviewState = text(post.reviewState);
  const publishedAt = isoOrNull(post.publishedAt);
  if (status === 'publish') {
    return {
      verdict: 'publicado',
      reason: 'status="publish": el artículo está en el sitio público (publicado no implica indexado ni que la firma sea válida).',
    };
  }
  if (status === 'draft' && reviewState === 'approved') {
    return {
      verdict: 'no publicado',
      reason: 'Aprobado editorialmente pero en borrador: aprobado no implica publicado.',
    };
  }
  if (status === 'draft' && reviewState === 'in-review') {
    return { verdict: 'no publicado', reason: 'En revisión y en borrador: no está en el sitio público.' };
  }
  if (status === 'draft' && reviewState === 'rejected') {
    return { verdict: 'no publicado', reason: 'Rechazado editorialmente y en borrador: no está en el sitio público.' };
  }
  if (status === 'draft' && publishedAt) {
    return {
      verdict: 'desconocido',
      reason: `Hay publishedAt (${publishedAt}) pero status="draft": el registro se contradice y la historia no consta. No se afirma ni publicado ni no publicado.`,
    };
  }
  const missing = gates.filter((gate) => gate.status === 'missing').length;
  return {
    verdict: 'desconocido',
    reason: `El registro no declara un estado publicable reconocible (${missing} gates faltantes): no se puede afirmar si se publicó.`,
  };
}

/** Compone el informe de reconciliación; nunca inventa un estado que no conste. */
export function composeReconciliation(input: ReconciliationInput): ReconciliationReport {
  const inspectionsByUrl = new Map<string, Record<string, unknown>>();
  for (const inspection of input.inspections) {
    const url = text(inspection.url);
    if (url) inspectionsByUrl.set(url, inspection);
  }
  const queueBySlug = new Map<string, Record<string, unknown>>();
  for (const item of input.queueItems) {
    const id = text(item.id);
    if (id) queueBySlug.set(id, item);
  }
  const ledgerBySlug = new Map<string, Record<string, unknown>>();
  for (const job of input.ledgerJobs) {
    const slug = text(job.slug);
    if (slug) ledgerBySlug.set(slug, job);
  }

  const records: ReconciliationRecord[] = input.posts.map((post) => {
    const slug = text(post.slug);
    const publicUrl = `https://guiaprogramaciontv.com/guias/${slug}`;
    const inSitemap = text(post.status) === 'publish' && text(post.reviewState) === 'approved';
    const inspection = inspectionsByUrl.get(publicUrl);
    const ledger = ledgerBySlug.get(slug);
    const queueItem = queueBySlug.get(slug);
    const editorial = post.editorial as EditorialProvenance | undefined;
    const gates = evaluateGates({
      post,
      editorial,
      inSitemap,
      inspection,
      ledger,
      signingKeyConfigured: input.signingKeyConfigured,
      signingKey: input.signingKey,
    });
    const { verdict, reason } = verdictOf(post, gates);
    const unknowns = gates
      .filter((gate) => gate.status === 'unknown')
      .map((gate) => `${gate.label}: ${gate.detail}`);
    if (!inspection) unknowns.push('Estado SEO: no hay inspección, así que la indexación no consta (publicado no implica indexado).');
    if (!queueItem) unknowns.push('Solape con la cola: no hay ítem de cola con este slug; puede haberse consumido o no haber pasado nunca por la cola.');
    return {
      postId: post._id ? String(post._id) : slug,
      slug,
      title: text(post.title),
      collection: 'blog_posts',
      workflowVersion: text((editorial as { pipelineVersion?: unknown } | undefined)?.pipelineVersion) || 'no-consta',
      status: text(post.status) || null,
      reviewState: text(post.reviewState) || null,
      publishedAt: isoOrNull(post.publishedAt),
      publicUrl,
      inSitemap,
      sitemapRule: SITEMAP_RULE,
      gsc: inspection
        ? {
            inspected: true,
            coverageState: text(inspection.coverageState) || null,
            inspectedAt: isoOrNull(inspection.inspectedAt),
            seoState: text(inspection.coverageState) === 'Página indexada' ? 'indexada' : 'no-indexada-segun-inspeccion',
          }
        : null,
      overlapsTopic: queueItem
        ? { matched: text(queueItem.id), rule: 'coincidencia exacta entre blog_posts.slug y editorial_queue_snapshot.items[].id' }
        : null,
      ledgerJob: ledger
        ? { jobId: text(ledger.jobId), state: text(ledger.state), attempt: Number.isInteger(ledger.attempt) ? Number(ledger.attempt) : null }
        : null,
      eligibilityGates: gates,
      verdict,
      verdictReason: reason,
      unknowns,
    };
  });

  const published = records.filter((record) => record.verdict === 'publicado').length;
  const notPublished = records.filter((record) => record.verdict === 'no publicado').length;
  const unknown = records.filter((record) => record.verdict === 'desconocido').length;

  const gateNames = records.length ? records[0].eligibilityGates.map((gate) => gate.gate) : [];
  const gateSummary = gateNames.map((gate) => {
    const rows = records.map((record) => record.eligibilityGates.find((row) => row.gate === gate)).filter(Boolean) as ReconciliationGate[];
    const label = records[0].eligibilityGates.find((row) => row.gate === gate)?.label ?? gate;
    return {
      gate,
      label,
      ok: rows.filter((row) => row.status === 'ok').length,
      missing: rows.filter((row) => row.status === 'missing').length,
      unknown: rows.filter((row) => row.status === 'unknown').length,
    };
  });

  return {
    generatedAt: input.now.toISOString(),
    scope: input.scope,
    rule: 'Registros legacy con origin="ai-assisted" y reviewState en {approved, in-review}: la masa de desconocidos se informa aparte y nunca se reparte por suposición.',
    count: records.length,
    records,
    mass: {
      total: records.length,
      published,
      notPublished,
      unknown,
      note: 'La suma de publicado + no publicado + desconocido es el total de registros analizados.',
    },
    gateSummary,
    dataGaps: [
      'El sistema no registra la fecha de la primera publicación de un registro legacy que perdió publishedAt: la historia previa no consta.',
      'La presencia en sitemap es una regla derivada, no una lectura del sitemap generado: se calcula con la misma condición que usa SitemapController.',
    ],
  };
}
