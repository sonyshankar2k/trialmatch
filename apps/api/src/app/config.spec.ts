import { validateEnv } from './config';

const base = { JWT_SECRET: 'x'.repeat(32) };

describe('validateEnv', () => {
  it('accepts a postgres URL and trims stray whitespace', () => {
    const env = validateEnv({
      ...base,
      DATABASE_URL: ' postgresql://u:p@host.neon.tech/db?sslmode=require\n',
    });
    expect(env.DATABASE_URL).toBe(
      'postgresql://u:p@host.neon.tech/db?sslmode=require',
    );
  });

  it('explains a DATABASE_URL pasted with quotes', () => {
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: '"postgresql://u:p@host/db"' }),
    ).toThrow(/DATABASE_URL: must be one line starting with postgres/);
  });

  it('explains a DATABASE_URL pasted with a comment or a second line', () => {
    expect(() =>
      validateEnv({
        ...base,
        DATABASE_URL: '# Postgres\npostgresql://u:p@host/db',
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
