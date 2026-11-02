import assert from 'node:assert/strict';
import test from 'node:test';
import { programDetailPath, slugify, slugifyTitle } from './detailPath';

test('programDetailPath uses the known airing id without guessing public work slugs', () => {
  assert.equal(programDetailPath('friends-slot'), '/contenido/program:friends-slot');
  assert.equal(programDetailPath('jurassic-slot'), '/contenido/program:jurassic-slot');
  assert.equal(programDetailPath('unsafe/id?#'), '/contenido/program:unsafe%2Fid%3F%23');
});

// M10-D: an EPG row whose title is an object (some feeds send a structured node) stringified to "[object Object]"
// and published the indexable page /programas/object-object, with "[object Object]" as its title and H1.
test('a title that stringifies to [object Object] is no title, so it never becomes a slug', () => {
  for (const notATitle of [{}, { _: 'Rosario desde Lourdes' }, new Map()]) {
    assert.equal(slugifyTitle(notATitle as unknown as string), 'sin-titulo');
    assert.equal(slugify(notATitle as unknown as string), 'sin-titulo');
  }
  assert.equal(slugifyTitle(null as unknown as string), 'sin-titulo');
  assert.equal(slugifyTitle(undefined as unknown as string), 'sin-titulo');
  assert.equal(slugifyTitle(''), 'sin-titulo');
  assert.equal(slugifyTitle([] as unknown as string), 'sin-titulo');
  // Only that shape is rejected: anything that already stringifies to a usable title keeps the slug its page
  // resolves under, so no working programme URL leaves the sitemap or loses its internal links.
  assert.equal(slugifyTitle(['Telediario 2'] as unknown as string), 'telediario-2');
  assert.equal(slugifyTitle('El último de la fila'), 'el-ultimo-de-la-fila');
  assert.equal(slugifyTitle(['El último de la fila'] as unknown as string), 'el-ultimo-de-la-fila');
  assert.equal(slugifyTitle('Telediario 2'), 'telediario-2');
  assert.equal(slugifyTitle(2 as unknown as string), '2');
});
