import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogAssetSet,
  buildProgramBrandKey,
  buildChannelIdentityMetadata,
  buildProgramTitleAliases,
  buildTvReadAiringId,
  buildSearchTokens,
  inferEditorialCategory,
  inferChannelGroup,
  inferSportFacet,
  isGenericMovieTitle,
  resolveProgramDisplayTitle,
  findCanonicalChannelInText,
  resolveCanonicalChannelId,
} from './tvMetadata';

test('buildChannelIdentityMetadata classifies La 2 as TDT and canonical la_2', () => {
  const result = buildChannelIdentityMetadata({
    name: 'LA 2',
    sourceId: 'LA2.es',
    country: 'España',
    countryCode: 'ES',
  });

  assert.equal(result.canonicalId, 'la_2');
  assert.equal(result.inferredType, 'TDT');
  assert.equal(result.sortOrder, 1);
  assert.ok(result.aliases.includes('la_2'));
  assert.ok(result.aliases.includes('la2'));
});

test('buildChannelIdentityMetadata strips channel resolution suffixes for canonical matching', () => {
  const result = buildChannelIdentityMetadata({
    name: 'La 1 HD',
    sourceId: 'La 1 HD',
    country: 'España',
    countryCode: 'ES',
  });

  assert.equal(result.canonicalId, 'la_1');
  assert.ok(result.aliases.includes('la_1'));
});

test('buildChannelIdentityMetadata maps TDTChannels aliases to canonical TDT channels', () => {
  const la2 = buildChannelIdentityMetadata({
    name: 'La2.TV',
    sourceId: 'La2_CAN.TV',
    country: 'España',
    countryCode: 'ES',
  });
  const cuatro = buildChannelIdentityMetadata({
    name: 'Cuatro.TV',
    sourceId: 'Cuatro.TV',
    country: 'España',
    countryCode: 'ES',
  });

  assert.equal(la2.canonicalId, 'la_2');
  assert.equal(cuatro.canonicalId, 'cuatro');
});

test('buildChannelIdentityMetadata resolves representative pay-TV aliases canonically', () => {
  const tcm = buildChannelIdentityMetadata({ name: 'TCM HD', sourceId: 'tcm.es' });
  const axn = buildChannelIdentityMetadata({ name: 'AXN', sourceId: 'axn.es' });
  const hits = buildChannelIdentityMetadata({ name: 'M+ Hits', sourceId: 'movistar-hits' });

  assert.equal(tcm.canonicalId, 'tcm');
  assert.equal(tcm.inferredGroup, 'cable');
  assert.equal(axn.canonicalId, 'axn');
  assert.equal(axn.inferredGroup, 'cable');
  assert.equal(hits.canonicalId, 'movistar_hits');
  assert.equal(hits.inferredGroup, 'movistar');
  assert.equal(
    inferChannelGroup({ name: 'M+ Estrenos', type: 'OTT' }),
    'movistar'
  );
});

test('canonical channel resolver keeps paid-channel identities exact and handles Movistar user aliases', () => {
  assert.equal(resolveCanonicalChannelId('TCM HD'), 'tcm');
  assert.equal(resolveCanonicalChannelId('AXN'), 'axn');
  assert.equal(resolveCanonicalChannelId('AXN Movies'), 'axn_movies');
  assert.equal(resolveCanonicalChannelId('Movistar Plus Hits'), 'movistar_hits');
  assert.equal(resolveCanonicalChannelId('Movistar+ Hits'), 'movistar_hits');
  assert.equal(resolveCanonicalChannelId('M+ Acción'), 'movistar_accion');
  assert.equal(findCanonicalChannelInText('qué ver hoy en AXN'), 'axn');
  assert.equal(findCanonicalChannelInText('qué hay esta noche en AXN Movies'), 'axn_movies');
  assert.equal(findCanonicalChannelInText('qué ponen en AMC Crime'), 'amc_crime');
  assert.equal(findCanonicalChannelInText('qué ponen en AMC'), 'amc');
});

test('channel operational metadata keeps pay/operator identity orthogonal to sports facets', () => {
  const fixtures = [
    ['AXN', 'cable', 'pay', 'unknown'],
    ['Cosmo', 'cable', 'pay', 'unknown'],
    ['MTV', 'cable', 'pay', 'Paramount'],
  ] as const;

  fixtures.forEach(([name, distribution, access, operator]) => {
    const result = buildChannelIdentityMetadata({ name, sourceId: `${name}.es` });
    assert.equal(result.distribution, distribution);
    assert.equal(result.access, access);
    assert.equal(result.operator, operator);
  });

  const movistarSport = buildChannelIdentityMetadata({
    name: 'M+ Liga de Campeones',
    sourceId: 'M+LigadeCampeones.es',
  });
  assert.equal(movistarSport.inferredGroup, 'deporte');
  assert.equal(movistarSport.distribution, 'operator');
  assert.equal(movistarSport.access, 'pay');
  assert.equal(movistarSport.operator, 'Movistar Plus+');
  assert.ok(movistarSport.contentFacets.includes('sports'));

  const dazn = buildChannelIdentityMetadata({ name: 'DAZN F1', sourceId: 'DAZNF1.es' });
  assert.equal(dazn.inferredGroup, 'deporte');
  assert.equal(dazn.distribution, 'ott');
  assert.equal(dazn.access, 'pay');
  assert.equal(dazn.operator, 'DAZN');
  assert.ok(dazn.contentFacets.includes('sports'));
});

test('buildChannelIdentityMetadata collapses Discovery Max and Discovery into DMAX TDT', () => {
  const discoveryMax = buildChannelIdentityMetadata({
    name: 'Discovery Max',
    sourceId: 'DiscoveryMax.es',
    country: 'España',
    countryCode: 'ES',
  });
  const discovery = buildChannelIdentityMetadata({
    name: 'Discovery',
    sourceId: 'Discovery.es',
    country: 'España',
    countryCode: 'ES',
  });

  assert.equal(discoveryMax.canonicalId, 'dmax');
  assert.equal(discoveryMax.inferredType, 'TDT');
  assert.equal(discoveryMax.inferredGroup, 'tdt');
  assert.equal(discovery.canonicalId, 'dmax');
  assert.equal(discovery.inferredGroup, 'tdt');
});

test('buildProgramTitleAliases generates editorial fallbacks for Mañaneros 360', () => {
  const aliases = buildProgramTitleAliases('Mañaneros 360');

  assert.ok(aliases.includes('mananeros 360'));
  assert.ok(aliases.includes('mananeros'));
});

test('buildProgramBrandKey keeps Mañaneros 360 as stable canonical brand key', () => {
  assert.equal(buildProgramBrandKey('Mañaneros 360'), 'mananeros_360');
  assert.equal(buildProgramBrandKey('Mañaneros 360 T2 E141'), 'mananeros_360');
});

test('resolveProgramDisplayTitle extracts specific titles from movie containers', () => {
  assert.equal(resolveProgramDisplayTitle('Cine', 'Morbius'), 'Morbius');
  assert.equal(resolveProgramDisplayTitle('EL BLOCKBUSTER: MORBIUS'), 'MORBIUS');
  assert.equal(
    resolveProgramDisplayTitle('El Western De La 2 Repoker de bribones'),
    'Repoker de bribones'
  );
  assert.equal(isGenericMovieTitle('Historia de nuestro cine'), true);
});

test('buildTvReadAiringId scopes overlapping airings by viewDate', () => {
  const start = new Date('2026-03-19T23:55:00+01:00');

  assert.equal(
    buildTvReadAiringId({
      viewDate: '20260319',
      channelId: '13 TV',
      startTime: start,
      normalizedTitle: 'el cascabel',
    }),
    '20260319_13_tv_20260319235500'
  );
  assert.equal(
    buildTvReadAiringId({
      viewDate: '20260320',
      channelId: '13 TV',
      startTime: start,
      normalizedTitle: 'el cascabel',
    }),
    '20260320_13_tv_20260319235500'
  );
});

test('buildTvReadAiringId keeps both 02:30 airings of the 25-hour day apart and leaves every other id unchanged', () => {
  const id = (iso: string) => buildTvReadAiringId({ viewDate: '20261025', channelId: 'la_1', startTime: new Date(iso), normalizedTitle: 'x' });
  assert.equal(id('2026-10-25T00:30:00Z'), '20261025_la_1_20261025023000'); // 02:30 CEST: legacy id
  assert.equal(id('2026-10-25T01:30:00Z'), '20261025_la_1_20261025023000_dst2'); // 02:30 CET, second pass
  assert.equal(id('2026-10-25T02:30:00Z'), '20261025_la_1_20261025033000'); // 03:30 CET
  assert.equal(id('2026-03-29T01:30:00Z'), '20261025_la_1_20260329033000'); // spring-forward day: no repeated hour
});

test('inferChannelGroup classifies La 2 as TDT and DAZN F1 as deporte', () => {
  assert.equal(
    inferChannelGroup({ name: 'La 2', type: 'TDT', sourceId: 'LA2.es' }),
    'tdt'
  );
  assert.equal(
    inferChannelGroup({ name: '24 Horas', type: 'TDT', sourceId: '24Horas.es' }),
    'tdt'
  );
  assert.equal(
    inferChannelGroup({ name: 'FOX', type: 'Cable', sourceId: 'FOX.es' }),
    'cable'
  );
  assert.equal(
    inferChannelGroup({ name: 'Atrescine', type: 'TDT', sourceId: 'Atrescine' }),
    'online'
  );
  assert.equal(
    inferChannelGroup({ name: 'DAZN F1', type: 'SPORTS', sourceId: 'DAZNF1.es' }),
    'deporte'
  );
});

test('buildCatalogAssetSet keeps poster first and channel logo as fallback', () => {
  const assets = buildCatalogAssetSet({
    poster: 'https://img/poster.jpg',
    channelLogo: 'https://img/logo.png',
  });

  assert.equal(assets.primary?.url, 'https://img/poster.jpg');
  assert.equal(assets.poster?.source, 'epg_program_image');
  assert.equal(assets.channelLogo?.source, 'channel_icon');
  assert.equal(assets.fallbackChain.length, 2);
});

test('buildCatalogAssetSet keeps primary undefined when only a channel logo exists', () => {
  const assets = buildCatalogAssetSet({
    channelLogo: 'https://img/logo.png',
  });

  assert.equal(assets.primary, undefined);
  assert.equal(assets.poster, undefined);
  assert.equal(assets.channelLogo?.source, 'channel_icon');
});

test('inferEditorialCategory prefers news and shopping guardrails over noisy descriptions', () => {
  assert.equal(
    inferEditorialCategory(undefined, 'Telediario Matinal', 'Incluye información deportiva'),
    'Noticias'
  );
  assert.equal(
    inferEditorialCategory(undefined, 'Teletienda', 'Televenta de productos del hogar'),
    'Otros'
  );
  assert.equal(
    inferEditorialCategory(undefined, 'A que no me dejas, corazón', 'Telenovela mexicana'),
    'Series'
  );
  assert.equal(
    inferEditorialCategory(undefined, 'Le llamaban Calamidad', 'Cine,Oeste | 1972 | TP'),
    'Cine'
  );
  assert.equal(
    inferEditorialCategory(undefined, 'Mi familia vive en Alaska', 'Docuserie sobre supervivencia'),
    'Series'
  );
});

test('buildSearchTokens keeps La 2 and Mañaneros discoverable without diacritics', () => {
  const tokens = buildSearchTokens(['La 2', 'Mañaneros 360']);

  assert.ok(tokens.includes('la'));
  assert.ok(tokens.includes('2'));
  assert.ok(tokens.includes('mananeros'));
  assert.ok(tokens.includes('360'));
});

test('inferSportFacet derives canonical sports subfilters', () => {
  assert.equal(
    inferSportFacet({ title: 'Champions League', description: 'Fútbol en directo' }),
    'Fútbol'
  );
  assert.equal(
    inferSportFacet({ title: 'NBA', description: 'Baloncesto desde Estados Unidos' }),
    'Baloncesto'
  );
  assert.equal(
    inferSportFacet({ title: 'Gran Premio de Australia', description: 'Formula 1' }),
    'F1'
  );
  assert.equal(
    inferSportFacet({ title: 'ATP Masters 1000', description: 'Tenis' }),
    'Tenis'
  );
  assert.equal(
    inferSportFacet({ title: 'MotoGP Qatar', description: 'Motociclismo' }),
    'MotoGP'
  );
  assert.equal(
    inferSportFacet({ title: 'Tour de Francia', description: 'Ciclismo' }),
    'Más'
  );
  assert.equal(
    inferSportFacet({
      title: 'Valle Salvaje T3 E143',
      description:
        'Adriana descubre que su matrimonio fue concertado y será obligada a trabajar como criada.',
    }),
    undefined
  );
  assert.equal(
    inferSportFacet({
      title: 'Tres jóvenes de Tejas',
      description:
        'Película del oeste con reparto de Mitzi Gaynor y producción de Leonard Goldstein.',
    }),
    undefined
  );
  assert.equal(
    inferSportFacet({
      title: 'La Promesa',
      description: 'Serie dramática diaria ambientada en la España de 1913.',
      channelName: 'DAZN F1 4K',
    }),
    undefined
  );
});
