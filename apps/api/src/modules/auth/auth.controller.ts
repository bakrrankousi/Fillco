import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
  type MeDto,
} from '@fillco/contracts';
import type { Request, Response } from 'express';
import { loadConfig, SESSION_COOKIE } from '../../config';
import { Actor, CurrentActor, Public } from '../../common/actor';
import { AppError } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';

/** Simple per-IP sliding window against password spraying (per API instance). */
const attempts = new Map<string, number[]>();
function rateLimit(ip: string, limit = 20, windowMs = 60_000): void {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  attempts.set(ip, recent);
  if (recent.length > limit)
    throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Wait a minute.');
}

@Controller('auth')
export class AuthController {
  private readonly config = loadConfig();

  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    const ip = req.ip ?? 'unknown';
    rateLimit(ip);
    const result = await this.auth.login(body.email, body.password, ip, req.headers['user-agent'] ?? null);
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    return result.me;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(actor);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentActor() actor: Actor): Promise<MeDto> {
    return this.auth.me(actor.userId, actor.csrfToken);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    return this.auth.changePassword(actor, body);
  }
}
