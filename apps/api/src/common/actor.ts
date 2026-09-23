import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, RoleCode } from '@fillco/contracts';
import type { Request } from 'express';
import { ForbiddenError, UnauthorizedError } from './errors';

/** The authenticated user performing a request. */
export interface Actor {
  userId: string;
  sessionId: string;
  companyId: string;
  email: string;
  fullName: string;
  roles: RoleCode[];
  permissions: ReadonlySet<Permission>;
  csrfToken: string;
  mustChangePassword: boolean;
  ip: string | null;
  requestId: string;
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function requirePermission(actor: Actor, permission: Permission, message?: string): void {
  if (!can(actor, permission)) throw new ForbiddenError(message);
}

export function canAny(actor: Actor, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

export interface ActorRequest extends Request {
  actor?: Actor;
  requestId?: string;
}

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<ActorRequest>();
  if (!req.actor) throw new UnauthorizedError();
  return req.actor;
});

export const PUBLIC_KEY = 'fillco:public';
/** Endpoint reachable without a session (login, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'fillco:permissions';
/** The user needs at least one of the listed permissions. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
