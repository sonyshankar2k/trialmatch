import '../test/static-env'; // must come first: sets WEB_DIST_DIR before AppModule loads
import { useTestApp } from '../test/test-app';

describe('single-container deployment: the API also serves the React app', () => {
  const t = useTestApp();

  it('serves the app, its assets, and index.html for client-side routes', async () => {
    const home = await t.http().get('/').expect(200);
    expect(home.text).toContain('<div id="root">');
    const asset = await t.http().get('/assets/app.js').expect(200);
    expect(asset.headers['cache-control']).toContain('immutable'); // hashed build files
    expect(home.headers['cache-control']).toBe('no-cache'); // so new releases show up
    const deepLink = await t.http().get('/patients/42').expect(200);
    expect(deepLink.text).toContain('<div id="root">'); // React Router takes it from here
  });

  it('keeps /api for the API: JSON errors, never the HTML page', async () => {
    await t.http().get('/api/health').expect(200, { status: 'ok' });
    const missing = await t.http().get('/api/does-not-exist').expect(404);
    expect(missing.body).toMatchObject({ statusCode: 404 });
  });

  it('adds a request id to every response for tracing log lines', async () => {
    const res = await t
      .http()
      .get('/api/health')
      .set('X-Request-Id', 'abc-123')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('abc-123');
    const generated = await t.http().get('/api/health').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
