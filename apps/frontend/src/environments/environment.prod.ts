export const environment = {
  production: true,
  API_BASE_URL: '/v2', // Same-origin API
  API_BLOG: '/v2/blog',
  SITE_URL: 'https://guiaprogramaciontv.com',
  GOOGLE_CLIENT_ID: '533857766582-hsp4fsrct6321117n68de3h4ckmqrmab.apps.googleusercontent.com',
  ai: {
    chatbotEnabled: true,
    maxMessagesPerSession: 50,
  },
  analytics: {
    // Fallback GA4 property; the server decides whether GA4 loads at all (ANALYTICS_GA4_ENABLED) and may override
    // the id (ANALYTICS_GA4_MEASUREMENT_ID). Never loaded before the visitor grants analytics consent.
    ga4MeasurementId: 'G-P6Z3BY2DVW',
  },
};
