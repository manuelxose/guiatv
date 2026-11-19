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
    // Keep the destination paired with the published container. The server controls activation.
    gtmContainerId: 'GTM-KBRSTHLS',
    ga4MeasurementId: 'G-2QLQW39ZGV',
  },
};
