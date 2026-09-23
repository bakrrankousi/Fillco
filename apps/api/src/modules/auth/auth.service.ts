import { Injectable } from '@nestjs/common';
import type { ChangePasswordInput, MeDto, Permission, RoleCode } from '@fillco/contracts';
import { hashPassword } from '@fillco/db';
import { verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../../config';
import type { Actor } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { BusinessRuleError, UnauthorizedError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { hashToken } from '../../common/session.guard';

/** A valid argon2id hash of a random string, used to keep timing equal for unknown e-mails. */
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$3No97m2TprxmF4KwJWorwg$oS6vD/G6iSoKXv3HEWmUqJpmD7TLeas++Yg67Tx8ilU';

export interface LoginResult {
  token: string;
  expiresAt: Date;
  me: MeDto;
}

@Injectable()
export class AuthService {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip: string | null, userAgent: string | null): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const now = new Date();
    const invalid = () => new UnauthorizedError('Email or password is incorrect');

    if (!user) {
      await verify(DUMMY_HASH, password).catch(() => false);
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new UnauthorizedError('Too many failed attempts. Try again later or ask an administrator.');
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok || !user.isActive) {
      const attempts = user.failedLoginCount + 1;
      const lock = attempts >= this.config.LOGIN_MAX_ATTEMPTS;
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : attempts,
            lockedUntil: lock ? new Date(now.getTime() + this.config.LOGIN_LOCK_MINUTES * 60_000) : undefined,
          },
        });
        await this.audit.log(tx, null, {
          entityType: 'user',
          entityId: user.id,
          action: lock ? 'login_locked' : 'login_failed',
          details: { ip, reason: user.isActive ? 'bad_password' : 'inactive' },
        });
      });
      throw invalid();
    }

    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.config.SESSION_TTL_HOURS * 3_600_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: { userId: user.id, tokenHash: hashToken(token), csrfToken, expiresAt, ip, userAgent: userAgent?.slice(0, 300) },
      });
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
      await this.audit.log(tx, null, { entityType: 'user', entityId: user.id, action: 'login', details: { ip } });
    });
    return { token, expiresAt, me: await this.me(user.id, csrfToken) };
  }

  async logout(actor: Actor): Promise<void> {
    await this.prisma.session.update({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
  }

  async me(userId: string, csrfToken: string): Promise<MeDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { company: true, roles: { include: { role: { include: { permissions: true } } } } },
    });
    const permissions = new Set<string>();
    for (const ur of user.roles) for (const p of ur.role.permissions) permissions.add(p.permission);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles.map((r) => r.role.code as RoleCode),
      permissions: [...permissions].sort() as Permission[],
      mustChangePassword: user.mustChangePassword,
      company: {
        id: user.company.id,
        name: user.company.name,
        baseCurrency: user.company.baseCurrency,
        timezone: user.company.timezone,
      },
      csrfToken,
    };
  }

  async changePassword(actor: Actor, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await verify(user.passwordHash, input.currentPassword).catch(() => false))) {
      throw new BusinessRuleError('Current password is incorrect', 'BAD_PASSWORD', undefined, {
        currentPassword: ['Incorrect password'],
      });
    }
    if (input.currentPassword === input.newPassword) {
      throw new BusinessRuleError('Choose a different password', 'SAME_PASSWORD', undefined, {
        newPassword: ['Must differ from the current password'],
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, version: { increment: 1 } },
      });
      // Sign out every other session of this user.
      await tx.session.updateMany({
        where: { userId: user.id, id: { not: actor.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(tx, actor, { entityType: 'user', entityId: user.id, action: 'password_changed' });
    });
  }
}
