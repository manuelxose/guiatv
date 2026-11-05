import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminEditorialService } from '../../../../../services/admin-editorial.service';
import { AdminRejectedInboxComponent } from './admin-rejected-inbox.component';

const post = (over: Partial<{ id: string; reviewState: string; pipelineState: string; status: string }> = {}) => ({
  id: 'p1', slug: 'guia', title: 'Guía', status: 'draft', reviewState: 'unreviewed',
  reviewedBy: null, updatedAt: '2026-11-05T16:00:00Z', pipelineState: 'blocked', backend: null,
  signed: false, costUsd: 0, claims: { supported: 0, conflicting: 0, unverified: 0 }, sources: 0,
  criticVerdict: null, coverUrl: null, nextReviewAt: null, ...over,
});

describe('AdminRejectedInboxComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [AdminRejectedInboxComponent],
    providers: [{ provide: AdminEditorialService, useValue: { getOverview: () => of({ posts: [] }) } }],
  }));

  it('classifies rejected/blocked drafts and their retry eligibility', () => {
    const fixture = TestBed.createComponent(AdminRejectedInboxComponent);
    const c = fixture.componentInstance;
    expect(c.isRejected(post({ reviewState: 'rejected' }) as never)).toBeTrue();
    expect(c.isRejected(post({ pipelineState: 'blocked' }) as never)).toBeTrue();
    expect(c.isRejected(post({ pipelineState: 'requires-update' }) as never)).toBeTrue();
    expect(c.isRejected(post({ reviewState: 'unreviewed', pipelineState: 'verified' }) as never)).toBeFalse();

    expect(c.canRetry({ status: 'draft', pipelineState: 'blocked' })).toBeTrue();
    expect(c.canRetry({ status: 'draft', pipelineState: 'requires-update' })).toBeTrue();
    expect(c.canRetry({ status: 'draft', pipelineState: 'rejected' })).toBeFalse();
    expect(c.canRetry({ status: 'publish', pipelineState: 'blocked' })).toBeFalse();
  });

  it('explains eligibility and only lists rejected posts', () => {
    const fixture = TestBed.createComponent(AdminRejectedInboxComponent);
    const c = fixture.componentInstance;
    expect(c.eligibilityText(post({ status: 'draft', pipelineState: 'blocked' }) as never)).toContain('Elegible');
    expect(c.eligibilityText(post({ status: 'publish' }) as never)).toContain('no se puede reintentar');
    c.overview = { posts: [post({ id: 'p1', pipelineState: 'blocked' }), post({ id: 'p2', pipelineState: 'verified', reviewState: 'unreviewed' })] } as never;
    expect(c.rejectedPosts.map((p) => p.id)).toEqual(['p1']);
  });
});
