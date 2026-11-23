import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/database';
import { users } from '../db/schema';

/**
 * Week 9: administrators only. The role is read from the database on each
 * request, so a change takes effect at once, without signing in again.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectDb() private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: { id: number } }>();
    const [user] = req.user
      ? await this.db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, req.user.id))
      : [];
    if (user?.role !== 'admin')
      throw new ForbiddenException('Only administrators can do this.');
    return true;
  }
}
