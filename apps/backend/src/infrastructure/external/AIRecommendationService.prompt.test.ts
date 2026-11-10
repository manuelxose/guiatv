import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRecommendationService, ChatbotContext } from './AIRecommendationService';

const context = (patch: Partial<ChatbotContext> = {}): ChatbotContext =>
  ({
    userId: 'u1',
    userProfile: {
      name: 'Ana',
      favoriteGenres: ['Drama'],
      topRatedContent: [{ title: 'Fleabag', rating: 5, type: 'series' }, { title: 'Meh', rating: 2, type: 'movie' }],
      recentlyWatched: [{ title: 'Origen' }],
      preferredPlatforms: ['Netflix'],
      avgRating: 4,
    },
    assistantMemory: {
      likedGenres: [],
      dislikedGenres: ['Terror'],
      preferredPlatforms: [],
      avoidedPlatforms: ['Mitele'],
      preferredDurations: ['episodio'],
      preferredViewingContexts: ['pareja'],
      favoriteFranchisesOrTitles: ['Succession'],
      recentTopics: [],
      negativeSignals: ['sin realities'],
    },
    ...patch,
  }) as ChatbotContext;

// The AI profile tab edits these fields; the model must actually receive them.
test('the system prompt carries every profile and memory field the user can set', () => {
  const prompt = (new AIRecommendationService({ deepseekApiKey: 'test-key' }) as unknown as { buildSystemPrompt(c: ChatbotContext): string }).buildSystemPrompt(context());

  for (const expected of [
    'Géneros: Drama',
    'No le gusta: Terror',
    'Evitar: sin realities',
    'Plataformas: Netflix',
    'Plataformas evitadas: Mitele',
    'Lo ve: pareja',
    'Duración: episodios de 30–45 min',
    'Referencias: Succession',
    'Valoró alto: Fleabag',
    'Ya visto: Origen',
  ]) {
    assert.ok(prompt.includes(expected), `missing "${expected}"`);
  }
  assert.ok(!prompt.includes('Meh'), 'low-rated titles are not sent as favourites');
});

test('an empty memory adds no empty fields', () => {
  const prompt = (new AIRecommendationService({ deepseekApiKey: 'test-key' }) as unknown as { buildSystemPrompt(c: ChatbotContext): string }).buildSystemPrompt(
    context({ assistantMemory: undefined, userProfile: { name: 'Ana', favoriteGenres: [], topRatedContent: [], recentlyWatched: [], preferredPlatforms: [], avgRating: 0 } })
  );

  assert.match(prompt, /PERFIL: Usuario: Ana(\n|$)/);
});
