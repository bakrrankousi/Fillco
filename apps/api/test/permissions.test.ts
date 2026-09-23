import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createCustomer,
  createHcsProduct,
  createSupplier,
  ensureRates,
  ensureUser,
  startApp,
  TestContext,
  uniq,
} from './helpers';

/**
 * Permission matrix: each default role against representative endpoints.
 * 403 = forbidden by role; anything else (200/201/404/422) means the guard let it through.
 */
describe('role permissions', () => {
  let ctx: TestContext;
  const clients: Record<string, Client> = {};
  let customerId = '';
  let supplierId = '';
  let poId = '';

  beforeAll(async () => {
    ctx = await startApp();
    for (const role of [
      'ADMIN',
      'MANAGEMENT',
      'SALES',
      'PURCHASING',
      'LOGISTICS',
      'FINANCE',
      'VIEWER',
    ] as const) {
      const email = `${uniq(role.toLowerCase())}@test.local`;
      await ensureUser(ctx.prisma, email, [role], `${role} user`);
      clients[role] = await Client.login(ctx.app, email);
    }
    const admin = clients.ADMIN!;
    await ensureRates(admin);
    customerId = (await createCustomer(admin, ctx.prisma)).id;
    supplierId = (await createSupplier(admin, ctx.prisma)).id;
    const product = await createHcsProduct(admin, ctx.prisma);
    const po = await admin.post('/purchase-orders', {
      supplierId,
      poDate: '2026-09-01',
      currency: 'USD',
      lines: [
        { productId: product.productId, attributes: product.spec7, qty: '24', uom: 'MT', unitPrice: '1000' },
      ],
    });
    expect(po.status).toBe(201);
    poId = po.body.id;
  });
  afterAll(async () => ctx.close());

  const matrix: { name: string; call: (c: Client) => Promise<{ status: number }>; allowed: string[] }[] = [
    { name: 'list users', call: (c) => c.get('/users'), allowed: ['ADMIN'] },
    {
      name: 'view audit log',
      call: (c) => c.get('/audit-logs'),
      allowed: ['ADMIN', 'MANAGEMENT', 'FINANCE'],
    },
    {
      name: 'enter exchange rate',
      call: (c) =>
        c.post('/exchange-rates', {
          rateDate: '2026-02-02',
          fromCurrency: 'CHF',
          toCurrency: 'USD',
          rate: '1.1',
        }),
      allowed: ['ADMIN', 'MANAGEMENT', 'FINANCE'],
    },
    {
      name: 'list customers',
      call: (c) => c.get('/customers'),
      allowed: ['ADMIN', 'MANAGEMENT', 'SALES', 'PURCHASING', 'LOGISTICS', 'FINANCE', 'VIEWER'],
    },
    {
      name: 'create customer',
      call: (c) =>
        c.post('/customers', { companyName: `P ${uniq()}`, countryCode: 'JO', defaultCurrency: 'USD' }),
      allowed: ['ADMIN', 'MANAGEMENT', 'SALES'],
    },
    {
      name: 'create supplier',
      call: (c) =>
        c.post('/suppliers', { companyName: `P ${uniq()}`, countryCode: 'CN', defaultCurrency: 'USD' }),
      allowed: ['ADMIN', 'MANAGEMENT', 'PURCHASING'],
    },
    {
      name: 'create purchase order',
      call: (c) => c.post('/purchase-orders', {}),
      allowed: ['ADMIN', 'MANAGEMENT', 'PURCHASING'],
    },
    {
      name: 'create sales order',
      call: (c) => c.post('/sales-orders', {}),
      allowed: ['ADMIN', 'MANAGEMENT', 'SALES'],
    },
    {
      name: 'allocate',
      call: (c) => c.post('/allocations', {}),
      allowed: ['ADMIN', 'MANAGEMENT', 'PURCHASING'],
    },
    {
      name: 'view sales orders',
      call: (c) => c.get('/sales-orders'),
      allowed: ['ADMIN', 'MANAGEMENT', 'SALES', 'PURCHASING', 'LOGISTICS', 'FINANCE', 'VIEWER'],
    },
    {
      name: 'manage payment terms',
      call: (c) => c.post('/payment-terms', {}),
      allowed: ['ADMIN', 'MANAGEMENT'],
    },
    { name: 'edit company settings', call: (c) => c.patch('/settings/company', {}), allowed: ['ADMIN'] },
    {
      name: 'manage catalog',
      call: (c) => c.post('/catalog/attributes', {}),
      allowed: ['ADMIN', 'MANAGEMENT', 'PURCHASING'],
    },
  ];

  for (const row of matrix) {
    it(`${row.name}: allowed for ${row.allowed.join(', ')}`, async () => {
      for (const [role, client] of Object.entries(clients)) {
        const res = await row.call(client);
        if (row.allowed.includes(role)) expect(res.status, `${role} should be allowed`).not.toBe(403);
        else expect(res.status, `${role} should be forbidden`).toBe(403);
      }
    });
  }

  it('hides purchase prices from roles without finance.view_costs', async () => {
    const sales = await clients.SALES!.get(`/purchase-orders/${poId}`);
    expect(sales.status).toBe(200);
    expect(sales.body.grandTotal).toBeNull();
    expect(sales.body.lines[0].unitPrice).toBeNull();
    expect(sales.body.paymentSchedule).toBeNull();
    const viewerList = await clients.VIEWER!.get('/purchase-orders');
    expect(viewerList.body.items.find((p: { id: string }) => p.id === poId).grandTotal).toBeNull();
    const purchasing = await clients.PURCHASING!.get(`/purchase-orders/${poId}`);
    expect(purchasing.body.grandTotal).toBe('24000');
    expect(purchasing.body.lines[0].unitPrice).toBe('1000');
  });

  it('scopes salespeople to their own customers', async () => {
    const sales = clients.SALES!;
    const own = await createCustomer(sales, ctx.prisma, { creditLimit: '0' });
    const list = await sales.get('/customers?pageSize=500');
    const ids = list.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(customerId);
    expect((await sales.get(`/customers/${customerId}`)).status).toBe(404);
    // And cannot create orders for someone else's customer.
    const so = await sales.post('/sales-orders', {
      customerId,
      orderDate: '2026-09-01',
      currency: 'USD',
      lines: [{ productId: '00000000-0000-7000-8000-000000000000', qty: '1', uom: 'MT', unitPrice: '1' }],
    });
    expect(so.status).toBe(404);
  });

  it('hides supplier bank details from roles without supplier_bank.view', async () => {
    const res = await clients.VIEWER!.get(`/suppliers/${supplierId}`);
    expect(res.status).toBe(200);
    expect(res.body.bankAccounts).toBeNull();
    const finance = await clients.FINANCE!.get(`/suppliers/${supplierId}`);
    expect(finance.body.bankAccounts).toEqual([]);
  });

  it('only lets credit controllers change credit limits and holds', async () => {
    const sales = clients.SALES!;
    const own = await createCustomer(sales, ctx.prisma, { creditLimit: '0' });
    const current = await sales.get(`/customers/${own.id}`);
    const raise = await sales.patch(`/customers/${own.id}`, {
      creditLimit: '500000',
      version: current.body.version,
    });
    expect(raise.status).toBe(403);
    const hold = await sales.patch(`/customers/${own.id}`, {
      status: 'ON_HOLD',
      version: current.body.version,
    });
    expect(hold.status).toBe(403);
    const finance = await clients.FINANCE!.patch(`/customers/${own.id}`, {
      creditLimit: '50000',
      status: 'ON_HOLD',
      version: current.body.version,
    });
    expect(finance.status).toBe(200);
    expect(finance.body.creditLimit).toBe('50000.00');
    const createWithLimit = await sales.post('/customers', {
      companyName: `X ${uniq()}`,
      countryCode: 'EG',
      defaultCurrency: 'USD',
      creditLimit: '1000',
    });
    expect(createWithLimit.status).toBe(403);
  });

  it('rejects Excel export without export.data', async () => {
    const email = `${uniq('noexport')}@test.local`;
    const company = await ctx.prisma.company.findFirstOrThrow();
    const role = await ctx.prisma.role.create({
      data: {
        code: uniq('ROLE').toUpperCase(),
        name: 'No export',
        permissions: { create: [{ permission: 'customer.view' }, { permission: 'customer.view_all' }] },
      },
    });
    await ctx.prisma.user.create({
      data: {
        companyId: company.id,
        email,
        fullName: 'No export',
        passwordHash: (await ctx.prisma.user.findFirstOrThrow({ where: { email: clients.ADMIN!.me.email } }))
          .passwordHash,
        roles: { create: [{ roleId: role.id }] },
      },
    });
    const client = await Client.login(ctx.app, email);
    expect((await client.get('/customers?format=xlsx')).status).toBe(403);
    const admin = await clients.ADMIN!.get('/customers?format=xlsx');
    expect(admin.status).toBe(200);
    expect(admin.headers['content-type']).toContain('spreadsheetml');
  });
});
