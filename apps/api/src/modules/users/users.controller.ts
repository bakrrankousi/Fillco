import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  type CreateUserInput,
  type RoleDto,
  type UpdateUserInput,
  type UserDto,
} from '@fillco/contracts';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermission('users.manage')
  list(@CurrentActor() actor: Actor): Promise<UserDto[]> {
    return this.users.list(actor);
  }

  @Get('users/:id')
  @RequirePermission('users.manage')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return this.users.get(actor, id);
  }

  @Post('users')
  @RequirePermission('users.manage')
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(createUserSchema)) body: CreateUserInput,
  ): Promise<UserDto> {
    return this.users.create(actor, body);
  }

  @Patch('users/:id')
  @RequirePermission('users.manage')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput,
  ): Promise<UserDto> {
    return this.users.update(actor, id, body);
  }

  @Post('users/:id/reset-password')
  @HttpCode(204)
  @RequirePermission('users.manage')
  resetPassword(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: { newPassword: string },
  ): Promise<void> {
    return this.users.resetPassword(actor, id, body.newPassword);
  }

  @Get('roles')
  @RequirePermission('roles.view', 'users.manage')
  roles(): Promise<RoleDto[]> {
    return this.users.roles();
  }
}
