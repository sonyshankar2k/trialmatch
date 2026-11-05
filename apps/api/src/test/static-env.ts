// Imported first by static.spec.ts: serve a tiny "built web app" from a temp folder.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'trialmatch-web-'));
mkdirSync(join(dir, 'assets'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")');
process.env['WEB_DIST_DIR'] = dir;
