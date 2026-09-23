import { runIntegrityChecks } from '@fillco/db';
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
  termId,
  uniq,
} from './helpers';

/**
 * The Phase 1 deal chain end to end through the HTTP API:
 * quotation → revision → sales order → credit check → purchase orders → allocations.
 */
describe('quotation → sales order → purchasing', () => {
  let ctx: TestContext;
  let sales: Client;
  let purchasing: Client;
  let finance: Client;
  let management: Client;
  let product: Awaited<ReturnType<typeof createHcsProduct>>;
  let supplierTr = '';
  let supplierCn = '';

  beforeAll(async () => {
    ctx = await startApp();
    const users = {
      sales: `${uniq('sales')}@test.local`,
      purchasing: `${uniq('purch')}@test.local`,
      finance: `${uniq('fin')}@test.local`,
      management: `${uniq('mgmt')}@test.local`,
    };
    await ensureUser(ctx.prisma, users.sales, ['SALES'], 'Sales Person');
    await ensureUser(ctx.prisma, users.purchasing, ['PURCHASING'], 'Buyer');
    await ensureUser(ctx.prisma, users.finance, ['FINANCE'], 'Credit Controller');
    await ensureUser(ctx.prisma, users.management, ['MANAGEMENT'], 'Manager');
    sales = await Client.login(ctx.app, users.sales);
    purchasing = await Client.login(ctx.app, users.purchasing);
    finance = await Client.login(ctx.app, users.finance);
    management = await Client.login(ctx.app, users.management);
    await ensureRates(management);
    product = await createHcsProduct(purchasing, ctx.prisma);
    supplierTr = (await createSupplier(purchasing, ctx.prisma, { countryCode: 'TR' })).id;
    supplierCn = (await createSupplier(purchasing, ctx.prisma, { countryCode: 'CN' })).id;
  });
  afterAll(async () => ctx.close());

  const newCustomer = async (overrides: Record<string, unknown> = {}) => {
    const c = await createCustomer(management, ctx.prisma, { salespersonId: sales.me.id, ...overrides });
    return c.id;
  };

  const orderBody = async (
    customerId: string,
    lines: { spec?: object; qty: string; price: string; uom?: string; discount?: string }[],
    extra: Record<string, unknown> = {},
  ) => ({
    customerId,
    orderDate: '2026-09-01',
    currency: 'USD',
    paymentTermId: await termId(ctx.prisma, 'NET60'),
    requestedShipmentDate: '2026-10-15',
    lines: lines.map((l) => ({
      productId: product.productId,
      attributes: l.spec ?? product.spec7,
      qty: l.qty,
      uom: l.uom ?? 'MT',
      unitPrice: l.price,
      discountPct: l.discount ?? '0',
    })),
    ...extra,
  });

  const confirm = async (client: Client, id: string, overrideReason?: string) => {
    const so = await client.get(`/sales-orders/${id}`);
    return client.post(`/sales-orders/${id}/confirm`, { version: so.body.version, overrideReason });
  };

  describe('quotations', () => {
    it('creates, revises, sends, accepts and converts with full history', async () => {
      const customerId = await newCustomer();
      const created = await sales.post('/quotations', {
        customerId,
        quotationDate: '2026-09-20',
        validUntil: '2099-12-31',
        currency: 'USD',
        incoterm: 'CFR',
        lines: [
          {
            productId: product.productId,
            attributes: product.spec7,
            qty: '48',
            uom: 'MT',
            unitPrice: '1180',
            estUnitCost: '1050',
          },
        ],
      });
      expect(created.status).toBe(201);
      expect(created.body.number).toMatch(/^QT-2026-\d{5}$/);
      expect(created.body.grandTotal).toBe('56640');
      // Sales cannot see or store estimated costs.
      expect(created.body.lines[0].estUnitCost).toBeNull();
      expect(created.body.lines[0].estMarginPct).toBeNull();

      const sent = await sales.post(`/quotations/${created.body.id}/send`);
      expect(sent.body.status).toBe('SENT');
      const editSent = await sales.put(`/quotations/${created.body.id}`, {
        customerId,
        quotationDate: '2026-09-20',
        validUntil: '2099-12-31',
        currency: 'USD',
        lines: [
          {
            productId: product.productId,
            attributes: product.spec7,
            qty: '50',
            uom: 'MT',
            unitPrice: '1180',
          },
        ],
        version: sent.body.version,
      });
      expect(editSent.status).toBe(422);
      expect(editSent.body.code).toBe('NOT_DRAFT');

      const rev2 = await sales.post(`/quotations/${created.body.id}/revise`);
      expect(rev2.body.revision).toBe(2);
      expect(rev2.body.number).toBe(created.body.number);
      expect(rev2.body.status).toBe('DRAFT');
      const old = await sales.get(`/quotations/${created.body.id}`);
      expect(old.body.status).toBe('SUPERSEDED');
      expect(rev2.body.revisions.map((r: { revision: number }) => r.revision)).toEqual([1, 2]);

      await sales.post(`/quotations/${rev2.body.id}/send`);
      const accepted = await sales.post(`/quotations/${rev2.body.id}/accept`, { note: 'Accepted by phone' });
      expect(accepted.body.status).toBe('ACCEPTED');
      const converted = await sales.post(`/quotations/${rev2.body.id}/convert`);
      expect(converted.status).toBe(201);
      const so = await sales.get(`/sales-orders/${converted.body.salesOrderId}`);
      expect(so.body.status).toBe('DRAFT');
      expect(so.body.quotation.code).toBe(created.body.number);
      expect(so.body.lines[0].description).toBe(created.body.lines[0].description);
      expect(so.body.grandTotal).toBe('56640');
      expect((await sales.get(`/quotations/${rev2.body.id}`)).body.status).toBe('CONVERTED');
      expect((await sales.post(`/quotations/${rev2.body.id}/convert`)).status).toBe(422);
    });

    it('shows margins to cost-authorized users', async () => {
      const customerId = await newCustomer();
      const created = await management.post('/quotations', {
        customerId,
        quotationDate: '2026-09-20',
        validUntil: '2099-12-31',
        currency: 'USD',
        lines: [
          {
            productId: product.productId,
            attributes: product.spec7,
            qty: '10',
            uom: 'MT',
            unitPrice: '1200',
            discountPct: '0',
            estUnitCost: '1020',
          },
        ],
      });
      expect(created.body.lines[0].estMarginPct).toBe('15');
    });

    it('deleting a draft revision restores the previous revision', async () => {
      const customerId = await newCustomer();
      const q = await sales.post('/quotations', {
        customerId,
        quotationDate: '2026-09-20',
        validUntil: '2099-12-31',
        currency: 'USD',
        lines: [
          { productId: product.productId, attributes: product.spec7, qty: '1', uom: 'MT', unitPrice: '1' },
        ],
      });
      await sales.post(`/quotations/${q.body.id}/send`);
      const rev = await sales.post(`/quotations/${q.body.id}/revise`);
      expect((await sales.delete(`/quotations/${rev.body.id}`)).status).toBe(204);
      expect((await sales.get(`/quotations/${q.body.id}`)).body.status).toBe('SENT');
    });
  });

  describe('sales orders', () => {
    it('computes totals, base currency and stores the original currency', async () => {
      const customerId = await newCustomer({ defaultCurrency: 'EUR', creditLimitCurrency: 'EUR' });
      const res = await sales.post(
        '/sales-orders',
        await orderBody(
          customerId,
          [
            { qty: '24.5', price: '1150' },
            { qty: '10000', uom: 'KG', price: '1.20', discount: '2.5', spec: product.spec15 },
          ],
          { currency: 'EUR' },
        ),
      );
      expect(res.status).toBe(201);
      const so = res.body;
      expect(so.number).toMatch(/^SO-2026-\d{5}$/);
      expect(so.currency).toBe('EUR');
      expect(so.lines[0].qtyBase).toBe('24500');
      expect(so.lines[0].lineTotal).toBe('28175');
      expect(so.lines[1].qtyBase).toBe('10000');
      expect(so.lines[1].lineTotal).toBe('11700');
      expect(so.subtotal).toBe('39875');
      expect(so.discountTotal).toBe('300');
      expect(so.fxRate).toBe('1.1');
      expect(so.grandTotalBase).toBe('43862.5');
      expect(so.displayStatus).toBe('DRAFT');
      expect(so.lines[0].tolerancePct).toBe('5');
    });

    it('refuses documents in a currency without an exchange rate', async () => {
      const customerId = await newCustomer();
      const res = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [{ qty: '1', price: '1' }], { currency: 'SAR', orderDate: '2020-01-01' }),
      );
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('MISSING_EXCHANGE_RATE');
    });

    it('confirms within the credit limit and snapshots the payment schedule', async () => {
      const customerId = await newCustomer({ paymentTermId: await termId(ctx.prisma, 'ADV30-BL70') });
      const created = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [{ qty: '50', price: '1200' }], {
          paymentTermId: await termId(ctx.prisma, 'ADV30-BL70'),
        }),
      );
      const preview = await sales.get(`/sales-orders/${created.body.id}/credit-check`);
      expect(preview.body).toMatchObject({
        result: 'PASS',
        availableBefore: '100000.00',
        newOrderValue: '60000.00',
        newOrderUnsecured: '42000.00',
        availableAfter: '58000.00',
      });
      const res = await confirm(sales, created.body.id);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CONFIRMED');
      expect(res.body.displayStatus).toBe('PURCHASE_REQUIRED');
      const [advance, balance] = res.body.paymentSchedule;
      expect(advance).toMatchObject({
        percent: '30',
        amount: '18000',
        triggerEvent: 'ORDER_CONFIRMATION',
        dueStatus: 'FIXED',
      });
      expect(balance).toMatchObject({
        percent: '70',
        amount: '42000',
        triggerEvent: 'BL_DATE',
        dueStatus: 'PENDING_EVENT',
        dueDate: null,
        estimatedDueDate: '2026-10-15',
      });
      expect(res.body.creditChecks[0].result).toBe('PASS');
      // Draft editing is closed after confirmation; deleting too.
      expect(
        (
          await sales.put(`/sales-orders/${created.body.id}`, {
            ...(await orderBody(customerId, [{ qty: '1', price: '1' }])),
            version: res.body.version,
          })
        ).status,
      ).toBe(422);
      expect((await sales.delete(`/sales-orders/${created.body.id}`)).status).toBe(422);
      const exposure = await sales.get(`/customers/${customerId}/exposure`);
      expect(exposure.body).toMatchObject({
        openOrders: '60000.00',
        exposure: '60000.00',
        availableCredit: '40000.00',
      });
    });

    it('matches the spec example: limit 100k, 60k outstanding, new 30k → 10k available', async () => {
      const customerId = await newCustomer();
      const first = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [{ qty: '50', price: '1200' }]),
      );
      await confirm(sales, first.body.id);
      const second = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [{ qty: '25', price: '1200' }]),
      );
      const preview = await sales.get(`/sales-orders/${second.body.id}/credit-check`);
      expect(preview.body).toMatchObject({
        result: 'PASS',
        exposure: '60000.00',
        newOrderValue: '30000.00',
        availableAfter: '10000.00',
      });
    });

    it('blocks orders over the limit until an authorized user overrides with a reason', async () => {
      const customerId = await newCustomer({ creditLimit: '50000' });
      const created = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [{ qty: '50', price: '1200' }]),
      );
      const refused = await confirm(sales, created.body.id);
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('CREDIT_CHECK_FAILED');
      expect(refused.body.data).toMatchObject({ result: 'WARN', excess: '10000.00', canOverride: false });
      // Sales has no override permission even with a reason.
      expect((await confirm(sales, created.body.id, 'Please')).status).toBe(403);
      // Finance overrides; the check and the approver are recorded.
      const overridden = await confirm(
        finance,
        created.body.id,
        'Guaranteed by parent company letter dated 2026-09-10',
      );
      expect(overridden.status).toBe(201);
      expect(overridden.body.status).toBe('CONFIRMED');
      const check = overridden.body.creditChecks[0];
      expect(check.result).toBe('WARN');
      expect(check.override).toMatchObject({
        reason: 'Guaranteed by parent company letter dated 2026-09-10',
      });
      expect(check.override.approvedBy.id).toBe(finance.me.id);
      // Failed attempts are kept too.
      expect(overridden.body.creditChecks.length).toBeGreaterThanOrEqual(2);
      const audit = await management.get(`/audit-logs?entityType=sales_order&entityId=${created.body.id}`);
      expect(audit.body.map((a: { action: string }) => a.action)).toEqual(
        expect.arrayContaining(['credit_override', 'confirm']),
      );
      // Finance can not confirm a passing order (that is the salesperson's job).
      const ok = await sales.post(
        '/sales-orders',
        await orderBody(await newCustomer(), [{ qty: '1', price: '100' }]),
      );
      expect((await confirm(finance, ok.body.id, 'x')).status).toBe(403);
    });

    it('blocks orders for customers on hold unless management overrides', async () => {
      const customerId = await newCustomer();
      const customer = await finance.get(`/customers/${customerId}`);
      await finance.patch(`/customers/${customerId}`, { status: 'ON_HOLD', version: customer.body.version });
      const created = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [{ qty: '1', price: '100' }]),
      );
      const refused = await confirm(sales, created.body.id);
      expect(refused.body.data.result).toBe('BLOCK');
      expect((await confirm(finance, created.body.id, 'ok')).status).toBe(403);
      expect(
        (await confirm(management, created.body.id, 'Director approval — shipment against prepayment'))
          .status,
      ).toBe(201);
    });

    it('cancelling a line recalculates the order total and schedule', async () => {
      const customerId = await newCustomer();
      const created = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [
          { qty: '10', price: '1000' },
          { qty: '5', price: '1000', spec: product.spec15 },
        ]),
      );
      const confirmed = await confirm(sales, created.body.id);
      const lineId = confirmed.body.lines[1].id;
      const res = await sales.post(`/sales-orders/${created.body.id}/lines/${lineId}/cancel`, {
        reason: 'Customer dropped 15D',
      });
      expect(res.status).toBe(201);
      expect(res.body.grandTotal).toBe('10000');
      expect(res.body.paymentSchedule[0].amount).toBe('10000');
      expect(res.body.lines[1].lineStatus).toBe('CANCELLED');
    });

    it('rejects stale versions', async () => {
      const customerId = await newCustomer();
      const created = await sales.post(
        '/sales-orders',
        await orderBody(customerId, [{ qty: '1', price: '100' }]),
      );
      const body = {
        ...(await orderBody(customerId, [{ qty: '2', price: '100' }])),
        version: created.body.version,
      };
      expect((await sales.put(`/sales-orders/${created.body.id}`, body)).status).toBe(200);
      const stale = await sales.put(`/sales-orders/${created.body.id}`, body);
      expect(stale.status).toBe(409);
    });
  });

  describe('purchasing and allocation', () => {
    it('one customer order bought from two suppliers; one PO serving two customer orders', async () => {
      const customerA = await newCustomer({ creditLimit: '500000' });
      const customerB = await newCustomer({ creditLimit: '500000' });
      const soA = (
        await sales.post('/sales-orders', await orderBody(customerA, [{ qty: '100', price: '1150' }]))
      ).body;
      const soB = (
        await sales.post('/sales-orders', await orderBody(customerB, [{ qty: '20', price: '1180' }]))
      ).body;
      await confirm(sales, soA.id);
      await confirm(sales, soB.id);

      // 40 MT of A from Turkey, back-to-back.
      const poTr = await purchasing.post('/purchase-orders/from-sales', {
        supplierId: supplierTr,
        poDate: '2026-09-02',
        currency: 'USD',
        expectedReadyDate: '2026-10-01',
        lines: [{ salesOrderLineId: soA.lines[0].id, qty: '40', uom: 'MT', unitPrice: '1000' }],
      });
      expect(poTr.status).toBe(201);
      expect(poTr.body.number).toMatch(/^PO-2026-\d{5}$/);
      expect(poTr.body.lines[0].allocatedQtyBase).toBe('40000');

      let a = (await sales.get(`/sales-orders/${soA.id}`)).body;
      expect(a.displayStatus).toBe('PURCHASING'); // allocated to a draft PO only
      expect(a.lines[0].remainingToPurchaseBase).toBe('60000');

      await purchasing.post(`/purchase-orders/${poTr.body.id}/transition`, {
        to: 'CONFIRMED',
        version: poTr.body.version,
        supplierRef: 'PI-778',
      });
      a = (await sales.get(`/sales-orders/${soA.id}`)).body;
      expect(a.displayStatus).toBe('PARTIALLY_PURCHASED');
      expect(a.purchasedPct).toBe('40');

      // One Chinese PO covers the remaining 60 MT of A and all 20 MT of B, with 5 MT spare stock.
      const poCn = await purchasing.post('/purchase-orders', {
        supplierId: supplierCn,
        poDate: '2026-09-03',
        currency: 'CNY',
        paymentTermId: await termId(ctx.prisma, 'SUP-30-70-LOAD'),
        expectedReadyDate: '2026-10-10',
        lines: [
          {
            productId: product.productId,
            attributes: product.spec7,
            qty: '85',
            uom: 'MT',
            unitPrice: '7000',
          },
        ],
      });
      expect(poCn.status).toBe(201);
      expect(poCn.body.grandTotal).toBe('595000');
      expect(poCn.body.grandTotalBase).toBe('83300');
      const poLine = poCn.body.lines[0].id;
      expect(
        (
          await purchasing.post('/allocations', {
            salesOrderLineId: soA.lines[0].id,
            purchaseOrderLineId: poLine,
            qty: '60',
            uom: 'MT',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await purchasing.post('/allocations', {
            salesOrderLineId: soB.lines[0].id,
            purchaseOrderLineId: poLine,
            qty: '20000',
            uom: 'KG',
          })
        ).status,
      ).toBe(201);

      // Over-allocation of the PO line (only 5 MT left) is refused.
      const customerC = await newCustomer({ creditLimit: '500000' });
      const soC = (
        await sales.post('/sales-orders', await orderBody(customerC, [{ qty: '10', price: '1150' }]))
      ).body;
      await confirm(sales, soC.id);
      const over = await purchasing.post('/allocations', {
        salesOrderLineId: soC.lines[0].id,
        purchaseOrderLineId: poLine,
        qty: '6',
        uom: 'MT',
      });
      expect(over.status).toBe(422);
      expect(over.body.title).toMatch(/only 5000\.0000 unallocated/);

      const poCnFresh = (await purchasing.get(`/purchase-orders/${poCn.body.id}`)).body;
      await purchasing.post(`/purchase-orders/${poCn.body.id}/transition`, {
        to: 'SENT',
        version: poCnFresh.version,
      });
      const sent = (await purchasing.get(`/purchase-orders/${poCn.body.id}`)).body;
      const confirmedCn = await purchasing.post(`/purchase-orders/${poCn.body.id}/transition`, {
        to: 'CONFIRMED',
        version: sent.version,
        confirmedReadyDate: '2026-10-12',
      });
      expect(confirmedCn.status).toBe(201);
      expect(confirmedCn.body.paymentSchedule.map((s: { amount: string }) => s.amount)).toEqual([
        '178500',
        '416500',
      ]);
      expect(confirmedCn.body.salesOrders.map((s: { id: string }) => s.id).sort()).toEqual(
        [soA.id, soB.id].sort(),
      );
      expect(confirmedCn.body.lines[0].unallocatedQtyBase).toBe('5000');

      a = (await sales.get(`/sales-orders/${soA.id}`)).body;
      expect(a.displayStatus).toBe('FULLY_PURCHASED');
      expect(a.purchaseOrders.map((p: { id: string }) => p.id).sort()).toEqual(
        [poTr.body.id, poCn.body.id].sort(),
      );
      // Sales sees no costs; management sees the estimated profit.
      expect(a.finance.purchaseCostBase).toBeNull();
      const mgmt = (await management.get(`/sales-orders/${soA.id}`)).body;
      // Cost: 40 MT × 1000 USD + 60 MT × 7000 CNY × 0.14 = 40,000 + 58,800 = 98,800; sales 115,000.
      expect(mgmt.finance.purchaseCostBase).toBe('98800');
      expect(mgmt.finance.estimatedGrossProfitBase).toBe('16200');
      expect(mgmt.finance.estimatedMarginPct).toBe('14.1');
      // The timeline tells the story in order.
      const summaries = mgmt.timeline.map((t: { eventType: string }) => t.eventType);
      expect(summaries).toEqual(
        expect.arrayContaining([
          'sales_order.created',
          'sales_order.confirmed',
          'allocation.created',
          'purchase_order.confirmed',
        ]),
      );

      // Awaiting purchase lists C but not A or B.
      const awaiting = (await purchasing.get('/sales-orders/awaiting-purchase')).body.map(
        (x: { salesOrder: { id: string } }) => x.salesOrder.id,
      );
      expect(awaiting).toContain(soC.id);
      expect(awaiting).not.toContain(soA.id);
      expect(awaiting).not.toContain(soB.id);

      // Cancelling the Turkish PO releases its allocation: A goes back to partially purchased.
      const trFresh = (await purchasing.get(`/purchase-orders/${poTr.body.id}`)).body;
      const noReason = await purchasing.post(`/purchase-orders/${poTr.body.id}/transition`, {
        to: 'CANCELLED',
        version: trFresh.version,
      });
      expect(noReason.status).toBe(422);
      await purchasing.post(`/purchase-orders/${poTr.body.id}/transition`, {
        to: 'CANCELLED',
        version: trFresh.version,
        reason: 'Supplier could not meet the date',
      });
      a = (await sales.get(`/sales-orders/${soA.id}`)).body;
      expect(a.displayStatus).toBe('PARTIALLY_PURCHASED');
      expect(a.lines[0].remainingToPurchaseBase).toBe('40000');

      // Reopen is refused while purchases exist; cancel releases them.
      const aVersion = a.version;
      expect(
        (await sales.post(`/sales-orders/${soA.id}/reopen`, { version: aVersion, reason: 'change' })).status,
      ).toBe(422);
      const cancelled = await sales.post(`/sales-orders/${soA.id}/cancel`, {
        version: aVersion,
        reason: 'Customer cancelled',
      });
      expect(cancelled.body.status).toBe('CANCELLED');
      const cnAfter = (await purchasing.get(`/purchase-orders/${poCn.body.id}`)).body;
      expect(cnAfter.lines[0].unallocatedQtyBase).toBe('65000');
    });

    it('requires a note to allocate a different specification', async () => {
      const customerId = await newCustomer();
      const so = (
        await sales.post('/sales-orders', await orderBody(customerId, [{ qty: '10', price: '1100' }]))
      ).body;
      await confirm(sales, so.id);
      const po = await purchasing.post('/purchase-orders', {
        supplierId: supplierTr,
        poDate: '2026-09-05',
        currency: 'USD',
        lines: [
          {
            productId: product.productId,
            attributes: product.spec15,
            qty: '10',
            uom: 'MT',
            unitPrice: '900',
          },
        ],
      });
      const refused = await purchasing.post('/allocations', {
        salesOrderLineId: so.lines[0].id,
        purchaseOrderLineId: po.body.lines[0].id,
        qty: '10',
        uom: 'MT',
      });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('SPEC_MISMATCH');
      const ok = await purchasing.post('/allocations', {
        salesOrderLineId: so.lines[0].id,
        purchaseOrderLineId: po.body.lines[0].id,
        qty: '10',
        uom: 'MT',
        substituteNote: 'Customer accepted 15D instead of 7D',
      });
      expect(ok.status).toBe(201);
      expect(ok.body.isSubstitute).toBe(true);
    });

    it('allows tolerance on allocation but not beyond it, and never below allocated qty on PO edits', async () => {
      const customerId = await newCustomer();
      const so = (
        await sales.post('/sales-orders', await orderBody(customerId, [{ qty: '20', price: '1100' }]))
      ).body;
      await confirm(sales, so.id);
      const po = await purchasing.post('/purchase-orders/from-sales', {
        supplierId: supplierTr,
        poDate: '2026-09-05',
        currency: 'USD',
        lines: [{ salesOrderLineId: so.lines[0].id, qty: '21', uom: 'MT', unitPrice: '950' }],
      });
      expect(po.status).toBe(201); // 21 MT within +5% tolerance of 20 MT
      const tooMuch = await purchasing.post('/purchase-orders/from-sales', {
        supplierId: supplierTr,
        poDate: '2026-09-05',
        currency: 'USD',
        lines: [{ salesOrderLineId: so.lines[0].id, qty: '0.5', uom: 'MT', unitPrice: '950' }],
      });
      expect(tooMuch.status).toBe(422);
      // Reducing the PO line below its allocation is refused.
      const edit = await purchasing.put(`/purchase-orders/${po.body.id}`, {
        supplierId: supplierTr,
        poDate: '2026-09-05',
        currency: 'USD',
        version: po.body.version,
        lines: [
          {
            id: po.body.lines[0].id,
            productId: product.productId,
            attributes: product.spec7,
            qty: '15',
            uom: 'MT',
            unitPrice: '950',
          },
        ],
      });
      expect(edit.status).toBe(422);
      // Allocation can be reduced, and removed with qty 0.
      const allocationId = po.body.lines[0].allocations[0].id;
      const reduced = await purchasing.patch(`/allocations/${allocationId}`, {
        qty: '15',
        uom: 'MT',
        reason: 'Split with stock',
      });
      expect(reduced.body.qtyBase).toBe('15000');
      const removed = await purchasing.patch(`/allocations/${allocationId}`, {
        qty: '0',
        uom: 'MT',
        reason: 'Re-sourcing',
      });
      expect(removed.status).toBe(200);
      expect((await sales.get(`/sales-orders/${so.id}`)).body.displayStatus).toBe('PURCHASE_REQUIRED');
    });

    it('serializes concurrent allocations so the PO line is never over-committed', async () => {
      const customerId = await newCustomer({ creditLimit: '900000' });
      const so1 = (
        await sales.post('/sales-orders', await orderBody(customerId, [{ qty: '30', price: '1100' }]))
      ).body;
      const so2 = (
        await sales.post('/sales-orders', await orderBody(customerId, [{ qty: '30', price: '1100' }]))
      ).body;
      await confirm(sales, so1.id);
      await confirm(sales, so2.id);
      const po = await purchasing.post('/purchase-orders', {
        supplierId: supplierCn,
        poDate: '2026-09-05',
        currency: 'USD',
        lines: [
          { productId: product.productId, attributes: product.spec7, qty: '40', uom: 'MT', unitPrice: '950' },
        ],
      });
      const [r1, r2] = await Promise.all([
        purchasing.post('/allocations', {
          salesOrderLineId: so1.lines[0].id,
          purchaseOrderLineId: po.body.lines[0].id,
          qty: '30',
          uom: 'MT',
        }),
        purchasing.post('/allocations', {
          salesOrderLineId: so2.lines[0].id,
          purchaseOrderLineId: po.body.lines[0].id,
          qty: '30',
          uom: 'MT',
        }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 422]);
      const after = (await purchasing.get(`/purchase-orders/${po.body.id}`)).body;
      expect(after.lines[0].allocatedQtyBase).toBe('30000');
    });

    it('the database itself refuses over-allocation and deleting confirmed orders', async () => {
      const customerId = await newCustomer();
      const so = (
        await sales.post('/sales-orders', await orderBody(customerId, [{ qty: '5', price: '1000' }]))
      ).body;
      await confirm(sales, so.id);
      const po = await purchasing.post('/purchase-orders', {
        supplierId: supplierCn,
        poDate: '2026-09-05',
        currency: 'USD',
        lines: [
          { productId: product.productId, attributes: product.spec7, qty: '50', uom: 'MT', unitPrice: '900' },
        ],
      });
      await expect(
        ctx.prisma.orderAllocation.create({
          data: {
            salesOrderLineId: so.lines[0].id,
            purchaseOrderLineId: po.body.lines[0].id,
            qtyBase: '9000',
          },
        }),
      ).rejects.toThrow(/over-allocated/);
      await expect(ctx.prisma.salesOrder.delete({ where: { id: so.id } })).rejects.toThrow(
        /Only draft records/,
      );
      await expect(ctx.prisma.auditLog.deleteMany({})).rejects.toThrow(/immutable/);
    });

    it('marks purchase orders past their ready date as delayed', async () => {
      const po = await purchasing.post('/purchase-orders', {
        supplierId: supplierTr,
        poDate: '2026-01-05',
        currency: 'USD',
        expectedReadyDate: '2026-02-01',
        lines: [
          { productId: product.productId, attributes: product.spec7, qty: '5', uom: 'MT', unitPrice: '900' },
        ],
      });
      expect(po.body.isDelayed).toBe(false); // drafts are never "delayed"
      const confirmed = await purchasing.post(`/purchase-orders/${po.body.id}/transition`, {
        to: 'CONFIRMED',
        version: po.body.version,
      });
      expect(confirmed.body.isDelayed).toBe(true);
      const delayed = await purchasing.get('/purchase-orders?delayed=true&pageSize=500');
      expect(delayed.body.items.map((p: { id: string }) => p.id)).toContain(po.body.id);
      const ready = await purchasing.post(`/purchase-orders/${po.body.id}/transition`, {
        to: 'READY',
        version: confirmed.body.version,
      });
      expect(ready.body.isDelayed).toBe(false);
      expect(
        ready.body.milestones.find((m: { milestone: string }) => m.milestone === 'READY').actualDate,
      ).toBeTruthy();
      expect(
        (
          await purchasing.post(`/purchase-orders/${po.body.id}/transition`, {
            to: 'DRAFT',
            version: ready.body.version,
          })
        ).status,
      ).toBe(422);
    });
  });

  describe('search, dashboard and integrity', () => {
    it('finds orders, customers and contacts by number, name and phone', async () => {
      const customer = await createCustomer(management, ctx.prisma, {
        companyName: `Searchable Mills ${uniq()}`,
        contacts: [{ name: 'Hassan Search', phone: '+20 111 222 3399', isPrimary: true }],
      });
      const so = (
        await management.post(
          '/sales-orders',
          await orderBody(customer.id, [{ qty: '1', price: '100' }], { customerPoRef: 'CUST-PO-5521' }),
        )
      ).body;
      const byNumber = (await management.get(`/search?q=${so.number}`)).body;
      expect(byNumber[0]).toMatchObject({ type: 'sales_order', id: so.id });
      expect(
        (await management.get('/search?q=CUST-PO-5521')).body.some((r: { id: string }) => r.id === so.id),
      ).toBe(true);
      expect(
        (await management.get('/search?q=222 3399')).body.some((r: { type: string }) => r.type === 'contact'),
      ).toBe(true);
      expect(
        (await management.get('/search?q=Searchable')).body.some((r: { id: string }) => r.id === customer.id),
      ).toBe(true);
      // Scoped: another salesperson's customer is invisible to sales.
      expect(
        (await sales.get('/search?q=Searchable')).body.some((r: { id: string }) => r.id === customer.id),
      ).toBe(false);
    });

    it('serves the dashboard with role-appropriate figures', async () => {
      const mgmt = (await management.get('/dashboard')).body;
      expect(mgmt.baseCurrency).toBe('USD');
      expect(mgmt.openSalesOrders.count).toBeGreaterThan(0);
      expect(mgmt.purchasesThisYearBase).not.toBeNull();
      expect(mgmt.salesByMonth).toHaveLength(12);
      const s = (await sales.get('/dashboard')).body;
      expect(s.purchasesThisYearBase).toBeNull();
      expect(s.openPurchaseOrders.valueBase).toBeNull();
    });

    it('leaves the database consistent', async () => {
      const results = await runIntegrityChecks(ctx.prisma);
      const failed = results.filter((r) => r.violations > 0);
      expect(
        failed,
        JSON.stringify(failed, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      ).toEqual([]);
    });
  });
});
