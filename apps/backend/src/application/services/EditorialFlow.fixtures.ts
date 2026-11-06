/**
 * M14-R7 — Fixtures del Observatorio editorial, copiadas de los volcados de
 * producción (tmp-storage/m14r7/prod-probe*.txt) y de la forma real de cada
 * colección. Incluyen un puerto de lectura en memoria que interpreta los mismos
 * filtros que se envían a MongoDB, para poder probar los recuentos sin base.
 */

import type { FlowCollection, FlowFilter, FlowReadOptions, FlowReadPort } from './EditorialFlowScope';

export const QUEUE_SNAPSHOT = {
  _id: 'current',
  updatedAt: '2026-11-06T08:11:03.838Z',
  items: [
    {
      id: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas',
      title: 'Derechos audiovisuales y accesibilidad en las plataformas',
      category: 'Televisión',
      state: 'held',
      pinned: true,
      intent: 'Explicar las obligaciones de accesibilidad que la Ley 13/2022 impone a las plataformas.',
      explanation: ['coincide con una obligación legal verificable'],
      score: 88,
      attempts: 5,
      reason: 'blocked: agotados los ciclos de revisión (5)',
      sources: ['https://www.boe.es/buscar/act.php?id=BOE-A-2022-12981', 'https://www.cnmc.es/'],
      updatedAt: '2026-11-06T00:08:36.857Z',
    },
    {
      id: 'normas-estadio-entradas-reventa-laliga',
      title: 'Entradas y normas de acceso al estadio en el fútbol español',
      category: 'Deportes',
      state: 'rejected',
      attempts: 0,
      reason: 'insufficient-evidence: menos de dos entidades editoras verificadas (https://www.laliga.com/es-ES/clubes HTTP 404)',
      sources: ['https://www.boe.es/buscar/act.php?id=BOE-A-2007-13409', 'https://www.laliga.com/es-ES/clubes'],
      updatedAt: '2026-11-03T08:39:42.706Z',
    },
    {
      id: 'arbitros-var-laliga-que-se-revisa',
      title: 'El VAR en LaLiga: qué se revisa y qué no',
      category: 'Deportes',
      state: 'rejected',
      attempts: 0,
      reason: 'insufficient-evidence: menos de dos entidades editoras verificadas (https://www.rfef.es/es/arbitros HTTP 404)',
      sources: ['https://www.rfef.es/es/arbitros'],
      updatedAt: '2026-11-03T08:39:42.706Z',
    },
    {
      id: 'apple-tv-airplay-ajustes-imagen-television',
      title: 'Apple TV+ y AirPlay: cómo ver contenido en tu televisor',
      category: 'Tecnología',
      state: 'rejected',
      attempts: 0,
      reason: 'invalid-candidate: slug demasiado largo para el patrón editorial',
      sources: ['https://support.apple.com/es-es/HT204662'],
      updatedAt: '2026-11-03T08:39:42.707Z',
    },
    {
      id: 'control-parental-netflix-prime-video',
      title: 'Control parental en Netflix y Prime Video',
      category: 'Streaming',
      state: 'rejected',
      attempts: 0,
      reason: 'duplicate: coincide con la intención de una guía ya publicada',
      sources: ['https://help.netflix.com/es/node/264'],
      updatedAt: '2026-11-02T10:00:00.000Z',
    },
    {
      id: 'precios-streaming-cambio-de-plan',
      title: 'Cambios de plan y precios en las plataformas de streaming',
      category: 'Streaming',
      state: 'rejected',
      attempts: 1,
      reason: 'manual: descartado por el operador tras revisar el encargo',
      sources: ['https://www.netflix.com/es/'],
      updatedAt: '2026-11-01T09:00:00.000Z',
    },
    {
      id: 'que-ver-hoy-en-tv',
      title: 'Qué ver hoy en televisión: ideas rápidas para no perder tiempo',
      category: 'Streaming',
      state: 'queued',
      score: 62,
      attempts: 0,
      sources: ['https://www.rtve.es/'],
      updatedAt: '2026-11-06T08:11:03.838Z',
    },
    {
      id: 'cine-de-verano-caducado',
      title: 'Cine de verano en abierto: programación especial',
      category: 'Cine',
      state: 'expired',
      attempts: 0,
      reason: 'expired: fuera de temporada',
      sources: ['https://www.rtve.es/'],
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
  ],
};

export const JOBS = [
  {
    jobId: '2026-11-06T00:08:36.857Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas',
    slug: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas',
    state: 'blocked',
    reason: 'agotados los ciclos de revisión (5)',
    startedAt: '2026-11-06T00:08:36.857Z',
    backend: 'deepseek',
    costUsd: 0.829794,
    costEntries: [{ role: 'research', model: 'deepseek-v4-pro' }, { role: 'critic', model: 'deepseek-v4-pro' }],
    blockingCodes: ['figure-not-in-claim'],
    revisions: 4,
    revisionLog: ['revise/rewrite:figure-in-words', 'revise/re-research:figure-not-in-claim'],
    publicUrl: null,
    receivedAt: '2026-11-06T00:26:26.137Z',
  },
  {
    jobId: '2026-11-05T15:23:05.084Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas',
    slug: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas',
    state: 'blocked',
    reason: "error: Cannot read properties of undefined (reading 'length')",
    startedAt: '2026-11-05T15:23:05.084Z',
    backend: null,
    costEntries: [{ role: 'research', model: 'deepseek-v4-pro' }],
    revisions: 0,
    revisionLog: [],
    publicUrl: null,
    receivedAt: '2026-11-05T15:26:05.635Z',
  },
  {
    jobId: '2026-10-27T20:21:33.075Z-horario-proteccion-menores-television-calificacion-por-edades',
    slug: 'horario-proteccion-menores-television-calificacion-por-edades',
    state: 'published',
    reason: null,
    startedAt: '2026-10-27T20:21:33.075Z',
    backend: 'anthropic',
    costEntries: [{ role: 'research', model: 'claude-haiku-5-5' }],
    revisions: 1,
    revisionLog: ['pass/pass'],
    publicUrl: 'https://guiaprogramaciontv.com/guias/horario-proteccion-menores-television-calificacion-por-edades',
    receivedAt: '2026-10-27T23:33:34.130Z',
  },
  {
    jobId: '2026-10-28T10:21:18.987Z-maint-limite-anuncios-television-minutos-por-hora-ley',
    slug: 'limite-anuncios-television-minutos-por-hora-ley',
    state: 'maintenance-verified',
    reason: '22 afirmaciones verificadas',
    startedAt: '2026-10-28T10:21:18.987Z',
    costEntries: [],
    revisions: 0,
    revisionLog: [],
    publicUrl: null,
    receivedAt: '2026-10-28T10:21:19.026Z',
  },
  {
    jobId: '2026-11-06T05:11:06.140Z-discovery',
    slug: 'discovery',
    state: 'discovery',
    reason: '6 propuestos, 0 en cola, 6 descartados',
    startedAt: '2026-11-06T05:16:11.006Z',
    backend: 'anthropic',
    costEntries: [{ role: 'discovery', model: 'deepseek-v4-pro' }],
    revisions: 0,
    revisionLog: [],
    publicUrl: null,
    receivedAt: '2026-11-06T05:16:11.016Z',
  },
  {
    jobId: '2026-11-03T08:33:36.184Z-maint-subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones',
    slug: 'subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones',
    state: 'maintenance-unverifiable',
    reason: 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar',
    startedAt: '2026-11-03T08:33:36.184Z',
    costEntries: [],
    revisions: 0,
    revisionLog: [],
    publicUrl: null,
    receivedAt: '2026-11-03T08:33:36.191Z',
  },
];

export const LEDGER = [
  {
    jobId: 'm14-ledger-1',
    slug: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas',
    kind: 'article',
    state: 'blocked',
    currentStage: 'quality-evaluation',
    attempt: 2,
    maxAttempts: 3,
    createdAt: '2026-11-05T23:00:00.000Z',
    updatedAt: '2026-11-06T00:08:36.857Z',
    publication: null,
    stages: [
      { name: 'source-retrieval', attempt: 1, state: 'completed', startedAt: '2026-11-05T23:01:00.000Z', endedAt: '2026-11-05T23:03:00.000Z', detail: '3 fuentes recuperadas' },
      { name: 'quality-evaluation', attempt: 1, state: 'failed', startedAt: '2026-11-05T23:04:00.000Z', endedAt: '2026-11-05T23:20:00.000Z', detail: 'revisión agotada' },
    ],
  },
  {
    jobId: 'm14-ledger-2',
    slug: 'horario-proteccion-menores-television-calificacion-por-edades',
    kind: 'article',
    state: 'completed',
    currentStage: 'publication',
    attempt: 1,
    maxAttempts: 3,
    createdAt: '2026-10-27T20:00:00.000Z',
    publication: {
      key: 'pub-1',
      state: 'published',
      url: 'https://guiaprogramaciontv.com/guias/horario-proteccion-menores-television-calificacion-por-edades',
      at: '2026-10-27T23:33:34.130Z',
    },
    stages: [{ name: 'publication', attempt: 1, state: 'completed', startedAt: '2026-10-27T23:33:00.000Z', endedAt: '2026-10-27T23:33:34.130Z' }],
  },
];

export const POSTS = [
  {
    _id: '6ae134cef4a4ff1acf24a49c',
    slug: 'limite-anuncios-television-minutos-por-hora-ley',
    title: 'Límites de publicidad en televisión: Ley 13/2022',
    categories: [{ name: 'Televisión' }],
    status: 'publish',
    reviewState: 'approved',
    publishedAt: '2026-10-28T00:33:34.000Z',
    createdAt: '2026-10-28T00:33:34.000Z',
    updatedAt: '2026-10-28T00:33:34.000Z',
    origin: 'ai-assisted',
    seo: { canonicalUrl: '/guias/limite-anuncios-television-minutos-por-hora-ley' },
  },
  {
    _id: '6ae134cdf4a4ff1acf24a48b',
    slug: 'horario-proteccion-menores-television-calificacion-por-edades',
    title: 'Horario de contenidos para adultos en la TV española',
    categories: [{ name: 'Televisión' }],
    status: 'publish',
    reviewState: 'approved',
    publishedAt: '2026-10-28T00:33:33.000Z',
    createdAt: '2026-10-28T00:33:33.000Z',
    updatedAt: '2026-10-28T00:33:33.000Z',
    origin: 'ai-assisted',
    seo: { canonicalUrl: '/guias/horario-proteccion-menores-television-calificacion-por-edades' },
  },
  {
    _id: '6ae134cff4a4ff1acf24a4ad',
    slug: 'subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones',
    title: 'Subtítulos, audiodescripción y signos en TV: Ley 13/2022',
    categories: [{ name: 'Televisión' }],
    status: 'publish',
    reviewState: 'approved',
    publishedAt: '2026-10-28T00:33:35.000Z',
    createdAt: '2026-10-28T00:33:35.000Z',
    updatedAt: '2026-10-28T00:33:35.000Z',
    origin: 'ai-assisted',
    seo: { canonicalUrl: '/guias/subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones' },
  },
  {
    // Legacy aprobado y en borrador: aprobado NO implica publicado.
    _id: '6ae1d117d7775493a1b536ec',
    slug: 'descargar-series-netflix-grabar-tele-copia-privada',
    title: 'Grabar la tele y guardar descargas de Netflix: qué es legal',
    categories: [{ name: 'Streaming' }],
    status: 'draft',
    reviewState: 'approved',
    publishedAt: '2026-10-28T10:40:24.000Z',
    createdAt: '2026-10-28T10:40:23.000Z',
    updatedAt: '2026-10-28T10:40:24.000Z',
    origin: 'ai-assisted',
    seo: { canonicalUrl: '/guias/descargar-series-netflix-grabar-tele-copia-privada' },
  },
  {
    // Legacy sin status: la masa de 'desconocido' debe ser explícita.
    _id: '6ae1d117d7775493a1b536ed',
    slug: 'guia-legacy-sin-estado',
    title: 'Guía heredada sin estado de publicación registrado',
    categories: [{ name: 'Cine' }],
    reviewState: 'approved',
    publishedAt: '2026-09-01T09:00:00.000Z',
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    origin: 'ai-assisted',
    seo: {},
  },
  {
    // En revisión (forma parte de la masa de aprobados/en revisión).
    _id: '6ae1d117d7775493a1b536ee',
    slug: 'guia-en-revision-editorial',
    title: 'Guía en revisión editorial pendiente de decisión',
    categories: [{ name: 'Series' }],
    status: 'draft',
    reviewState: 'in-review',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-02T09:00:00.000Z',
    origin: 'ai-assisted',
    seo: {},
  },
  {
    // Borrador sin revisar: cuenta en «en redacción», no en reconciliación.
    _id: '669eaa000000000000000001',
    slug: 'que-ver-en-familia-este-fin-de-semana-television-y-streaming',
    title: 'Qué ver en familia este fin de semana en televisión y streaming',
    categories: [{ name: 'Cine' }],
    status: 'draft',
    reviewState: 'unreviewed',
    publishedAt: '2026-08-31T09:00:00.000Z',
    createdAt: '2026-03-10T12:31:09.254Z',
    updatedAt: '2026-10-19T22:04:30.502Z',
    origin: 'ai-assisted',
    seo: {},
  },
  {
    // Publicado y aprobado, con indexación conocida.
    _id: '6ae95cedd300ec7262fbd38',
    slug: 'movistar-plus-vs-dazn',
    title: 'Movistar Plus+ frente a DAZN: qué plataforma elegir',
    categories: [{ name: 'Deportes' }],
    status: 'publish',
    reviewState: 'approved',
    publishedAt: '2026-08-31T09:00:00.000Z',
    createdAt: '2026-08-31T18:45:08.791Z',
    updatedAt: '2026-10-19T22:03:22.327Z',
    origin: 'ai-assisted',
    seo: { canonicalUrl: '/guias/movistar-plus-vs-dazn' },
  },
];

export const INSPECTIONS = [
  {
    url: 'https://guiaprogramaciontv.com/guias/limite-anuncios-television-minutos-por-hora-ley',
    coverageState: 'Descubierta: actualmente sin indexar',
    inspectedAt: '2026-11-05T17:22:53.785Z',
  },
  {
    url: 'https://guiaprogramaciontv.com/guias/horario-proteccion-menores-television-calificacion-por-edades',
    coverageState: 'Google no reconoce esta URL',
    inspectedAt: '2026-11-05T17:22:53.785Z',
  },
  {
    url: 'https://guiaprogramaciontv.com/guias/movistar-plus-vs-dazn',
    coverageState: 'Página indexada',
    inspectedAt: '2026-11-05T17:22:53.785Z',
  },
];

export const APPROVALS = [
  { _id: '6ae134cef4a4ff1acf24a49c:d734da', postId: '6ae134cef4a4ff1acf24a49c', at: '2026-10-27T23:33:34.764Z' },
  { _id: '6ae134cdf4a4ff1acf24a48b:498508', postId: '6ae134cdf4a4ff1acf24a48b', at: '2026-10-27T23:33:33.764Z' },
  { _id: '6ae95cedd300ec7262fbd38:280ba5', postId: '6ae95cedd300ec7262fbd38', at: '2026-10-28T10:40:24.380Z' },
];

export const GENERATION_REQUESTS = [
  {
    id: 'c5bfb0e3-641a-4a36-99b0-ed1f594785c6',
    kind: 'queue-action',
    status: 'completed',
    queueAction: { action: 'approve', topicId: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', reason: '' },
    createdAt: '2026-11-05T13:44:01.361Z',
    createdBy: 'manuelxgon@gmail.com',
  },
  {
    id: '0d0c7a1e-1111-4222-8333-944455566677',
    kind: 'generate',
    status: 'completed',
    topic: { slug: 'horario-proteccion-menores-television-calificacion-por-edades' },
    createdAt: '2026-10-27T20:00:00.000Z',
    createdBy: 'admin-key',
  },
];

export const COLLECTIONS: Record<FlowCollection, Array<Record<string, unknown>>> = {
  editorial_jobs: JOBS,
  editorial_job_ledger: LEDGER,
  editorial_queue_snapshot: [QUEUE_SNAPSHOT],
  blog_posts: POSTS,
  editorial_settings: [],
  editorial_gsc_inspections: INSPECTIONS,
  editorial_policy_approvals: APPROVALS,
  editorial_audit: [],
  editorial_cycles: [],
  editorial_generation_requests: GENERATION_REQUESTS,
  editorial_runner: [],
};

/* ────────────────────────────────────────────────────────────────────────────
 * Mini-intérprete de filtros de MongoDB (suficiente para las consultas del
 * Observatorio: igualdad, $in, $exists, $regex, $not, $gte/$lte, $or, $and y
 * rutas con puntos sobre arrays).
 * ──────────────────────────────────────────────────────────────────────────── */

type AnyRecord = Record<string, unknown>;

const resolvePath = (doc: AnyRecord, path: string): unknown[] => {
  const walk = (value: unknown, parts: string[]): unknown[] => {
    if (parts.length === 0) return [value];
    if (Array.isArray(value)) return value.flatMap((item) => walk(item, parts));
    if (!value || typeof value !== 'object') return [];
    const [head, ...rest] = parts;
    return walk((value as AnyRecord)[head], rest);
  };
  return walk(doc, path.split('.'));
};

const same = (left: unknown, right: unknown): boolean => {
  if (left instanceof Date || right instanceof Date) {
    return new Date(left as Date).getTime() === new Date(right as Date).getTime();
  }
  return left === right;
};

const matchValue = (value: unknown, condition: unknown): boolean => {
  if (condition instanceof RegExp) return typeof value === 'string' && condition.test(value);
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    const spec = condition as AnyRecord;
    const keys = Object.keys(spec);
    if (keys.length === 0) return JSON.stringify(value) === JSON.stringify(condition);
    return keys.every((key) => {
      if (key === '$in') return (spec.$in as unknown[]).some((candidate) => same(value, candidate));
      if (key === '$exists') return (value !== undefined) === Boolean(spec.$exists);
      if (key === '$not') return !matchValue(value, spec.$not);
      if (key === '$regex') return typeof value === 'string' && new RegExp(String(spec.$regex), String(spec.$options ?? '')).test(value);
      if (key === '$gte') return value !== undefined && new Date(value as string).getTime() >= new Date(spec.$gte as string).getTime();
      if (key === '$lte') return value !== undefined && new Date(value as string).getTime() <= new Date(spec.$lte as string).getTime();
      throw new Error(`Filtro no soportado por el puerto de pruebas: ${key}`);
    });
  }
  return same(value, condition);
};

const matches = (doc: AnyRecord, filter: FlowFilter): boolean => {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$or') {
      if (!(condition as FlowFilter[]).some((branch) => matches(doc, branch))) return false;
      continue;
    }
    if (key === '$and') {
      if (!(condition as FlowFilter[]).every((branch) => matches(doc, branch))) return false;
      continue;
    }
    const values = resolvePath(doc, key);
    if (!values.length) {
      if (!matchValue(undefined, condition)) return false;
      continue;
    }
    if (!values.some((value) => matchValue(value, condition))) return false;
  }
  return true;
};

/** Puerto de lectura en memoria: mismas consultas que se enviarían a MongoDB. */
export class MemoryFlowRead implements FlowReadPort {
  constructor(
    private readonly collections: Record<FlowCollection, Array<Record<string, unknown>>> = COLLECTIONS,
    private readonly isConnected = true
  ) {}

  connected(): boolean {
    return this.isConnected;
  }

  async find(collection: FlowCollection, filter: FlowFilter, options: FlowReadOptions = {}): Promise<Array<Record<string, unknown>>> {
    if (!this.isConnected) return [];
    const docs = (this.collections[collection] ?? []).filter((doc) => matches(doc, filter));
    const sorted = options.sort
      ? [...docs].sort((left, right) => {
          for (const [field, direction] of Object.entries(options.sort!)) {
            const a = String(resolvePath(left, field)[0] ?? '');
            const b = String(resolvePath(right, field)[0] ?? '');
            if (a !== b) return a < b ? -direction : direction;
          }
          return 0;
        })
      : docs;
    return (options.limit ? sorted.slice(0, options.limit) : sorted).map((doc) => ({ ...doc }));
  }
}

/** Colecciones vacías: base recién creada, para probar el caso de cero datos. */
export const emptyCollections = (): Record<FlowCollection, Array<Record<string, unknown>>> => ({
  editorial_jobs: [],
  editorial_job_ledger: [],
  editorial_queue_snapshot: [],
  blog_posts: [],
  editorial_gsc_inspections: [],
  editorial_audit: [],
  editorial_policy_approvals: [],
  editorial_cycles: [],
  editorial_generation_requests: [],
  editorial_runner: [],
  editorial_settings: [],
});
