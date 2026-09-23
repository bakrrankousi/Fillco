import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, ensureUser, PASSWORD, startApp, TestContext, uniq } from './helpers';

describe('authentication & sessions', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.close());

  it('rejects unauthenticated requests with a problem document', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/customers');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('keeps health public', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health');
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('logs in with an httpOnly session cookie and returns permissions', async () => {
    const email = `${uniq('sales')}@test.local`;
    await ensureUser(ctx.prisma, email, ['SALES']);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/fillco_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.roles).toEqual(['SALES']);
    expect(res.body.permissions).toContain('sales_order.confirm');
    expect(res.body.permissions).not.toContain('finance.view_costs');
    expect(res.body.csrfToken).toBeTruthy();
    // Only a hash of the token is stored.
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { user: { email } } });
    expect(cookie).not.toContain(session.tokenHash);
  });

  it('gives the same error for unknown users and wrong passwords', async () => {
    const email = `${uniq('u')}@test.local`;
    await ensureUser(ctx.prisma, email, ['VIEWER']);
    const server = ctx.app.getHttpServer();
    const wrong = await request(server).post('/api/v1/auth/login').send({ email, password: 'nope-nope-1' });
    const unknown = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@test.local', password: 'nope-nope-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.title).toBe(unknown.body.title);
  });

  it('locks the account after repeated failures and audits it', async () => {
    const email = `${uniq('lock')}@test.local`;
    const userId = await ensureUser(ctx.prisma, email, ['VIEWER']);
    const server = ctx.app.getHttpServer();
    for (let i = 0; i < 5; i++)
      await request(server).post('/api/v1/auth/login').send({ email, password: 'wrong-pass-1' });
    const res = await request(server).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.title).toMatch(/Too many failed attempts/);
    const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: userId } });
    expect(audit.map((a) => a.action)).toContain('login_locked');
  });

  it('requires the CSRF token on state-changing requests', async () => {
    const email = `${uniq('csrf')}@test.local`;
    await ensureUser(ctx.prisma, email, ['ADMIN']);
    const agent = request.agent(ctx.app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    const noToken = await agent
      .post('/api/v1/exchange-rates')
      .send({ rateDate: '2026-01-01', fromCurrency: 'GBP', toCurrency: 'USD', rate: '1.3' });
    expect(noToken.status).toBe(403);
    const me = await agent.get('/api/v1/auth/me');
    const ok = await agent
      .post('/api/v1/exchange-rates')
      .set('x-csrf-token', me.body.csrfToken)
      .send({ rateDate: '2026-01-01', fromCurrency: 'GBP', toCurrency: 'USD', rate: '1.3' });
    expect(ok.status).toBe(201);
  });

  it('logs out and revokes the session', async () => {
    const email = `${uniq('out')}@test.local`;
    await ensureUser(ctx.prisma, email, ['VIEWER']);
    const client = await Client.login(ctx.app, email);
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);
  });

  it('changes the password, validates strength and signs out other sessions', async () => {
    const email = `${uniq('pw')}@test.local`;
    await ensureUser(ctx.prisma, email, ['VIEWER']);
    const a = await Client.login(ctx.app, email);
    const b = await Client.login(ctx.app, email);
    expect(
      (await a.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' })).status,
    ).toBe(400);
    expect(
      (await a.post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'New-Password-99' }))
        .status,
    ).toBe(422);
    expect(
      (await a.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'New-Password-99' }))
        .status,
    ).toBe(204);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
    await Client.login(ctx.app, email, 'New-Password-99');
  });

  it('lets admins manage users; deactivation ends sessions', async () => {
    const adminEmail = `${uniq('adm')}@test.local`;
    await ensureUser(ctx.prisma, adminEmail, ['ADMIN']);
    const admin = await Client.login(ctx.app, adminEmail);
    const email = `${uniq('new')}@test.local`;
    const created = await admin.post('/users', {
      email,
      fullName: 'New Person',
      password: 'Initial-Pass-1',
      roleCodes: ['PURCHASING'],
    });
    expect(created.status).toBe(201);
    expect(created.body.roles).toEqual(['PURCHASING']);
    const user = await Client.login(ctx.app, email, 'Initial-Pass-1');
    expect(user.me.mustChangePassword).toBe(true);
    const updated = await admin.patch(`/users/${created.body.id}`, {
      isActive: false,
      version: created.body.version,
    });
    expect(updated.status).toBe(200);
    expect((await user.get('/auth/me')).status).toBe(401);
    // Stale version is rejected.
    expect((await admin.patch(`/users/${created.body.id}`, { isActive: true, version: 0 })).status).toBe(409);
  });
});
