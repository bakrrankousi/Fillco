import type { INestApplication } from '@nestjs/common';
import type { MeDto, RoleCode } from '@fillco/contracts';
import { hashPassword, PrismaClient } from '@fillco/db';
import request from 'supertest';
import { createApp } from '../src/app.factory';

export const PASSWORD = 'Test-Password-2026';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

export async function startApp(): Promise<TestContext> {
  const app = await createApp({ logger: false });
  await app.init();
  const prisma = new PrismaClient();
  return {
    app,
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

let counter = 0;
/** A unique suffix so test files can share one database without clashing. */
export function uniq(prefix = 't'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

/** Creates (or reuses) a user with the given roles. */
export async function ensureUser(
  prisma: PrismaClient,
  email: string,
  roles: RoleCode[],
  fullName = email,
): Promise<string> {
  const company = await prisma.company.findFirstOrThrow();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing.id;
  const roleRows = await prisma.role.findMany({ where: { code: { in: roles } } });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      email,
      fullName,
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
    },
  });
  return user.id;
}

/** A signed-in HTTP client that sends the session cookie and CSRF header automatically. */
export class Client {
  constructor(
    private readonly agent: ReturnType<typeof request.agent>,
    readonly me: MeDto,
  ) {}

  static async login(app: INestApplication, email: string, password = PASSWORD): Promise<Client> {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200)
      throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return new Client(agent, res.body as MeDto);
  }

  get(url: string) {
    return this.agent.get(`/api/v1${url}`);
  }

  post(url: string, body: unknown = {}) {
    return this.agent
      .post(`/api/v1${url}`)
      .set('x-csrf-token', this.me.csrfToken)
      .send(body as object);
  }

  put(url: string, body: unknown = {}) {
    return this.agent
      .put(`/api/v1${url}`)
      .set('x-csrf-token', this.me.csrfToken)
      .send(body as object);
  }

  patch(url: string, body: unknown = {}) {
    return this.agent
      .patch(`/api/v1${url}`)
      .set('x-csrf-token', this.me.csrfToken)
      .send(body as object);
  }

  delete(url: string) {
    return this.agent.delete(`/api/v1${url}`).set('x-csrf-token', this.me.csrfToken);
  }
}

/** Rates to USD for the test currencies, dated far enough back for any document date used in tests. */
export async function ensureRates(admin: Client): Promise<void> {
  for (const [cur, rate] of [
    ['EUR', '1.10'],
    ['TRY', '0.025'],
    ['CNY', '0.14'],
  ] as const) {
    const res = await admin.post('/exchange-rates', {
      rateDate: '2025-01-01',
      fromCurrency: cur,
      toCurrency: 'USD',
      rate,
    });
    if (res.status !== 201) throw new Error(`Rate setup failed: ${JSON.stringify(res.body)}`);
  }
}

export async function termId(prisma: PrismaClient, code: string): Promise<string> {
  return (await prisma.paymentTerm.findUniqueOrThrow({ where: { code } })).id;
}

export async function categoryId(prisma: PrismaClient, code: string): Promise<string> {
  return (await prisma.productCategory.findUniqueOrThrow({ where: { code } })).id;
}

/** Creates a PSF HCS product and returns its id plus a valid 7D spec. */
export async function createHcsProduct(admin: Client, prisma: PrismaClient) {
  const code = uniq('HCS').toUpperCase();
  const res = await admin.post('/products', {
    code,
    name: `PSF HCS ${code}`,
    categoryId: await categoryId(prisma, 'PSF'),
    defaultSalesUom: 'MT',
    fixedAttributes: { cross_section: 'HOLLOW_CONJUGATED', siliconized: true },
  });
  if (res.status !== 201) throw new Error(`Product setup failed: ${JSON.stringify(res.body)}`);
  return {
    productId: res.body.id as string,
    spec7: { denier: 7, cut_length_mm: 64, color: 'OPTICAL_WHITE', material: 'VIRGIN', grade: 'A' },
    spec15: { denier: 15, cut_length_mm: 64, color: 'OPTICAL_WHITE', material: 'RECYCLED', grade: 'A' },
  };
}

export async function createCustomer(
  client: Client,
  prisma: PrismaClient,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; code: string }> {
  const res = await client.post('/customers', {
    companyName: `Customer ${uniq()}`,
    countryCode: 'EG',
    defaultCurrency: 'USD',
    creditLimit: '100000',
    paymentTermId: await termId(prisma, 'NET60'),
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`Customer setup failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.id, code: res.body.code };
}

export async function createSupplier(
  client: Client,
  prisma: PrismaClient,
  overrides: Record<string, unknown> = {},
) {
  const res = await client.post('/suppliers', {
    companyName: `Supplier ${uniq()}`,
    countryCode: 'TR',
    defaultCurrency: 'USD',
    paymentTermId: await termId(prisma, 'SUP-30-70-LOAD'),
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`Supplier setup failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.id as string };
}
