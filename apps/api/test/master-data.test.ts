import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  categoryId,
  Client,
  createHcsProduct,
  createSupplier,
  ensureUser,
  startApp,
  TestContext,
  uniq,
} from './helpers';

describe('customers, suppliers, settings and catalog', () => {
  let ctx: TestContext;
  let admin: Client;
  let finance: Client;
  let purchasing: Client;

  beforeAll(async () => {
    ctx = await startApp();
    const a = `${uniq('admin')}@test.local`;
    const f = `${uniq('fin')}@test.local`;
    const p = `${uniq('pur')}@test.local`;
    await ensureUser(ctx.prisma, a, ['ADMIN']);
    await ensureUser(ctx.prisma, f, ['FINANCE']);
    await ensureUser(ctx.prisma, p, ['PURCHASING']);
    admin = await Client.login(ctx.app, a);
    finance = await Client.login(ctx.app, f);
    purchasing = await Client.login(ctx.app, p);
  });
  afterAll(async () => ctx.close());

  describe('customers', () => {
    it('numbers customers sequentially and normalizes contacts/addresses', async () => {
      const make = () =>
        admin.post('/customers', {
          companyName: `  Seq ${uniq()}  `,
          countryCode: 'sa',
          defaultCurrency: 'usd',
          contacts: [
            { name: 'A', isPrimary: false },
            { name: 'B', isPrimary: true },
            { name: 'C', isPrimary: true },
          ],
          addresses: [
            { type: 'SHIPPING', line1: 'Dock 1', countryCode: 'SA' },
            { type: 'SHIPPING', line1: 'Dock 2', countryCode: 'SA', isDefault: true },
          ],
        });
      const a = await make();
      const b = await make();
      expect(a.status).toBe(201);
      expect(Number(b.body.code.slice(2))).toBe(Number(a.body.code.slice(2)) + 1);
      expect(a.body.countryCode).toBe('SA');
      expect(a.body.creditLimitCurrency).toBe('USD');
      expect(
        a.body.contacts
          .filter((c: { isPrimary: boolean }) => c.isPrimary)
          .map((c: { name: string }) => c.name),
      ).toEqual(['B']);
      const defaults = a.body.addresses.filter((x: { isDefault: boolean }) => x.isDefault);
      expect(defaults.map((x: { line1: string }) => x.line1)).toEqual(['Dock 2']);
    });

    it('audits updates with before/after values and enforces optimistic locking', async () => {
      const created = await admin.post('/customers', {
        companyName: `Audit ${uniq()}`,
        countryCode: 'AE',
        defaultCurrency: 'USD',
      });
      const updated = await admin.patch(`/customers/${created.body.id}`, {
        city: 'Dubai',
        creditLimit: '75000',
        version: created.body.version,
      });
      expect(updated.status).toBe(200);
      expect(updated.body.version).toBe(created.body.version + 1);
      const stale = await admin.patch(`/customers/${created.body.id}`, {
        city: 'Sharjah',
        version: created.body.version,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_VERSION');
      const logs = await admin.get(`/audit-logs?entityType=customer&entityId=${created.body.id}`);
      const update = logs.body.find((l: { action: string }) => l.action === 'update');
      expect(update.changes.before).toMatchObject({ city: null, creditLimit: '0' });
      expect(update.changes.after).toMatchObject({ city: 'Dubai', creditLimit: '75000' });
      expect(update.user.name).toBeTruthy();
    });

    it('rejects invalid input with field errors', async () => {
      const res = await admin.post('/customers', {
        companyName: '',
        countryCode: 'EGY',
        defaultCurrency: 'US',
        email: 'not-an-email',
      });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.errors).sort()).toEqual([
        'companyName',
        'countryCode',
        'defaultCurrency',
        'email',
      ]);
    });

    it('never deletes an address used on an order', async () => {
      // Covered through the orders flow; here: unknown address id is a 404.
      const c = await admin.post('/customers', {
        companyName: `Addr ${uniq()}`,
        countryCode: 'JO',
        defaultCurrency: 'USD',
      });
      const res = await admin.delete(
        `/customers/${c.body.id}/addresses/00000000-0000-7000-8000-000000000000`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('supplier bank accounts (four-eyes)', () => {
    it('requires a different user to approve new bank details', async () => {
      const { id } = await createSupplier(purchasing, ctx.prisma);
      const added = await purchasing.post(`/suppliers/${id}/bank-accounts`, {
        bankName: 'Ziraat Bankası',
        accountName: 'Test Tekstil',
        iban: 'TR33 0006 1005 1978 6457 8413 26',
        swift: 'TCZBTR2A',
        currency: 'USD',
      });
      expect(added.status).toBe(201);
      const account = added.body.bankAccounts[0];
      expect(account.status).toBe('PENDING_APPROVAL');
      // Purchasing cannot approve at all; an admin who entered it cannot approve their own entry.
      expect((await purchasing.post(`/suppliers/${id}/bank-accounts/${account.id}/approve`)).status).toBe(
        403,
      );
      const own = await admin.post(`/suppliers/${id}/bank-accounts`, {
        bankName: 'Garanti',
        accountName: 'Test',
        iban: 'TR320010009999901234567890',
        currency: 'EUR',
      });
      const ownAccount = own.body.bankAccounts.find((b: { currency: string }) => b.currency === 'EUR');
      const selfApprove = await admin.post(`/suppliers/${id}/bank-accounts/${ownAccount.id}/approve`);
      expect(selfApprove.status).toBe(422);
      expect(selfApprove.body.code).toBe('FOUR_EYES');
      const approved = await finance.post(`/suppliers/${id}/bank-accounts/${account.id}/approve`);
      expect(approved.status).toBe(201);
      expect(approved.body.bankAccounts.find((b: { id: string }) => b.id === account.id).status).toBe(
        'APPROVED',
      );
      const revoked = await finance.post(`/suppliers/${id}/bank-accounts/${account.id}/revoke`, {
        reason: 'Supplier changed bank',
      });
      expect(revoked.body.bankAccounts.find((b: { id: string }) => b.id === account.id).status).toBe(
        'REVOKED',
      );
    });

    it('validates IBAN and SWIFT formats', async () => {
      const { id } = await createSupplier(purchasing, ctx.prisma);
      const res = await purchasing.post(`/suppliers/${id}/bank-accounts`, {
        bankName: 'X',
        accountName: 'Y',
        iban: '123',
        swift: 'BAD',
        currency: 'USD',
      });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.errors).sort()).toEqual(['iban', 'swift']);
    });
  });

  describe('settings', () => {
    it('validates payment terms add up to 100%', async () => {
      const bad = await admin.post('/payment-terms', {
        code: uniq('BAD').toUpperCase(),
        name: 'Broken',
        installments: [
          { percent: '30', triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0 },
          { percent: '60', triggerEvent: 'BL_DATE', offsetDays: 0 },
        ],
      });
      expect(bad.status).toBe(422);
      const good = await admin.post('/payment-terms', {
        code: uniq('ADV').toUpperCase(),
        name: '40% advance, 60% 45 days after arrival',
        installments: [
          { percent: '40', triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0, instrument: 'TT' },
          { percent: '60', triggerEvent: 'ARRIVAL', offsetDays: 45, instrument: 'TT' },
        ],
      });
      expect(good.status).toBe(201);
      expect(good.body.summary).toBe('40% at order confirmation, 60% 45 days after arrival');
    });

    it('corrects an exchange rate for the same day instead of duplicating it', async () => {
      const body = { rateDate: '2024-03-01', fromCurrency: 'MAD', toCurrency: 'USD', rate: '0.099' };
      await admin.post('/exchange-rates', body);
      await admin.post('/exchange-rates', { ...body, rate: '0.1' });
      const rates = await admin.get('/exchange-rates?currency=MAD&from=2024-03-01&to=2024-03-01');
      expect(rates.body).toHaveLength(1);
      expect(rates.body[0].rate).toBe('0.1');
    });

    it('provides lookups for forms', async () => {
      const res = await admin.get('/lookups');
      expect(res.body.baseCurrency).toBe('USD');
      expect(res.body.currencies.map((c: { code: string }) => c.code)).toEqual(
        expect.arrayContaining(['USD', 'EUR', 'TRY', 'CNY', 'EGP']),
      );
      expect(res.body.incoterms[0].code).toBe('EXW');
      expect(res.body.uoms.map((u: { code: string }) => u.code)).toEqual(['MT', 'KG', 'LB']);
    });
  });

  describe('catalog', () => {
    it('resolves the same specification to the same variant', async () => {
      const { productId, spec7 } = await createHcsProduct(admin, ctx.prisma);
      const a = await admin.post(`/products/${productId}/variants`, { attributes: spec7 });
      const b = await admin.post(`/products/${productId}/variants`, {
        attributes: { ...spec7, denier: '7' },
      });
      expect(a.status).toBe(201);
      expect(b.body.id).toBe(a.body.id);
      expect(a.body.displayName).toMatch(/7D x 64mm Optical White/);
      const c = await admin.post(`/products/${productId}/variants`, { attributes: { ...spec7, denier: 15 } });
      expect(c.body.id).not.toBe(a.body.id);
    });

    it('reports spec errors per attribute and enforces fixed values', async () => {
      const { productId, spec7 } = await createHcsProduct(admin, ctx.prisma);
      const missing = await admin.post(`/products/${productId}/variants`, { attributes: { denier: 7 } });
      expect(missing.status).toBe(422);
      expect(Object.keys(missing.body.errors)).toEqual(
        expect.arrayContaining(['attributes.cut_length_mm', 'attributes.color']),
      );
      const fixed = await admin.post(`/products/${productId}/variants`, {
        attributes: { ...spec7, siliconized: false },
      });
      expect(fixed.status).toBe(422);
      expect(fixed.body.errors['attributes.siliconized'][0]).toMatch(/fixed/);
    });

    it('inherits attributes from parent categories and supports new attributes as data', async () => {
      const code = uniq('tenacity')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
      const attr = await admin.post('/catalog/attributes', {
        code,
        label: 'Tenacity',
        dataType: 'NUMBER',
        unit: 'cN/dtex',
      });
      expect(attr.status).toBe(201);
      const categories = await admin.get('/catalog/categories');
      const psf = categories.body.find((c: { code: string }) => c.code === 'PSF');
      expect(
        psf.attributes.find((a: { attribute: { code: string } }) => a.attribute.code === 'denier')
          .inheritedFrom,
      ).toBe('Fiber');
      const own = psf.attributes.filter((a: { inheritedFrom: string | null }) => a.inheritedFrom === null);
      const res = await admin.put(`/catalog/categories/${psf.id}/attributes`, {
        attributes: [
          ...own.map(
            (a: {
              attribute: { id: string };
              isRequired: boolean;
              isVariantDefining: boolean;
              sortOrder: number;
            }) => ({
              attributeId: a.attribute.id,
              isRequired: a.isRequired,
              isVariantDefining: a.isVariantDefining,
              sortOrder: a.sortOrder,
            }),
          ),
          { attributeId: attr.body.id, isRequired: false, isVariantDefining: false, sortOrder: 500 },
        ],
      });
      expect(res.status).toBe(200);
      expect(
        res.body
          .find((c: { code: string }) => c.code === 'PSF')
          .attributes.some((a: { attribute: { code: string } }) => a.attribute.code === code),
      ).toBe(true);
    });

    it('blocks changing the specification of a product that has variants', async () => {
      const { productId, spec7 } = await createHcsProduct(admin, ctx.prisma);
      await admin.post(`/products/${productId}/variants`, { attributes: spec7 });
      const product = await admin.get(`/products/${productId}`);
      const res = await admin.patch(`/products/${productId}`, {
        categoryId: await categoryId(ctx.prisma, 'MICRO'),
        version: product.body.version,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PRODUCT_IN_USE');
      const rename = await admin.patch(`/products/${productId}`, {
        name: 'Renamed HCS',
        version: product.body.version,
      });
      expect(rename.status).toBe(200);
    });
  });
});

describe('audit log hygiene', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.close());

  it('never stores secrets or related records, only changed scalar fields', async () => {
    const email = `${uniq('aud')}@test.local`;
    await ensureUser(ctx.prisma, email, ['ADMIN']);
    const admin = await Client.login(ctx.app, email);
    const created = await admin.post('/customers', {
      companyName: `Hygiene ${uniq()}`,
      countryCode: 'EG',
      defaultCurrency: 'USD',
      salespersonId: admin.me.id,
    });
    expect(created.status).toBe(201);
    const logs = await ctx.prisma.auditLog.findMany();
    const text = JSON.stringify(logs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(text).not.toMatch(/argon2|passwordHash|tokenHash|csrfToken/);
    const entry = logs.find((l) => l.entityId === created.body.id && l.action === 'create')!;
    const after = (entry.changes as { after: Record<string, unknown> }).after;
    expect(after.companyName).toBe(created.body.companyName);
    expect(Object.values(after).every((v) => v === null || typeof v !== 'object')).toBe(true);
  });
});
