import type { Permission, RoleCode } from '@fillco/contracts';
import { randomUUID } from 'node:crypto';
import type { Actor } from './actor';
import type { PrismaService } from './prisma.service';

/**
 * Builds an Actor for a user without an HTTP session — used by the demo seed, background jobs
 * and tests. Permissions come from the user's roles exactly as for a signed-in request.
 */
export async function actorForUser(prisma: PrismaService, email: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  const permissions = new Set<Permission>();
  for (const ur of user.roles)
    for (const p of ur.role.permissions) permissions.add(p.permission as Permission);
  return {
    userId: user.id,
    sessionId: 'system',
    companyId: user.companyId,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles.map((r) => r.role.code as RoleCode),
    permissions,
    csrfToken: '',
    mustChangePassword: false,
    ip: null,
    requestId: randomUUID(),
  };
}
