import { useTestApp } from '../../test/test-app';

describe('auth', () => {
  const t = useTestApp();

  it('registers, signs in and returns the current user', async () => {
    await t
      .http()
      .post('/api/auth/register')
      .send({
        email: ' Alice@Example.com ',
        displayName: 'Alice',
        password: 'correct-horse-battery',
      })
      .expect(201);

    const login = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'correct-horse-battery' })
      .expect(200);
    expect(login.body.user).toEqual({
      id: 1,
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    expect(login.body).not.toHaveProperty('user.passwordHash');

    const me = await t
      .http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('alice@example.com');
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    await t.signUp('bob@example.com');
    const wrongPassword = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: 'nope-nope-nope' })
      .expect(401);
    const unknownEmail = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'nope-nope-nope' })
      .expect(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('rejects a duplicate email with 409', async () => {
    await t.signUp('carol@example.com');
    const res = await t
      .http()
      .post('/api/auth/register')
      .send({
        email: 'CAROL@example.com',
        displayName: 'Carol',
        password: 'correct-horse-battery',
      })
      .expect(409);
    expect(res.body.message).toMatch(/already exists/);
  });

  it('returns field errors for invalid input', async () => {
    const res = await t
      .http()
      .post('/api/auth/register')
      .send({ email: 'not-an-email', displayName: '', password: 'short' })
      .expect(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual([
      'displayName',
      'email',
      'password',
    ]);
  });

  it('requires a valid token on protected routes', async () => {
    await t.http().get('/api/trials').expect(401);
    await t
      .http()
      .get('/api/trials')
      .set('Authorization', 'Bearer not.a.token')
      .expect(401);
    await t.http().get('/api/health').expect(200); // public
  });

  it('slows down repeated sign-in attempts with a clear 429', async () => {
    process.env['AUTH_RATE_LIMIT_PER_MINUTE'] = '3';
    try {
      // Earlier tests in this file already used some of this minute's attempts.
      const statuses: number[] = [];
      let last: { body: unknown } = { body: null };
      for (let i = 0; i < 5; i++) {
        last = await t
          .http()
          .post('/api/auth/login')
          .send({ email: 'x@example.com', password: 'nope-nope-nope' });
        statuses.push((last as unknown as { status: number }).status);
      }
      expect(statuses.at(-1)).toBe(429);
      expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
      expect(last.body).toEqual({
        statusCode: 429,
        message: 'Too many attempts. Wait a minute and try again.',
      });
    } finally {
      process.env['AUTH_RATE_LIMIT_PER_MINUTE'] = '1000';
    }
  });
});
