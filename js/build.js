// The build stamp compiled INTO the running bundle. Diagnostics compares this to
// the service-worker cache version: if they differ, the cache updated but this
// (older) code is still executing — the classic installed-PWA staleness trap,
// where "App build" looked current yet new content (e.g. seeded study guides)
// never ran. Keep this in lockstep with CACHE_VERSION in sw.js on every deploy.
export const APP_BUILD = 'guruji-v147';
