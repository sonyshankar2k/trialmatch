import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  LoginSchema,
  RegisterSchema,
  type AuthResponse,
  type User,
} from '@trialmatch/shared';
import { createZodDto } from '../common/zod';
import { AuthService } from './auth.service';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { Public } from './public.decorator';

/** Read per request, so tests and CI can raise it with AUTH_RATE_LIMIT_PER_MINUTE. */
const authLimit = () => Number(process.env['AUTH_RATE_LIMIT_PER_MINUTE'] ?? 10);

class RegisterDto extends createZodDto(RegisterSchema) {}
class LoginDto extends createZodDto(LoginSchema) {}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } }) // slows down password guessing
  @Post('register')
  register(@Body() body: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(body);
  }

  @Public()
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() body: LoginDto): Promise<AuthResponse> {
    return this.auth.login(body);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user.id);
  }
}
