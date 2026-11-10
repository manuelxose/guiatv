import { structuredDataForHead, withHeadingIds } from './post-detail.component';

describe('withHeadingIds (article contents list)', () => {
  it('gives each H2/H3 a readable id and lists them in order with their level', () => {
    const { html, toc } = withHeadingIds('<p>Intro</p><h2>Qué dice la <strong>Ley</strong></h2><h3>Grabar &amp; ver</h3>');

    expect(toc).toEqual([
      { id: 'que-dice-la-ley', label: 'Qué dice la Ley', level: 2 },
      { id: 'grabar-ver', label: 'Grabar & ver', level: 3 },
    ]);
    expect(html).toContain('<h2 id="que-dice-la-ley">');
    expect(html).toContain('<h3 id="grabar-ver">');
  });

  it('keeps an existing id and makes repeated titles unique', () => {
    const { toc } = withHeadingIds('<h2 id="propio">Uno</h2><h2>Resumen</h2><h2>Resumen</h2>');

    expect(toc.map((t) => t.id)).toEqual(['propio', 'resumen', 'resumen-2']);
  });

  it('ignores empty headings', () => {
    expect(withHeadingIds('<h2> </h2>').toc).toEqual([]);
  });
});

describe('structuredDataForHead (jsonLd supplied by an imported article)', () => {
  const article = { '@type': 'Article', headline: 'Título' };
  const faq = { '@type': 'FAQPage', mainEntity: [] };

  it('keeps the source schema as it arrived', () => {
    expect(structuredDataForHead([article, faq], false)).toEqual([article, faq]);
  });

  it('drops the source FAQPage when the FAQ block already emits one', () => {
    expect(structuredDataForHead([article, faq], true)).toEqual([article]);
  });
});
