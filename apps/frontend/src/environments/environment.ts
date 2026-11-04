// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  API_BASE_URL: '/v2', // Same-origin; the development proxy selects the backend.
  API_BLOG: 'http://localhost:4000/blog',
  SITE_URL: 'http://localhost:4200',
  GOOGLE_CLIENT_ID: '533857766582-hsp4fsrct6321117n68de3h4ckmqrmab.apps.googleusercontent.com',
  ai: {
    chatbotEnabled: true,
    maxMessagesPerSession: 50,
  },
  analytics: {
    // Fallback GA4 property; the server decides whether GA4 loads at all (ANALYTICS_GA4_ENABLED) and may override
    // the id (ANALYTICS_GA4_MEASUREMENT_ID). Never loaded before the visitor grants analytics consent.
    ga4MeasurementId: '',
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
