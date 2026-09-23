import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission, RoleCode } from '@fillco/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { CSRF_HEADER, SESSION_COOKIE } from '../config';
import { ActorRequest, PERMISSIONS_KEY, PUBLIC_KEY } from './actor';
import { ForbiddenError, UnauthorizedError } from './errors';
import { PrismaService } from './prisma.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Sessions are touched at most once per minute to avoid a write on every request. */
const TOUCH_INTERVAL_MS = 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Global guard: resolves the session cookie into an Actor, enforces CSRF on state-changing
 * requests (double-submit: header must equal the session's token), then checks permissions.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ActorRequest>();
    req.requestId ??= (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedError();

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: { include: { roles: { include: { role: { include: { permissions: true } } } } } },
      },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) {
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }
    if (!SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== session.csrfToken) {
      throw new ForbiddenError('Security token missing or invalid. Reload the page and try again.');
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    const permissions = new Set<Permission>();
    for (const ur of session.user.roles)
      for (const rp of ur.role.permissions) permissions.add(rp.permission as Permission);
    req.actor = {
      userId: session.user.id,
      sessionId: session.id,
      companyId: session.user.companyId,
      email: session.user.email,
      fullName: session.user.fullName,
      roles: session.user.roles.map((r) => r.role.code as RoleCode),
      permissions,
      csrfToken: session.csrfToken,
      mustChangePassword: session.user.mustChangePassword,
      ip: req.ip ?? null,
      requestId: req.requestId,
    };

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && required.length > 0 && !required.some((p) => permissions.has(p))) {
      throw new ForbiddenError();
    }
    return true;
  }
}
