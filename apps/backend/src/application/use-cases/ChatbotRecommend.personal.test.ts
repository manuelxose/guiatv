import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatbotRecommend } from './ChatbotRecommend';

// Pure helpers only: no repositories are needed, so the use case is built without its constructor.
const uc = Object.create(ChatbotRecommend.prototype) as {
  resolveRegionalChoice(community: string | undefined, optIn: boolean | 'unknown' | undefined): 'include' | 'never' | 'ask';
  buildFollowUpSuggestions(intent: object, latest: string, profile?: object): string[];
};

const intent = (patch: object = {}) => ({
  mode: 'tv_tonight',
  requestedTypes: ['series'],
  explicitGenres: [],
  explicitPlatforms: [],
  wantsFamily: false,
  wantsShort: false,
  wantsPrimeTime: false,
  negativeSignals: [],
  ...patch,
});

test('a saved community is used without asking; a "no" is never asked again', () => {
  assert.equal(uc.resolveRegionalChoice('Galicia', true), 'include');
  assert.equal(uc.resolveRegionalChoice('Galicia', 'unknown'), 'include');
  assert.equal(uc.resolveRegionalChoice('Galicia', false), 'never');
  assert.equal(uc.resolveRegionalChoice(undefined, false), 'never');
  assert.equal(uc.resolveRegionalChoice(undefined, 'unknown'), 'ask');
});

test('follow-ups start with questions built from the user profile', () => {
  const suggestions = uc.buildFollowUpSuggestions(intent(), '¿Qué series hay esta noche?', {
    platforms: ['Netflix'],
    references: ['Fleabag'],
    likedGenres: ['Drama'],
  });

  assert.deepEqual(suggestions.slice(0, 2), ['Algo parecido a Fleabag', '¿Y qué hay en Netflix?']);
  assert.equal(suggestions.length, 3);
});

test('without a profile the generic follow-ups stay', () => {
  const suggestions = uc.buildFollowUpSuggestions(intent(), '¿Qué series hay esta noche?');

  assert.equal(suggestions.length, 3);
  assert.ok(!suggestions.some((s) => s.startsWith('Algo parecido')));
});
