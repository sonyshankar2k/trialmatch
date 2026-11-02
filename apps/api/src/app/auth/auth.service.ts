import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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

// Verifying against this when the email is unknown keeps the response time the
// same, so timing can't reveal which emails have accounts.
const DUMMY_HASH = argon2.hash('not-a-real-password');

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const passwordHash = await argon2.hash(input.password);
    try {
      const [user] = await this.db
        .insert(users)
        .values({
          email: input.email,
          displayName: input.displayName,
          passwordHash,
        })
        .returning();
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
    if (!user || !ok)
      throw new UnauthorizedException('Incorrect email or password.');
    return this.session(user);
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
  return { id: u.id, email: u.email, displayName: u.displayName };
}
