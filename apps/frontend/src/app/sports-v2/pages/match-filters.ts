import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { isDayKey } from '../domain/calendar';
import { Match } from '../domain/models';
import { SportsStore } from '../state/sports-store';

/**
 * Match-list filters that live in the URL (?competicion=…&seguidos=1&dia=YYYY-MM-DD), so a filtered
 * view survives reloads, shares and the back button. Call from a component constructor/field initialiser.
 */
export function useMatchFilters() {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const store = inject(SportsStore);
  const params = toSignal(route.queryParamMap, { initialValue: route.snapshot.queryParamMap });

  const competition = computed(() => {
    const slug = params().get('competicion');
    return slug && store.competition(slug) ? slug : null;
  });
  // Without followed teams the filter would only show an empty list, so it is ignored.
  const followedOnly = computed(() => params().get('seguidos') === '1' && store.followedTeamSlugs().length > 0);
  const day = computed(() => (isDayKey(params().get('dia')) ? params().get('dia') : null));

  const navigate = (queryParams: Record<string, string | null>) =>
    void router.navigate([], { relativeTo: route, queryParams, queryParamsHandling: 'merge' });

  return {
    competition,
    followedOnly,
    day,
    setCompetition: (slug: string | null) => navigate({ competicion: slug }),
    setFollowedOnly: (on: boolean) => navigate({ seguidos: on ? '1' : null }),
    reset: () => navigate({ competicion: null, seguidos: null }),
    setDay: (key: string | null) => navigate({ dia: key }),
    apply: (matches: readonly Match[]): readonly Match[] => {
      const c = competition();
      const mine = followedOnly();
      const teams = store.followedTeamSlugs();
      return matches.filter((m) => (!c || m.competitionSlug === c) && (!mine || teams.includes(m.homeSlug) || teams.includes(m.awaySlug)));
    },
    active: computed(() => !!competition() || followedOnly()),
  };
}
