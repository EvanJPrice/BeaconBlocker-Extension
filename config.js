// config.js - Environment Configuration
// Toggle IS_DEV to switch between local development and production

var IS_DEV = false; // Set to true for local development

var BEACON_CONFIG = {
    BACKEND_URL: IS_DEV
        ? 'http://localhost:3000'
        : 'https://api.beaconblocker.com',

    DASHBOARD_URL: IS_DEV
        ? 'http://localhost:5173'
        : 'https://dashboard.beaconblocker.com',

    // Dashboard URLs for content script detection
    DASHBOARD_DOMAINS: IS_DEV
        ? ['localhost:5173', 'localhost:5174', 'localhost:5175', 'beaconblocker.vercel.app', 'chrome-test-dashboard.vercel.app', 'dashboard.beaconblocker.com']
        : ['beaconblocker.vercel.app', 'chrome-test-dashboard.vercel.app', 'dashboard.beaconblocker.com']
};
