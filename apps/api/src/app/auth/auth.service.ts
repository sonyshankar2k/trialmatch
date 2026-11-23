import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  User,
} from '@trialmatch/shared';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { InjectDb, pgErrorCode, PG_UNIQUE_VIOLATION } from '../db/database';
import type { Db } from '../db/database';
import { users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import type { Env } from '../config';

// Verifying against this when the email is unknown keeps the response time the
// same, so timing can't reveal which emails have accounts.
const DUMMY_HASH = argon2.hash('not-a-real-password');

@Injectable()
export class AuthService {
  private readonly admins: Set<string>;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.admins = new Set(config.get('ADMIN_EMAILS', { infer: true }));
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const passwordHash = await argon2.hash(input.password);
    try {
      const user = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            email: input.email,
            displayName: input.displayName,
            passwordHash,
            role: this.admins.has(input.email) ? 'admin' : 'coordinator',
          })
          .returning();
        await this.audit.record(tx, {
          action: 'auth.register',
          entityType: 'user',
          entityId: row.id,
          label: row.email,
          actorId: row.id,
        });
        return row;
      });
      return this.session(user);
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw err;
    }
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, input.email),
    });
    const ok = await argon2.verify(
      user?.passwordHash ?? (await DUMMY_HASH),
      input.password,
    );
    // Same message for "no such email" and "wrong password".
    if (!user || !ok) {
      // Recorded for spotting password guessing; the email typed is kept, the password never.
      await this.audit.record(this.db, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        label: input.email,
        actorId: null,
        details: { email: input.email },
      });
      throw new UnauthorizedException('Incorrect email or password.');
    }
    const signedIn = await this.db.transaction(async (tx) => {
      let row = user;
      // ADMIN_EMAILS promotes at sign-in; it never demotes.
      if (this.admins.has(user.email) && user.role !== 'admin')
        [row] = await tx
          .update(users)
          .set({ role: 'admin' })
          .where(eq(users.id, user.id))
          .returning();
      await this.audit.record(tx, {
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        label: user.email,
        actorId: user.id,
      });
      return row;
    });
    return this.session(signedIn);
  }

  async me(id: number): Promise<User> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user)
      throw new UnauthorizedException('Your account no longer exists.');
    return toUser(user);
  }

  private async session(
    user: typeof users.$inferSelect,
  ): Promise<AuthResponse> {
    const accessToken = await this.jwt.signAsync({
      sub: String(user.id),
      email: user.email,
    });
    return { accessToken, user: toUser(user) };
  }
}

function toUser(u: typeof users.$inferSelect): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
  };
}
