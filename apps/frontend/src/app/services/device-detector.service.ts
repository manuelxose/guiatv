/**
 * Device Detection Service - SSR Compatible con User-Agent
 * Detecta en servidor y transfiere estado al cliente
 */

import {
  Injectable,
  signal,
  computed,
  PLATFORM_ID,
  inject,
  DestroyRef,
  Inject,
  Optional,
  REQUEST,
  afterNextRender,
} from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { Request } from 'express';
import { TransferState, makeStateKey } from '@angular/core';
import { fromEvent } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export interface DeviceInfo {
  type: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  isTouchDevice: boolean;
}

/** Hardware class and orientation, kept apart: a phone is a phone in landscape, and a desktop window can be narrow. */
export interface DeviceClassification {
  type: DeviceType;
  orientation: 'portrait' | 'landscape';
  isTouchDevice: boolean;
}

export interface DeviceSignals {
  userAgent?: string;
  /** `navigator.userAgentData.mobile` (Client Hints), when the browser exposes it. */
  uaMobile?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  maxTouchPoints?: number;
  coarsePointer?: boolean;
}

const MOBILE_UA = /iphone|ipod|android.+mobile|windows phone|iemobile|blackberry|opera mini|mobile safari|\bmobile\b/i;
const TABLET_UA = /ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i;

/**
 * Device class from the strongest available signal: Client Hints, then the User-Agent, then touch + physical screen
 * size. Viewport width is deliberately not used for the class (it is the layout breakpoint, see `deviceType`), and
 * orientation comes from the viewport (falling back to the screen), independently of the class.
 */
export function classifyDevice(signals: DeviceSignals): DeviceClassification {
  const ua = signals.userAgent || '';
  const touch = (signals.maxTouchPoints || 0) > 0 || signals.coarsePointer === true;
  const shortSide = Math.min(signals.screenWidth || 0, signals.screenHeight || 0);
  let type: DeviceType;
  if (signals.uaMobile === true) type = 'mobile';
  else if (/macintosh/i.test(ua) && (signals.maxTouchPoints || 0) > 1) type = 'tablet'; // iPadOS desktop-mode UA
  else if (TABLET_UA.test(ua)) type = 'tablet';
  else if (MOBILE_UA.test(ua)) type = 'mobile';
  else if (touch && signals.coarsePointer && shortSide > 0 && shortSide < 600) type = 'mobile';
  else if (touch && signals.coarsePointer && shortSide >= 600 && shortSide < 1100) type = 'tablet';
  else type = 'desktop';
  const w = signals.viewportWidth || signals.screenWidth || 0;
  const h = signals.viewportHeight || signals.screenHeight || 0;
  return { type, orientation: w > 0 && h > 0 && w > h ? 'landscape' : 'portrait', isTouchDevice: touch || type !== 'desktop' };
}

// Keys para TransferState
const DEVICE_INFO_KEY = makeStateKey<DeviceInfo>('deviceInfo');

@Injectable({
  providedIn: 'root',
})
export class DeviceDetectorService {
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);
  private transferState = inject(TransferState);

  // Request solo disponible en servidor
  private request = inject(REQUEST, { optional: true });

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly isServer = isPlatformServer(this.platformId);

  // Signals reactivos
  private readonly width = signal(1024);
  private readonly height = signal(768);
  private readonly _isTouchDevice = signal(false);
  // Inicialización
  private readonly initialized = signal(false);

  // Computed properties
  public readonly deviceType = computed<DeviceType>(() => {
    const w = this.width();
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  });

  public readonly isMobile = computed(() => this.deviceType() === 'mobile');
  public readonly isTablet = computed(() => this.deviceType() === 'tablet');
  public readonly isDesktop = computed(() => this.deviceType() === 'desktop');

  public readonly orientation = computed<'portrait' | 'landscape'>(() => {
    return this.width() < this.height() ? 'portrait' : 'landscape';
  });

  public readonly isTouchDevice = computed(() => this._isTouchDevice());

  public readonly deviceInfo = computed<DeviceInfo>(() => ({
    type: this.deviceType(),
    isMobile: this.isMobile(),
    isTablet: this.isTablet(),
    isDesktop: this.isDesktop(),
    width: this.width(),
    height: this.height(),
    orientation: this.orientation(),
    isTouchDevice: this.isTouchDevice(),
  }));

  constructor() {
    if (this.isServer) {
      this.detectDeviceOnServer();
    } else if (this.isBrowser) {
      this.initializeOnClient();
    }
  }

  /**
   * DETECCIÓN EN EL SERVIDOR usando User-Agent
   */
  private detectDeviceOnServer(): void {
    if (!this.request) {
      return;
    }

    const userAgent = this.request.headers['user-agent'] || '';

    // Detectar tipo de dispositivo por User-Agent
    const deviceInfo = this.parseUserAgent(userAgent);

    // Aplicar detección
    this.width.set(deviceInfo.width);
    this.height.set(deviceInfo.height);
    this._isTouchDevice.set(deviceInfo.isTouchDevice);

    // Guardar en TransferState para el cliente
    this.transferState.set(DEVICE_INFO_KEY, deviceInfo);

    // Marcar inicializado
    this.initialized.set(true);
  }

  /**
   * INICIALIZACIÓN EN EL CLIENTE
   * Lee desde TransferState o detecta manualmente
   */
  private initializeOnClient(): void {
    // 1. Intentar obtener info del servidor
    const serverDeviceInfo = this.transferState.get<DeviceInfo>(
      DEVICE_INFO_KEY,
      null
    );

    if (serverDeviceInfo) {
      // The server value is only an estimate from the User-Agent, and nginx caches SSR HTML per URL for every
      // device, so it may even belong to another visitor's device. Use it for the hydrating render (the DOM must
      // match the server HTML), then replace it with the real viewport right after the first render.
      this.applyDeviceInfo(serverDeviceInfo);
      this.transferState.remove(DEVICE_INFO_KEY);
      afterNextRender(() => this.detectDeviceOnClient());
    } else {
      this.detectDeviceOnClient();
    }

    // 2. Setup resize listener
    this.setupResizeListener();

    // Marcar inicializado (ya tenemos valores aplicados o listener listo)
    this.initialized.set(true);
  }

  /**
   * Detectar dispositivo en el cliente (fallback)
   */
  private detectDeviceOnClient(): void {
    if (typeof window === 'undefined') return;

    try {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isTouchDevice =
        'ontouchstart' in window || navigator.maxTouchPoints > 0;

      this.width.set(width);
      this.height.set(height);
      this._isTouchDevice.set(isTouchDevice);

      // Marcar inicializado
      this.initialized.set(true);
    } catch (error) {
      this.initialized.set(true);
    }
  }

  /**
   * Aplicar información de dispositivo
   */
  private applyDeviceInfo(info: DeviceInfo): void {
    this.width.set(info.width);
    this.height.set(info.height);
    this._isTouchDevice.set(info.isTouchDevice);
  }

  /**
   * Parser de User-Agent para detección de dispositivos
   */
  private parseUserAgent(userAgent: string): DeviceInfo {
    const ua = userAgent.toLowerCase();

    // Detectar móviles
    const mobileRegex =
      /mobile|android|iphone|ipod|phone|blackberry|opera mini|iemobile|windows phone/i;
    const isMobileUA = mobileRegex.test(ua);

    // Detectar tablets
    const tabletRegex = /tablet|ipad|playbook|silk|kindle/i;
    const isTabletUA = tabletRegex.test(ua) && !mobileRegex.test(ua);

    // Detectar touch
    const isTouchDevice = isMobileUA || isTabletUA;

    // Determinar dimensiones estimadas
    let width = 1920; // Desktop por defecto
    let height = 1080;

    if (isMobileUA) {
      // Móvil portrait
      width = 375;
      height = 667;

      // Detectar móviles específicos con pantallas más grandes
      if (
        ua.includes('iphone') &&
        (ua.includes('pro max') || ua.includes('plus'))
      ) {
        width = 428;
        height = 926;
      } else if (ua.includes('iphone')) {
        width = 390;
        height = 844;
      } else if (ua.includes('pixel')) {
        width = 412;
        height = 915;
      } else if (ua.includes('samsung') || ua.includes('galaxy')) {
        width = 360;
        height = 800;
      }
    } else if (isTabletUA) {
      // Tablet
      width = 768;
      height = 1024;

      if (ua.includes('ipad pro')) {
        width = 1024;
        height = 1366;
      }
    }

    const type: DeviceType = classifyDevice({ userAgent }).type;
    if (type === 'tablet' && isMobileUA) {
      width = 768;
      height = 1024;
    }

    return {
      type,
      isMobile: type === 'mobile',
      isTablet: type === 'tablet',
      isDesktop: type === 'desktop',
      width,
      height,
      orientation: width < height ? 'portrait' : 'landscape',
      isTouchDevice,
    };
  }

  /**
   * Setup resize listener (solo cliente)
   */
  private setupResizeListener(): void {
    if (!this.isBrowser || typeof window === 'undefined') return;

    try {
      fromEvent(window, 'resize')
        .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (typeof window !== 'undefined') {
            this.width.set(window.innerWidth);
            this.height.set(window.innerHeight);
          }
        });
    } catch (error) {
      void error;
    }
  }

  // Métodos públicos
  public getOptimalColumns(): number {
    const type = this.deviceType();
    switch (type) {
      case 'mobile':
        return 2;
      case 'tablet':
        return 3;
      case 'desktop':
        return 7;
      default:
        return 7;
    }
  }

  public getOptimalItemSize(): number {
    const type = this.deviceType();
    switch (type) {
      case 'mobile':
        return 68;
      case 'tablet':
        return 75;
      case 'desktop':
        return 80;
      default:
        return 75;
    }
  }

  public getOptimalPadding(): string {
    const type = this.deviceType();
    switch (type) {
      case 'mobile':
        return '0.5rem';
      case 'tablet':
        return '1rem';
      case 'desktop':
        return '1.5rem';
      default:
        return '1rem';
    }
  }

  public get isRunningInBrowser(): boolean {
    return this.isBrowser;
  }

  public isInitialized(): boolean {
    return this.initialized();
  }

  /** Real-browser classification for analytics (hardware class + current orientation). */
  public classifyCurrent(): DeviceClassification {
    if (!this.isBrowser || typeof window === 'undefined') {
      const info = this.deviceInfo();
      return { type: info.type, orientation: info.orientation, isTouchDevice: info.isTouchDevice };
    }
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    let coarse = false;
    try {
      coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    } catch {
      coarse = false;
    }
    return classifyDevice({
      userAgent: nav.userAgent,
      uaMobile: nav.userAgentData?.mobile,
      screenWidth: window.screen?.width,
      screenHeight: window.screen?.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      maxTouchPoints: nav.maxTouchPoints,
      coarsePointer: coarse,
    });
  }

  public forceDetection(): void {
    if (this.isBrowser) {
      this.detectDeviceOnClient();
      // Asegurar flag de inicialización
      this.initialized.set(true);
    }
  }
}
