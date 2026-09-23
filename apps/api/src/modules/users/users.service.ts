import { Injectable } from '@nestjs/common';
import type {
  CreateUserInput,
  Permission,
  RoleCode,
  RoleDto,
  UpdateUserInput,
  UserDto,
} from '@fillco/contracts';
import { hashPassword, Prisma } from '@fillco/db';
import type { Actor } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { assertVersion, BusinessRuleError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ts, tsReq } from '../../common/serialize';

const include = { roles: { include: { role: true } } } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof include }>;

function toDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    isActive: u.isActive,
    roles: u.roles.map((r) => r.role.code as RoleCode),
    lastLoginAt: ts(u.lastLoginAt),
    createdAt: tsReq(u.createdAt),
    version: u.version,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor): Promise<UserDto[]> {
    const rows = await this.prisma.user.findMany({
      where: { companyId: actor.companyId },
      include,
      orderBy: { fullName: 'asc' },
    });
    return rows.map(toDto);
  }

  async get(actor: Actor, id: string): Promise<UserDto> {
    const u = await this.prisma.user.findFirst({ where: { id, companyId: actor.companyId }, include });
    if (!u) throw new NotFoundError('User', id);
    return toDto(u);
  }

  private async roleIds(codes: readonly string[]): Promise<string[]> {
    const roles = await this.prisma.role.findMany({ where: { code: { in: [...codes] } } });
    if (roles.length !== new Set(codes).size) throw new BusinessRuleError('Unknown role');
    return roles.map((r) => r.id);
  }

  async create(actor: Actor, input: CreateUserInput): Promise<UserDto> {
    const roleIds = await this.roleIds(input.roleCodes);
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.tx(async (tx) => {
      const u = await tx.user.create({
        data: {
          companyId: actor.companyId,
          email: input.email,
          fullName: input.fullName,
          phone: input.phone ?? null,
          isActive: input.isActive,
          passwordHash,
          mustChangePassword: true,
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'user',
        entityId: u.id,
        action: 'create',
        after: {
          email: u.email,
          fullName: u.fullName,
          isActive: u.isActive,
          roles: input.roleCodes.join(','),
        },
      });
      return u;
    });
    return toDto(user);
  }

  async update(actor: Actor, id: string, input: UpdateUserInput): Promise<UserDto> {
    const current = await this.prisma.user.findFirst({ where: { id, companyId: actor.companyId }, include });
    if (!current) throw new NotFoundError('User', id);
    assertVersion('User', current.version, input.version);
    if (id === actor.userId && input.isActive === false)
      throw new BusinessRuleError('You cannot deactivate yourself');
    if (
      id === actor.userId &&
      input.roleCodes &&
      !input.roleCodes.includes('ADMIN') &&
      actor.roles.includes('ADMIN')
    ) {
      throw new BusinessRuleError('You cannot remove your own Admin role');
    }
    const roleIds = input.roleCodes ? await this.roleIds(input.roleCodes) : undefined;
    const updated = await this.prisma.tx(async (tx) => {
      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      const u = await tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName,
          phone: input.phone,
          isActive: input.isActive,
          version: { increment: 1 },
        },
        include,
      });
      if (input.isActive === false) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.log(tx, actor, {
        entityType: 'user',
        entityId: id,
        action: 'update',
        before: {
          fullName: current.fullName,
          phone: current.phone,
          isActive: current.isActive,
          roles: current.roles
            .map((r) => r.role.code)
            .sort()
            .join(','),
        },
        after: {
          fullName: u.fullName,
          phone: u.phone,
          isActive: u.isActive,
          roles: u.roles
            .map((r) => r.role.code)
            .sort()
            .join(','),
        },
      });
      return u;
    });
    return toDto(updated);
  }

  async resetPassword(actor: Actor, id: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id, companyId: actor.companyId } });
    if (!user) throw new NotFoundError('User', id);
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(tx, actor, { entityType: 'user', entityId: id, action: 'password_reset' });
    });
  }

  async roles(): Promise<RoleDto[]> {
    const rows = await this.prisma.role.findMany({
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((p) => p.permission as Permission).sort(),
      userCount: r._count.users,
    }));
  }
}
