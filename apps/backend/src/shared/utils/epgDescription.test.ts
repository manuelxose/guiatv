import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEpgDescription } from './epgDescription';

// Live examples from the M11-A programme-page run (artifacts/m11a/programme-pages.json).
test('EPG filler descriptions become absent, genre prefixes are dropped, real text is kept', () => {
  assert.equal(cleanEpgDescription('sin descripción.'), undefined);
  assert.equal(cleanEpgDescription('Programación Alacantí TV.'), undefined);
  assert.equal(cleanEpgDescription('(Documental,Otros) Una familia de osos.'), 'Una familia de osos.');
  assert.equal(cleanEpgDescription('(Películas Eróticas) Texto.'), 'Texto.');
  assert.equal(cleanEpgDescription('(Cine,Ciencia Ficción,Drama,Acción) Texto.'), 'Texto.');
  assert.equal(cleanEpgDescription('(25) Capítulo veinticinco.'), '(25) Capítulo veinticinco.');
  assert.equal(cleanEpgDescription('(voz en off) Un narrador cuenta.'), '(voz en off) Un narrador cuenta.');
  assert.equal(cleanEpgDescription('Programación especial por el aniversario de la cadena, con invitados y actuaciones.'),
    'Programación especial por el aniversario de la cadena, con invitados y actuaciones.');
  assert.equal(cleanEpgDescription('(Documental,Otros)'), undefined);
  assert.equal(cleanEpgDescription(undefined), undefined);
});
