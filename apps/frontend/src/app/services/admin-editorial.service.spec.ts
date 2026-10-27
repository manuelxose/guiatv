import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { AdminEditorialService } from './admin-editorial.service';

interface Call { method: string; url: string; body?: unknown; options?: { headers?: HttpHeaders } }

function createService(response: unknown, calls: Call[]): AdminEditorialService {
  const http = {
    get: (url: string, options?: Call['options']) => { calls.push({ method: 'GET', url, options }); return of(response); },
    post: (url: string, body: unknown, options?: Call['options']) => { calls.push({ method: 'POST', url, body, options }); return of(response); },
  };
  TestBed.configureTestingModule({ providers: [AdminEditorialService, { provide: HttpClient, useValue: http }] });
  return TestBed.inject(AdminEditorialService);
}

describe('AdminEditorialService', () => {
  it('getOverview calls /admin/editorial/overview and unwraps data', async () => {
    const calls: Call[] = [];
    const data = { jobs: [], posts: [] };
    const service = createService({ success: true, data }, calls);

    expect(await firstValueFrom(service.getOverview())).toEqual(data as any);
    expect(calls[0].url).toMatch(/\/admin\/editorial\/overview$/);
  });

  it('getPost encodes the id', async () => {
    const calls: Call[] = [];
    const service = createService({ success: true, data: { post: { id: 'a/b' } } }, calls);

    const detail = await firstValueFrom(service.getPost('a/b'));

    expect(detail.post.id).toBe('a/b');
    expect(calls[0].url).toMatch(/\/admin\/editorial\/posts\/a%2Fb$/);
  });

  it('pause posts the reason and unwraps data.policy', async () => {
    const calls: Call[] = [];
    const service = createService({ success: true, data: { policy: { paused: true } } }, calls);

    const policy = await firstValueFrom(service.pause('fuentes caídas'));

    expect(policy.paused).toBeTrue();
    expect(calls[0].url).toMatch(/\/admin\/editorial\/policy\/pause$/);
    expect(calls[0].body).toEqual({ reason: 'fuentes caídas' });
  });

  it('resume sends the review key and reviewer as headers only', async () => {
    const calls: Call[] = [];
    const service = createService({ success: true, data: { policy: { paused: false } } }, calls);

    const policy = await firstValueFrom(service.resume('k3y', 'Ana'));

    expect(policy.paused).toBeFalse();
    expect(calls[0].url).toMatch(/\/admin\/editorial\/policy\/resume$/);
    expect(calls[0].body).toEqual({});
    expect(calls[0].options?.headers?.get('x-editorial-review-key')).toBe('k3y');
    expect(calls[0].options?.headers?.get('x-editorial-reviewer')).toBe('Ana');
  });

  it('setDailyLimit posts the number and sends the review key as a header only', async () => {
    const calls: Call[] = [];
    const service = createService({ success: true, data: { policy: { dailyLimit: 4 } } }, calls);

    const policy = await firstValueFrom(service.setDailyLimit(4, 'k3y', 'Ana'));

    expect(policy.dailyLimit).toBe(4);
    expect(calls[0].url).toMatch(/\/admin\/editorial\/policy\/daily-limit$/);
    expect(calls[0].body).toEqual({ dailyLimit: 4 });
    expect(calls[0].options?.headers?.get('x-editorial-review-key')).toBe('k3y');
  });
});
