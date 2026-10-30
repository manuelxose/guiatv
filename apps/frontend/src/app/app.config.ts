/**
 * Configuración principal de la aplicación standalone con SOLID - ACTUALIZADA
 * Ubicación: src/app/app.config.ts
 */

import {
  ApplicationConfig,
  ErrorHandler,
  LOCALE_ID,
  mergeApplicationConfig,
  Provider,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
// Preserve interactions made before the client bundle finishes hydrating.
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

// Rutas de la aplicación
import { routes } from './app.routes';

// Configuración SOLID de providers - ACTUALIZADA
import { allProviders } from './config/providers.config';
import { authRefreshInterceptor } from './interceptors/auth-refresh.interceptor';
import { GlobalErrorHandlerService } from './services/core/global-error-handler.service';

// Environment para configuración condicional
import { environment } from '../environments/environment';

/**
 * Configuración principal de la aplicación con arquitectura SOLID COMPLETA
 */
// Spanish dates and numbers in every pipe ("19 de octubre de 2026", "7,5"), on the server and in the browser.
registerLocaleData(localeEs, 'es-ES');

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: 'es-ES' },
    // Providers básicos de Angular para standalone
    provideRouter(routes),
    // Fetch API es requerida para SSR moderno
    provideHttpClient(withFetch(), withInterceptors([authRefreshInterceptor])),
    // Must be present in both browser and server application configs so SSR
    // emits a hydratable tree and HTTP transfer-cache records. POST requests
    // are included so a read-shaped POST (e.g. `/v2/affiliate/resolve`, which
    // takes a context body) also transfers its SSR response instead of the
    // client silently refetching and flashing a loading state right after
    // hydration.
    provideClientHydration(withEventReplay(), withHttpTransferCacheOptions({ includePostRequests: true })),

    {
      provide: ErrorHandler,
      useClass: GlobalErrorHandlerService,
    },

    // Providers SOLID para toda la aplicación
    ...allProviders,

    // Providers condicionales según el entorno
    ...getEnvironmentProviders(environment),

    // Providers de validación en desarrollo
    ...getValidationProviders(environment),
  ],
};

export const browserAppConfig = mergeApplicationConfig(appConfig, {
  providers: [
    provideAnimations(),
  ],
});

/**
 * Providers específicos según el entorno
 */
function getEnvironmentProviders(env: any): Provider[] {
  const providers: Provider[] = [];

  if (env.production) {
    providers.push({
      provide: 'ENVIRONMENT_MODE',
      useValue: 'production',
    });
  } else {
    providers.push(
      { provide: 'ENVIRONMENT_MODE', useValue: 'development' },
      { provide: 'DEBUG_ENABLED', useValue: true }
    );
  }

  return providers;
}

/**
 * Providers de validación (solo en desarrollo)
 */
function getValidationProviders(env: any): Provider[] {
  if (env.production) {
    return [];
  }
  return [
    { provide: 'SOLID_VALIDATION', useValue: true },
  ];
}

/**
 * Función para exponer debug info en desarrollo
 */
if (!environment.production && typeof window !== 'undefined') {
  (window as any).SOLID_DEBUG = {
    providers: allProviders,
    environment: environment,
    getProviderCount: () => allProviders.length,
    getProviderTypes: () => {
      return allProviders.map((p) => {
        if (typeof p === 'function') return `Class: ${p.name}`;
        if (typeof p === 'object' && 'provide' in p) {
          return `Token: ${p.provide.toString()}`;
        }
        return 'Unknown provider type';
      });
    },
  };
}
