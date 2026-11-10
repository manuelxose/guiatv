import type { TvReadItemDTO } from '../api/models';
import type { AssistantMemorySnapshot } from '../interfaces/chatbot.interface';
import type { UserContentInteraction } from '../interfaces/user.interface';
import { genreAffinity, rankTonight, sameValue, smartPrompts, tasteSummary } from './taste-profile';

const memory = (patch: Partial<AssistantMemorySnapshot> = {}): AssistantMemorySnapshot =>
  ({
    likedGenres: [], dislikedGenres: [], preferredPlatforms: [], avoidedPlatforms: [], preferredDurations: [],
    preferredViewingContexts: [], favoriteFranchisesOrTitles: [], recentTopics: [], negativeSignals: [], ...patch,
  }) as AssistantMemorySnapshot;

const airing = (title: string, category: string, channelId = 'c1', genre?: string): TvReadItemDTO =>
  ({ program: { title, editorialCategory: category, genre }, channel: { id: channelId, name: channelId } }) as unknown as TvReadItemDTO;

describe('taste-profile', () => {
  it('matches the chat extractor short forms with the UI options', () => {
    expect(sameValue('pareja', 'En pareja')).toBeTrue();
    expect(sameValue('sin terror', 'Terror')).toBeTrue();
    expect(sameValue('sin realities', 'Realities')).toBeTrue();
    expect(sameValue('Drama', 'Comedia')).toBeFalse();
  });

  it('ranks picked genres and rated history, and drops disliked genres', () => {
    const history = [
      { genres: ['Comedia'], rating: 5, status: 'seen' },
      { genres: ['Comedia'], status: 'seen' },
      { genres: ['Terror'], status: 'seen' },
    ] as UserContentInteraction[];
    const result = genreAffinity(['Drama'], memory({ dislikedGenres: ['Terror'] }), history);

    expect(result.map((a) => a.genre)).toEqual(['Comedia', 'Drama']);
    expect(result[0].pct).toBe(100);
    expect(result[1].sources).toEqual(['lo elegiste']);
  });

  it('keeps tonight only what matches the viewer and never what they avoid', () => {
    const items = [
      airing('Partido', 'Deportes'),
      airing('Docu A', 'Documental', 'c2'),
      airing('Serie B', 'Series', 'c3'),
      airing('Noticias', 'Noticias', 'fav'),
      airing('Magacín', 'Entretenimiento'),
    ];
    const picks = rankTonight(items, { likedGenres: ['Documental', 'Drama'], avoid: ['Deportes'], favoriteChannelIds: ['fav'] });

    expect(picks.map((p) => p.item.program.title)).toEqual(['Docu A', 'Noticias', 'Serie B']);
    expect(picks[0].reason).toBe('Documental, de lo que te gusta');
    expect(picks[1].reason).toBe('En uno de tus canales');
    expect(picks[2].reason).toBe('Series, como te gustan');
  });

  it('writes one sentence per known fact and personal prompts', () => {
    const m = memory({ preferredViewingContexts: ['pareja'], favoriteFranchisesOrTitles: ['Fleabag'] });

    expect(tasteSummary(['Netflix'], [], m)).toEqual(['Sueles ver la tele en pareja.', 'Tienes Netflix.', 'Tus referencias: Fleabag.']);
    expect(tasteSummary([], [], null)).toEqual([]);
    expect(smartPrompts(['Netflix'], m, [])[0]).toBe('Algo parecido a Fleabag en Netflix');
  });
});
