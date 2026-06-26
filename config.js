// Backend-URL. Op geo.harmsen.nl praat de browser direct met de Django-API
// op www.harmsen.nl. Apex (harmsen.nl) redirect 301 -> www; CORS-preflights
// volgen geen redirects, dus altijd direct naar de www-host. Lokaal kun je
// dit via een query-param overschrijven: ?backend=http://localhost:8000/api/geo
const PARAM = new URL(window.location.href).searchParams.get('backend');
const DEFAULT = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:8000/api/geo'
  : 'https://www.harmsen.nl/api/geo';

window.GEO_CONFIG = {
  BACKEND_URL: (PARAM || DEFAULT).replace(/\/+$/, ''),
  CONCURRENCY: 6,
  CONCURRENCY_PER_PROVIDER: 2,  // anti-Anthropic-429: max 2 calls tegelijk naar dezelfde provider
  RUN_TIMEOUT_MS: 30000,    // Heroku H12 grens
  RETRY_DELAY_MS: 3000,
};
