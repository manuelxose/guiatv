import { EditorialPolicyStatus } from '../../../../services/admin-editorial.service';
import { policyStateText } from './admin-editorial-section.component';

const BASE: EditorialPolicyStatus = {
  envEnabled: true,
  paused: false,
  activated: true,
  activatedAt: null,
  activatedBy: 'ana@guiatv.es',
  active: true,
  pausedAt: null,
  pausedBy: null,
  pausedReason: null,
  dailyLimit: 3,
  dailyLimitBy: null,
  dailyLimitRange: { recommended: 3, min: 1, max: 10 },
  approvalsLast24h: 0,
  signingKeyConfigured: true,
  liveProviders: [],
};

describe('policyStateText', () => {
  it('reports active publication', () => {
    expect(policyStateText(BASE)).toBe('Publicación automática: activa (activada por ana@guiatv.es). Sin aprobación humana por artículo.');
  });

  it('reports a switch that is on but not yet activated by an administrator', () => {
    expect(policyStateText({ ...BASE, activated: false, active: false, activatedBy: null })).toBe(
      'Publicación automática: disponible, pendiente de activación por un administrador'
    );
  });

  it('reports env-disabled publication', () => {
    expect(policyStateText({ ...BASE, envEnabled: false, active: false })).toBe(
      'Publicación automática: desactivada (variable de entorno)'
    );
  });

  it('reports who paused, when and why', () => {
    const text = policyStateText({
      ...BASE,
      paused: true,
      active: false,
      pausedBy: 'ana@guiatv.es',
      pausedAt: '2026-10-27T10:00:00.000Z',
      pausedReason: 'fuentes caídas',
    });
    expect(text).toContain('pausada por ana@guiatv.es el ');
    expect(text).toMatch(/: fuentes caídas$/);
  });

  it('mentions the env flag when paused and env is off', () => {
    const text = policyStateText({ ...BASE, envEnabled: false, paused: true, active: false, pausedBy: 'x' });
    expect(text).toBe('Publicación automática: pausada por x (además desactivada por variable de entorno)');
  });
});
