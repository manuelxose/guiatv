import { BrowserContext } from '@playwright/test';

/**
 * Minimal backend mock for shell-only Admin journeys (sidebar/drawer/layout).
 * Deliberately answers every `/v2/**` call with a safe empty envelope except
 * `/user/profile` (needed for adminGuard + the header identity chip) — the
 * shell doesn't care about business data, and keeping this fixture light
 * keeps shell specs fast and independent of any one domain's mock shape.
 */
export const MOCK_ADMIN_PROFILE = {
  id: 'e2e-shell-admin-id',
  name: 'Playwright Shell Admin',
  username: 'playwright_shell_admin',
  email: 'e2e-shell-admin@example.test',
  avatar: '',
  bio: '',
  location: '',
  role: 'admin',
  favoriteGenres: [],
  preferredPlatforms: [],
  watchingNow: { title: '', mood: '', visibility: 'private' },
  privacy: {},
  notifications: {},
  stats: { followers: 0, following: 0, listsCreated: 0, ratings: 0 },
};

export async function mockAdminShellBackend(context: BrowserContext): Promise<void> {
  // index.html preloads channel icons from the backend's storage, which a fresh checkout does not have.
  await context.route('**/storage/channel_icons/**', (route) => route.fulfill({ status: 204 }));
  await context.route('**/v2/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET' && url.includes('/user/profile')) {
      return route.fulfill({ json: { success: true, data: { profile: MOCK_ADMIN_PROFILE } } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
}
