import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DEFAULT_ROLES, type DocumentLineInput } from '@fillco/contracts';
import { bootstrap, hashPassword } from '@fillco/db';
import { addDays, isoToDate, todayInTimeZone } from '@fillco/domain';
import { AppModule } from '../app.module';
import { actorForUser } from '../common/actor-factory';
import type { Actor } from '../common/actor';
import { PrismaService } from '../common/prisma.service';
import { CatalogService } from '../modules/catalog/catalog.service';
import { CustomersService } from '../modules/parties/customers.service';
import { SuppliersService } from '../modules/parties/suppliers.service';
import { PurchaseOrdersService } from '../modules/purchasing/purchase-orders.service';
import { QuotationsService } from '../modules/sales/quotations.service';
import { SalesOrdersService } from '../modules/sales/sales-orders.service';
import { SettingsService } from '../modules/settings/settings.service';

/**
 * Realistic demo data for an international textile raw-material trader. Everything is created
 * through the application services, so all business rules, numbering, audit and credit checks apply.
 *
 * Usage: pnpm db:seed   (requires an empty database: pnpm db:reset first)
 */
export const DEMO_PASSWORD = 'Fillco-Demo-2026';

const USERS = [
  { email: 'admin@fillco.local', fullName: 'Administrator', roles: ['ADMIN'] },
  { email: 'omar.haddad@fillco.local', fullName: 'Omar Haddad', roles: ['MANAGEMENT'] },
  { email: 'selin.kaya@fillco.local', fullName: 'Selin Kaya', roles: ['SALES'] },
  { email: 'karim.mansour@fillco.local', fullName: 'Karim Mansour', roles: ['SALES'] },
  { email: 'wei.chen@fillco.local', fullName: 'Wei Chen', roles: ['PURCHASING'] },
  { email: 'emre.demir@fillco.local', fullName: 'Emre Demir', roles: ['LOGISTICS'] },
  { email: 'nadia.farouk@fillco.local', fullName: 'Nadia Farouk', roles: ['FINANCE'] },
  { email: 'viewer@fillco.local', fullName: 'Board Viewer', roles: ['VIEWER'] },
] as const;

/** Approximate monthly reference rates (units of USD per 1 unit). Demo values, not market data. */
const RATES_TO_USD: Record<string, [start: number, end: number]> = {
  EUR: [1.08, 1.12],
  TRY: [0.029, 0.023],
  CNY: [0.138, 0.141],
  EGP: [0.0205, 0.0198],
  SAR: [0.2667, 0.2667],
  AED: [0.2723, 0.2723],
  JOD: [1.4104, 1.4104],
  MAD: [0.1, 0.108],
  GBP: [1.27, 1.3],
  PLN: [0.25, 0.262],
};

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    if ((await prisma.customer.count()) > 0 && !process.argv.includes('--force')) {
      console.log('Demo data already present (customers exist). Run `pnpm db:reset` first for a clean demo.');
      return;
    }
    await bootstrap(prisma, {
      roles: DEFAULT_ROLES,
      admin: { email: 'admin@fillco.local', password: DEMO_PASSWORD, fullName: 'Administrator' },
    });
    await seed(app.get.bind(app), prisma);
    console.log(`\nDemo data loaded. Sign in with any demo user and password "${DEMO_PASSWORD}":`);
    for (const u of USERS) console.log(`  ${u.email.padEnd(30)} ${u.roles.join(', ')}`);
  } finally {
    await app.close();
  }
}

type Get = <T>(type: new (...args: never[]) => T) => T;

async function seed(get: Get, prisma: PrismaService): Promise<void> {
  const company = await prisma.company.findFirstOrThrow();
  const today = todayInTimeZone(company.timezone);
  const daysAgo = (n: number) => addDays(today, -n);

  // ───────────── Users ─────────────
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const u of USERS) {
    const roles = await prisma.role.findMany({ where: { code: { in: [...u.roles] } } });
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        companyId: company.id,
        email: u.email,
        fullName: u.fullName,
        passwordHash,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      update: { passwordHash },
    });
  }
  const admin = await actorForUser(prisma, 'admin@fillco.local');
  const management = await actorForUser(prisma, 'omar.haddad@fillco.local');
  const selin = await actorForUser(prisma, 'selin.kaya@fillco.local');
  const karim = await actorForUser(prisma, 'karim.mansour@fillco.local');
  const wei = await actorForUser(prisma, 'wei.chen@fillco.local');
  const nadia = await actorForUser(prisma, 'nadia.farouk@fillco.local');

  // ───────────── Exchange rates: monthly for 13 months, plus today ─────────────
  const settings = get(SettingsService);
  const points: string[] = [];
  for (let m = 12; m >= 0; m--) points.push(addDays(today, -m * 30));
  for (const [cur, [start, end]] of Object.entries(RATES_TO_USD)) {
    for (const [i, date] of points.entries()) {
      const rate = start + ((end - start) * i) / (points.length - 1);
      await settings.saveExchangeRate(nadia, { rateDate: date, fromCurrency: cur, toCurrency: 'USD', rate: rate.toFixed(6) });
    }
  }

  // ───────────── Products ─────────────
  const catalog = get(CatalogService);
  const cat = async (code: string) => (await prisma.productCategory.findUniqueOrThrow({ where: { code } })).id;
  const packaging = async (code: string) => (await prisma.packagingType.findUniqueOrThrow({ where: { code } })).id;
  const bale = await packaging('BALE');
  const carton = await packaging('CARTON');

  const hcs = await catalog.createProduct(wei, {
    code: 'PSF-HCS',
    name: 'PSF HCS',
    categoryId: await cat('PSF'),
    description: 'Hollow conjugated siliconized polyester staple fiber for pillows, quilts and toys',
    defaultSalesUom: 'MT',
    defaultPurchaseUom: 'MT',
    hsCode: '550320',
    isActive: true,
    defaultPackagingTypeId: bale,
    fixedAttributes: { cross_section: 'HOLLOW_CONJUGATED', siliconized: true },
  });
  const solid = await catalog.createProduct(wei, {
    code: 'PSF-SOLID',
    name: 'PSF Solid',
    categoryId: await cat('PSF'),
    description: 'Solid polyester staple fiber for nonwovens and spinning',
    defaultSalesUom: 'MT',
    defaultPurchaseUom: 'MT',
    hsCode: '550320',
    isActive: true,
    defaultPackagingTypeId: bale,
    fixedAttributes: { cross_section: 'SOLID' },
  });
  const micro = await catalog.createProduct(wei, {
    code: 'MICRO',
    name: 'Microfiber',
    categoryId: await cat('MICRO'),
    description: 'Siliconized microfiber (down alternative)',
    defaultSalesUom: 'MT',
    defaultPurchaseUom: 'MT',
    hsCode: '550320',
    isActive: true,
    defaultPackagingTypeId: bale,
    fixedAttributes: { siliconized: true },
  });
  const lmf = await catalog.createProduct(wei, {
    code: 'LMF',
    name: 'Low Melt Fiber',
    categoryId: await cat('LOWMELT'),
    description: 'Bicomponent low melt fiber for thermal bonding',
    defaultSalesUom: 'MT',
    defaultPurchaseUom: 'MT',
    hsCode: '550320',
    isActive: true,
    defaultPackagingTypeId: bale,
    fixedAttributes: {},
  });
  const yarn = await catalog.createProduct(wei, {
    code: 'PES-DTY',
    name: 'Polyester DTY Yarn',
    categoryId: await cat('PES-YARN'),
    description: 'Draw textured polyester filament yarn on cones',
    defaultSalesUom: 'KG',
    defaultPurchaseUom: 'KG',
    hsCode: '540233',
    isActive: true,
    defaultPackagingTypeId: carton,
    fixedAttributes: { yarn_type: 'DTY' },
  });

  const spec = {
    hcs7: { denier: 7, cut_length_mm: 64, color: 'OPTICAL_WHITE', material: 'VIRGIN', grade: 'A' },
    hcs15: { denier: 15, cut_length_mm: 64, color: 'OPTICAL_WHITE', material: 'RECYCLED', grade: 'A' },
    hcs7raw: { denier: 7, cut_length_mm: 64, color: 'RAW_WHITE', material: 'RECYCLED', grade: 'A' },
    micro13: { denier: 1.3, cut_length_mm: 38, color: 'OPTICAL_WHITE', material: 'VIRGIN', grade: 'AA' },
    lmf4: { denier: 4, cut_length_mm: 51, color: 'RAW_WHITE', material: 'VIRGIN', grade: 'A', melt_point_c: 110, low_melt_pct: 50 },
    solid14: { denier: 1.4, cut_length_mm: 38, color: 'RAW_WHITE', material: 'RECYCLED', grade: 'A', siliconized: false },
    dty150: { denier: 150, filaments: 48, luster: 'SD', color: 'RAW_WHITE', material: 'VIRGIN', grade: 'AA' },
  };
  const line = (
    productId: string,
    attributes: Record<string, string | number | boolean>,
    qty: string,
    unitPrice: string,
    extra: Partial<DocumentLineInput> = {},
  ): DocumentLineInput => ({
    productId,
    attributes,
    qty,
    uom: extra.uom ?? 'MT',
    unitPrice,
    discountPct: extra.discountPct ?? '0',
    packagingTypeId: extra.packagingTypeId ?? bale,
    description: extra.description ?? null,
    notes: extra.notes ?? null,
  });

  // ───────────── Suppliers ─────────────
  const suppliers = get(SuppliersService);
  const term = async (code: string) => (await prisma.paymentTerm.findUniqueOrThrow({ where: { code } })).id;
  const port = async (locode: string) => (await prisma.port.findUniqueOrThrow({ where: { locode } })).id;

  const supplierData = [
    {
      key: 'anatolia',
      companyName: 'Anatolia Elyaf Sanayi A.Ş.',
      countryCode: 'TR',
      city: 'Gaziantep',
      address: 'Organize Sanayi Bölgesi 4. Kısım, 83409 Nolu Cad. No:12',
      phone: '+90 342 337 0000',
      email: 'export@anatolia-elyaf.example',
      term: 'SUP-30-70-LOAD',
      port: 'TRMER',
      lead: 21,
      contact: { name: 'Mehmet Yılmaz', position: 'Export Manager', phone: '+90 532 000 1122', whatsapp: '+90 532 000 1122', email: 'mehmet@anatolia-elyaf.example' },
      bank: { bankName: 'Türkiye İş Bankası', accountName: 'Anatolia Elyaf Sanayi A.Ş.', iban: 'TR330006100519786457841326', swift: 'ISBKTRIS', currency: 'USD' },
    },
    {
      key: 'marmara',
      companyName: 'Marmara Polyester Tekstil Ltd. Şti.',
      countryCode: 'TR',
      city: 'Bursa',
      address: 'Demirtaş OSB, Mustafa Karaer Cad. No:28, Osmangazi',
      phone: '+90 224 261 0000',
      email: 'sales@marmarapolyester.example',
      term: 'SUP-BL-COPY',
      port: 'TRGEM',
      lead: 14,
      contact: { name: 'Ayşe Çelik', position: 'Sales Director', phone: '+90 533 111 2233', whatsapp: '+90 533 111 2233', email: 'ayse@marmarapolyester.example' },
      bank: { bankName: 'Garanti BBVA', accountName: 'Marmara Polyester Tekstil', iban: 'TR320010009999901234567890', swift: 'TGBATRIS', currency: 'USD' },
    },
    {
      key: 'ege',
      companyName: 'Ege İplik Sanayi A.Ş.',
      countryCode: 'TR',
      city: 'Izmir',
      address: 'Kemalpaşa OSB, 17. Sokak No:5',
      phone: '+90 232 877 0000',
      email: 'export@egeiplik.example',
      term: 'SUP-30-70-LOAD',
      port: 'TRIZM',
      lead: 18,
      contact: { name: 'Burak Aydın', position: 'Export Executive', phone: '+90 535 222 3344', email: 'burak@egeiplik.example' },
      bank: null,
    },
    {
      key: 'huaxin',
      companyName: 'Jiangsu Huaxin Chemical Fiber Co., Ltd.',
      countryCode: 'CN',
      city: 'Suqian, Jiangsu',
      address: 'No. 8 Fiber Industrial Park Road, Suyu District',
      phone: '+86 527 8888 0000',
      email: 'overseas@huaxinfiber.example',
      term: 'SUP-30-70-LOAD',
      port: 'CNSHA',
      lead: 30,
      contact: { name: 'Lily Zhang', position: 'Overseas Sales', phone: '+86 138 0000 1234', whatsapp: '+86 138 0000 1234', email: 'lily@huaxinfiber.example' },
      bank: { bankName: 'Bank of China, Jiangsu Branch', accountName: 'Jiangsu Huaxin Chemical Fiber Co Ltd', accountNumber: '4712 5820 3316', swift: 'BKCHCNBJ940', currency: 'USD' },
    },
    {
      key: 'hengyuan',
      companyName: 'Zhejiang Hengyuan Microfiber Co., Ltd.',
      countryCode: 'CN',
      city: 'Shaoxing, Zhejiang',
      address: 'Binhai Industrial Zone, Keqiao',
      phone: '+86 575 8555 0000',
      email: 'sales@hengyuanmicro.example',
      term: 'SUP-30-70-LOAD',
      port: 'CNNGB',
      lead: 25,
      contact: { name: 'Kevin Wu', position: 'Sales Manager', phone: '+86 139 5555 6789', whatsapp: '+86 139 5555 6789', email: 'kevin@hengyuanmicro.example' },
      bank: { bankName: 'Industrial and Commercial Bank of China', accountName: 'Zhejiang Hengyuan Microfiber Co Ltd', accountNumber: '1211 0260 0920 0123 456', swift: 'ICBKCNBJZJP', currency: 'USD' },
    },
    {
      key: 'jinlun',
      companyName: 'Fujian Jinlun Low Melt Fiber Co., Ltd.',
      countryCode: 'CN',
      city: 'Xiamen, Fujian',
      address: 'Haicang Investment Zone, No. 66 Xinyang Road',
      phone: '+86 592 6000 0000',
      email: 'export@jinlunfiber.example',
      term: 'SUP-BL-COPY',
      port: 'CNXMN',
      lead: 28,
      contact: { name: 'Grace Lin', position: 'Export Manager', phone: '+86 137 7777 8888', email: 'grace@jinlunfiber.example' },
      bank: null,
    },
  ];
  const supplierIds: Record<string, string> = {};
  for (const s of supplierData) {
    const created = await suppliers.create(wei, {
      companyName: s.companyName,
      supplierType: 'MATERIAL',
      countryCode: s.countryCode,
      city: s.city,
      address: s.address,
      phone: s.phone,
      email: s.email,
      defaultCurrency: 'USD',
      paymentTermId: await term(s.term),
      productionLeadTimeDays: s.lead,
      defaultIncoterm: 'FOB',
      defaultLoadingPortId: await port(s.port),
      status: 'ACTIVE',
      contacts: [{ ...s.contact, isPrimary: true, whatsapp: s.contact.whatsapp ?? null, notes: null }],
      addresses: [{ type: 'BILLING', line1: s.address, city: s.city, countryCode: s.countryCode, isDefault: true }],
    });
    supplierIds[s.key] = created.id;
    if (s.bank) {
      const withBank = await suppliers.addBankAccount(wei, created.id, { accountNumber: null, iban: null, bankAddress: null, notes: null, ...s.bank });
      // Four-eyes: entered by purchasing, approved by finance (except one left pending for the demo).
      if (s.key !== 'hengyuan') await suppliers.approveBankAccount(nadia, created.id, withBank.bankAccounts![0]!.id);
    }
  }
  for (const f of [
    { companyName: 'Bosphorus Global Logistics A.Ş.', countryCode: 'TR', city: 'Istanbul', type: 'FORWARDER' as const, email: 'ops@bosphoruslogistics.example' },
    { companyName: 'Oceanlink Shipping Agency (Shanghai) Co.', countryCode: 'CN', city: 'Shanghai', type: 'FORWARDER' as const, email: 'booking@oceanlink.example' },
    { companyName: 'SGS Inspection Services', countryCode: 'TR', city: 'Istanbul', type: 'INSPECTION' as const, email: 'textiles@sgs-demo.example' },
  ]) {
    await suppliers.create(wei, {
      companyName: f.companyName,
      supplierType: f.type,
      countryCode: f.countryCode,
      city: f.city,
      email: f.email,
      defaultCurrency: 'USD',
      status: 'ACTIVE',
      contacts: [],
      addresses: [],
    });
  }

  // ───────────── Customers ─────────────
  const customers = get(CustomersService);
  const customerData = [
    { key: 'delta', owner: selin, name: 'Delta Home Textiles S.A.E.', country: 'EG', city: '10th of Ramadan City', currency: 'USD', term: 'ADV30-BL70', limit: '250000', incoterm: 'CFR', port: 'EGALY', contact: ['Ahmed Soliman', 'Purchasing Manager', '+20 100 123 4567'] },
    { key: 'nile', owner: selin, name: 'Nile Bedding Industries', country: 'EG', city: 'Alexandria', currency: 'USD', term: 'CAD', limit: '150000', incoterm: 'CFR', port: 'EGALY', contact: ['Mona Hassan', 'Supply Chain Lead', '+20 122 987 6543'] },
    { key: 'alnoor', owner: karim, name: 'Al Noor Mattress Factory', country: 'SA', city: 'Riyadh', currency: 'USD', term: 'LC-SIGHT', limit: '300000', incoterm: 'CFR', port: 'SADMM', contact: ['Faisal Al-Otaibi', 'Procurement Head', '+966 55 123 4567'] },
    { key: 'gulf', owner: karim, name: 'Gulf Comfort Trading LLC', country: 'AE', city: 'Dubai', currency: 'USD', term: 'NET60', limit: '200000', incoterm: 'CFR', port: 'AEJEA', contact: ['Rashid Khan', 'General Manager', '+971 50 765 4321'] },
    { key: 'amman', owner: karim, name: 'Amman Quilts & Pillows Co.', country: 'JO', city: 'Amman', currency: 'USD', term: 'NET90', limit: '80000', incoterm: 'CFR', port: 'JOAQJ', contact: ['Lina Haddad', 'Owner', '+962 79 555 1234'] },
    { key: 'atlas', owner: selin, name: 'Atlas Nonwovens SARL', country: 'MA', city: 'Casablanca', currency: 'EUR', term: 'ADV20-BL60', limit: '120000', incoterm: 'CIF', port: 'MACAS', contact: ['Youssef El Amrani', 'Directeur Achats', '+212 661 234 567'] },
    { key: 'polska', owner: selin, name: 'Polska Fibre Solutions Sp. z o.o.', country: 'PL', city: 'Łódź', currency: 'EUR', term: 'NET60', limit: '150000', incoterm: 'CIF', port: 'PLGDN', contact: ['Piotr Nowak', 'Purchasing', '+48 601 234 567'] },
    { key: 'tessuti', owner: selin, name: 'Tessuti Imbottiti S.r.l.', country: 'IT', city: 'Prato', currency: 'EUR', term: 'NET90', limit: '100000', incoterm: 'CIF', port: 'ITGOA', contact: ['Giulia Bianchi', 'Buyer', '+39 333 123 4567'] },
    { key: 'lagos', owner: karim, name: 'Lagos Home Comfort Ltd', country: 'NG', city: 'Lagos', currency: 'USD', term: 'CIA', limit: '0', incoterm: 'CFR', port: 'NGAPP', contact: ['Chinedu Okafor', 'MD', '+234 803 123 4567'] },
    { key: 'mombasa', owner: karim, name: 'Mombasa Fibre Works', country: 'KE', city: 'Mombasa', currency: 'USD', term: 'ADV30-BL70', limit: '60000', incoterm: 'CFR', port: 'KEMBA', contact: ['Grace Wanjiru', 'Operations', '+254 722 123 456'] },
  ];
  const customerIds: Record<string, string> = {};
  for (const c of customerData) {
    const [name, position, phone] = c.contact as [string, string, string];
    const created = await customers.create(admin, {
      companyName: c.name,
      countryCode: c.country,
      city: c.city,
      address: `${c.city}, ${c.country}`,
      phone,
      email: `purchasing@${c.key}.example`,
      defaultCurrency: c.currency,
      paymentTermId: await term(c.term),
      creditLimit: c.limit,
      creditLimitCurrency: c.currency,
      defaultIncoterm: c.incoterm,
      defaultDestinationPortId: await port(c.port),
      salespersonId: c.owner.userId,
      status: 'ACTIVE',
      contacts: [{ name, position, phone, whatsapp: phone, email: `${name.split(' ')[0]!.toLowerCase()}@${c.key}.example`, isPrimary: true, notes: null }],
      addresses: [
        { type: 'BILLING', line1: `${c.name}, main office`, city: c.city, countryCode: c.country, isDefault: true },
        { type: 'SHIPPING', line1: `${c.name}, factory warehouse`, city: c.city, countryCode: c.country, isDefault: true },
      ],
    });
    customerIds[c.key] = created.id;
  }
  // A prospect not yet ordering.
  await customers.create(selin, {
    companyName: 'Tunis Literie Moderne',
    countryCode: 'TN',
    city: 'Sfax',
    defaultCurrency: 'EUR',
    creditLimit: '0',
    status: 'PROSPECT',
    contacts: [{ name: 'Sami Trabelsi', position: 'Gérant', phone: '+216 98 123 456', isPrimary: true }],
    addresses: [],
  } as never);

  const ownerOf = (key: string) => customerData.find((c) => c.key === key)!.owner;

  // ───────────── Quotations ─────────────
  const quotations = get(QuotationsService);
  const q1 = await quotations.create(selin, {
    customerId: customerIds.delta!,
    quotationDate: daysAgo(10),
    validUntil: addDays(today, 20),
    currency: 'USD',
    incoterm: 'CFR',
    destinationCountry: 'EG',
    destinationPortId: await port('EGALY'),
    paymentTermId: await term('ADV30-BL70'),
    estimatedShipmentDate: addDays(today, 25),
    notes: 'Prices CFR Alexandria, 2 x 40HC. Subject to final confirmation.',
    lines: [
      { ...line(hcs.id, spec.hcs7, '48', '1180'), estUnitCost: '1045', estCostCurrency: 'USD' },
      { ...line(hcs.id, spec.hcs15, '24', '1060'), estUnitCost: '930', estCostCurrency: 'USD' },
    ],
  });
  await quotations.send(selin, q1.id);
  await quotations.accept(selin, q1.id, 'Accepted by Ahmed Soliman by e-mail');
  const { salesOrderId: soFromQuote } = await quotations.convert(selin, q1.id);

  const q2 = await quotations.create(selin, {
    customerId: customerIds.polska!,
    quotationDate: daysAgo(12),
    validUntil: addDays(today, 18),
    currency: 'EUR',
    incoterm: 'CIF',
    destinationCountry: 'PL',
    destinationPortId: await port('PLGDN'),
    paymentTermId: await term('NET60'),
    estimatedShipmentDate: addDays(today, 35),
    lines: [{ ...line(lmf.id, spec.lmf4, '22', '1390'), estUnitCost: '1170', estCostCurrency: 'EUR' }],
  });
  await quotations.send(selin, q2.id);
  const q2r2 = await quotations.revise(selin, q2.id);
  await quotations.update(selin, q2r2.id, {
    customerId: customerIds.polska!,
    quotationDate: today,
    validUntil: addDays(today, 30),
    currency: 'EUR',
    incoterm: 'CIF',
    destinationCountry: 'PL',
    destinationPortId: await port('PLGDN'),
    paymentTermId: await term('NET60'),
    estimatedShipmentDate: addDays(today, 40),
    notes: 'Revised price after volume increase to 44 MT.',
    lines: [{ ...line(lmf.id, spec.lmf4, '44', '1365'), estUnitCost: '1160', estCostCurrency: 'EUR' }],
    version: q2r2.version,
  });
  await quotations.send(selin, q2r2.id);

  const q3 = await quotations.create(karim, {
    customerId: customerIds.gulf!,
    quotationDate: daysAgo(8),
    validUntil: addDays(today, 7),
    currency: 'USD',
    incoterm: 'CFR',
    destinationCountry: 'AE',
    destinationPortId: await port('AEJEA'),
    paymentTermId: await term('NET60'),
    lines: [line(micro.id, spec.micro13, '20', '1520')],
  });
  await quotations.send(karim, q3.id);
  await quotations.reject(karim, q3.id, 'Customer chose a local supplier on price');

  await quotations.create(karim, {
    customerId: customerIds.alnoor!,
    quotationDate: today,
    validUntil: addDays(today, 14),
    currency: 'USD',
    incoterm: 'CFR',
    destinationCountry: 'SA',
    destinationPortId: await port('SADMM'),
    paymentTermId: await term('LC-SIGHT'),
    lines: [line(hcs.id, spec.hcs15, '72', '1045'), line(solid.id, spec.solid14, '24', '960')],
  });

  // ───────────── Sales orders ─────────────
  const orders = get(SalesOrdersService);
  const confirm = async (actor: Actor, id: string, overrideReason?: string) => {
    const so = await orders.get(actor, id);
    return orders.confirm(actor, id, { version: so.version, overrideReason: overrideReason ?? null });
  };
  const so = async (
    key: string,
    daysBack: number,
    shipInDays: number,
    lines: DocumentLineInput[],
    extra: { poRef?: string; notes?: string } = {},
  ) => {
    const c = customerData.find((x) => x.key === key)!;
    return orders.create(c.owner, {
      customerId: customerIds[key]!,
      customerPoRef: extra.poRef ?? null,
      orderDate: daysAgo(daysBack),
      currency: c.currency,
      incoterm: c.incoterm,
      destinationCountry: c.country,
      destinationPortId: await port(c.port),
      paymentTermId: await term(c.term),
      requestedShipmentDate: addDays(today, shipInDays),
      notes: extra.notes ?? null,
      lines,
    });
  };

  // Delta (from quotation) — confirmed, will be purchased from two suppliers.
  const soDelta = await confirm(selin, soFromQuote);

  const soAlnoor = await so('alnoor', 95, -30, [line(hcs.id, spec.hcs15, '96', '1040'), line(solid.id, spec.solid14, '48', '955')], { poRef: 'ANM/PO/2026/118' });
  await confirm(karim, soAlnoor.id);
  const soGulf = await so('gulf', 80, -10, [line(micro.id, spec.micro13, '19.5', '1495')], { poRef: 'GCT-4471' });
  await confirm(karim, soGulf.id);
  const soNile = await so('nile', 60, 5, [line(hcs.id, spec.hcs7raw, '24', '1015')], { poRef: 'NBI-0932' });
  await confirm(selin, soNile.id);
  const soAtlas = await so('atlas', 45, 10, [line(lmf.id, spec.lmf4, '22', '1420'), line(solid.id, spec.solid14, '22', '905')]);
  await confirm(selin, soAtlas.id);
  const soTessuti = await so('tessuti', 38, 20, [line(micro.id, spec.micro13, '10', '1560', { discountPct: '2' })], { poRef: 'TI-26-0147' });
  await confirm(selin, soTessuti.id);
  const soPolska = await so('polska', 30, 25, [line(lmf.id, spec.lmf4, '44', '1385')]);
  await confirm(selin, soPolska.id);
  const soMombasa = await so('mombasa', 21, 30, [line(hcs.id, spec.hcs7raw, '24', '1030')]);
  await confirm(karim, soMombasa.id);
  const soLagos = await so('lagos', 14, 40, [line(yarn.id, spec.dty150, '18000', '1.48', { uom: 'KG', packagingTypeId: carton })]);
  await confirm(karim, soLagos.id);
  // Amman: a first order uses most of the USD 80k limit; the second exceeds it → finance override.
  const soAmman1 = await so('amman', 50, -5, [line(hcs.id, spec.hcs7, '48', '1150')]);
  await confirm(karim, soAmman1.id);
  const soAmman2 = await so('amman', 7, 45, [line(micro.id, spec.micro13, '24', '1540')]);
  // Karim (sales) cannot override; Nadia (finance, credit.override) confirms with a reason.
  await orders.confirm(nadia, soAmman2.id, {
    version: (await orders.get(nadia, soAmman2.id)).version,
    overrideReason: 'Customer paid USD 40,000 last week (to be recorded in Phase 2). Limit review scheduled.',
  });

  // Pipeline in earlier states.
  const soDraft = await so('gulf', 2, 50, [line(hcs.id, spec.hcs15, '24', '1055'), line(micro.id, spec.micro13, '6', '1510')], { notes: 'Awaiting final quantity from customer' });
  const soPending = await so('alnoor', 3, 55, [line(hcs.id, spec.hcs7, '72', '1135')], { poRef: 'ANM/PO/2026/141' });
  await orders.submit(karim, soPending.id, soPending.version);
  const soHold = await so('nile', 25, 15, [line(micro.id, spec.micro13, '8', '1530')]);
  const soHoldConfirmed = await confirm(selin, soHold.id);
  await orders.hold(management, soHold.id, soHoldConfirmed.version, 'Waiting for customer to clear documents on previous shipment');
  const soCancel = await so('tessuti', 33, 20, [line(hcs.id, spec.hcs7, '12', '1210')]);
  const soCancelConfirmed = await confirm(selin, soCancel.id);
  await orders.cancel(selin, soCancel.id, soCancelConfirmed.version, 'Customer postponed the season; will reorder in Q1');

  // ───────────── Purchase orders ─────────────
  const pos = get(PurchaseOrdersService);
  const lineIds = async (id: string, actor: Actor) => (await orders.get(actor, id)).lines.map((l) => l.id);
  const advance = async (id: string, to: ('SENT' | 'CONFIRMED' | 'IN_PRODUCTION' | 'READY')[], extra: { supplierRef?: string; confirmedReadyDate?: string } = {}) => {
    for (const status of to) {
      const current = await pos.get(wei, id);
      await pos.transition(wei, id, {
        to: status,
        version: current.version,
        reason: null,
        supplierRef: status === 'CONFIRMED' ? (extra.supplierRef ?? null) : null,
        confirmedReadyDate: status === 'CONFIRMED' ? (extra.confirmedReadyDate ?? null) : null,
      });
    }
  };

  // Al Noor: fully purchased from Anatolia (TR), ready.
  const [alnoorL1, alnoorL2] = await lineIds(soAlnoor.id, karim);
  const poAlnoor = await pos.purchaseFromSales(wei, {
    supplierId: supplierIds.anatolia!,
    poDate: daysAgo(92),
    currency: 'USD',
    incoterm: 'FOB',
    expectedReadyDate: daysAgo(40),
    supplierRef: 'AE-PI-26-0412',
    lines: [
      { salesOrderLineId: alnoorL1!, qty: '96', uom: 'MT', unitPrice: '905' },
      { salesOrderLineId: alnoorL2!, qty: '48', uom: 'MT', unitPrice: '820' },
    ],
  });
  await advance(poAlnoor.id, ['SENT', 'CONFIRMED', 'IN_PRODUCTION', 'READY'], { supplierRef: 'AE-PI-26-0412' });

  // Gulf: microfiber from Hengyuan (CN), in production.
  const [gulfL1] = await lineIds(soGulf.id, karim);
  const poGulf = await pos.purchaseFromSales(wei, {
    supplierId: supplierIds.hengyuan!,
    poDate: daysAgo(78),
    currency: 'USD',
    incoterm: 'FOB',
    expectedReadyDate: daysAgo(20),
    lines: [{ salesOrderLineId: gulfL1!, qty: '19.5', uom: 'MT', unitPrice: '1265' }],
  });
  // Confirmed with a ready date in the past → shows as delayed.
  await advance(poGulf.id, ['SENT', 'CONFIRMED', 'IN_PRODUCTION'], { supplierRef: 'HY20260611-07', confirmedReadyDate: daysAgo(12) });

  // Delta: HCS 7D from Marmara (TR) and HCS 15D from Huaxin (CN): one customer order, two suppliers.
  const [deltaL1, deltaL2] = soDelta.lines.map((l) => l.id);
  const poDeltaTr = await pos.purchaseFromSales(wei, {
    supplierId: supplierIds.marmara!,
    poDate: daysAgo(55),
    currency: 'USD',
    incoterm: 'FOB',
    expectedReadyDate: addDays(today, 5),
    lines: [{ salesOrderLineId: deltaL1!, qty: '48', uom: 'MT', unitPrice: '1040' }],
  });
  await advance(poDeltaTr.id, ['SENT', 'CONFIRMED', 'IN_PRODUCTION'], { supplierRef: 'MP-2026-0877' });

  // Huaxin PO sized for Delta 15D + Nile 7D raw + stock: one supplier PO serving several customer orders.
  const poHuaxin = await pos.create(wei, {
    supplierId: supplierIds.huaxin!,
    poDate: daysAgo(50),
    currency: 'USD',
    incoterm: 'FOB',
    loadingPortId: await port('CNSHA'),
    paymentTermId: await term('SUP-30-70-LOAD'),
    expectedReadyDate: addDays(today, 10),
    notes: 'Consolidated booking: 3 x 40HC',
    lines: [
      line(hcs.id, spec.hcs15, '24', '880'),
      line(hcs.id, spec.hcs7raw, '52', '905', { notes: '24 MT Nile Bedding, 24 MT Mombasa, 4 MT stock' }),
    ],
  });
  const huaxinLines = poHuaxin.lines;
  await pos.allocate(wei, { salesOrderLineId: deltaL2!, purchaseOrderLineId: huaxinLines[0]!.id, qty: '24', uom: 'MT', substituteNote: null });
  const [nileL1] = await lineIds(soNile.id, selin);
  await pos.allocate(wei, { salesOrderLineId: nileL1!, purchaseOrderLineId: huaxinLines[1]!.id, qty: '24', uom: 'MT', substituteNote: null });
  const [mombasaL1] = await lineIds(soMombasa.id, karim);
  await pos.allocate(wei, { salesOrderLineId: mombasaL1!, purchaseOrderLineId: huaxinLines[1]!.id, qty: '24', uom: 'MT', substituteNote: null });
  await advance(poHuaxin.id, ['SENT', 'CONFIRMED'], { supplierRef: 'HX-EXP-26-1093' });

  // Atlas: low melt from Jinlun confirmed; the solid line is still awaiting purchase → partially purchased.
  const [atlasL1] = await lineIds(soAtlas.id, selin);
  const poAtlas = await pos.purchaseFromSales(wei, {
    supplierId: supplierIds.jinlun!,
    poDate: daysAgo(40),
    currency: 'USD',
    incoterm: 'FOB',
    expectedReadyDate: addDays(today, 3),
    lines: [{ salesOrderLineId: atlasL1!, qty: '22', uom: 'MT', unitPrice: '1250' }],
  });
  await advance(poAtlas.id, ['SENT', 'CONFIRMED'], { supplierRef: 'JL-LM-2026-331' });

  // Tessuti: sent to supplier but not yet confirmed → "Purchasing".
  const [tessutiL1] = await lineIds(soTessuti.id, selin);
  const poTessuti = await pos.purchaseFromSales(wei, {
    supplierId: supplierIds.hengyuan!,
    poDate: daysAgo(5),
    currency: 'USD',
    incoterm: 'FOB',
    expectedReadyDate: addDays(today, 20),
    lines: [{ salesOrderLineId: tessutiL1!, qty: '10', uom: 'MT', unitPrice: '1290' }],
  });
  await advance(poTessuti.id, ['SENT']);

  // Amman first order: from Anatolia, confirmed.
  const [amman1L1] = await lineIds(soAmman1.id, karim);
  const poAmman = await pos.purchaseFromSales(wei, {
    supplierId: supplierIds.anatolia!,
    poDate: daysAgo(48),
    currency: 'USD',
    incoterm: 'FOB',
    expectedReadyDate: addDays(today, 2),
    lines: [{ salesOrderLineId: amman1L1!, qty: '48', uom: 'MT', unitPrice: '1015' }],
  });
  await advance(poAmman.id, ['SENT', 'CONFIRMED', 'IN_PRODUCTION'], { supplierRef: 'AE-PI-26-0588' });

  // Yarn for Lagos: draft PO to Ege İplik, not yet sent.
  const [lagosL1] = await lineIds(soLagos.id, karim);
  await pos.purchaseFromSales(wei, {
    supplierId: supplierIds.ege!,
    poDate: today,
    currency: 'USD',
    incoterm: 'FOB',
    expectedReadyDate: addDays(today, 25),
    lines: [{ salesOrderLineId: lagosL1!, qty: '18000', uom: 'KG', unitPrice: '1.26' }],
  });

  // Stock purchase with no customer order yet.
  const poStock = await pos.create(wei, {
    supplierId: supplierIds.marmara!,
    poDate: daysAgo(10),
    currency: 'USD',
    incoterm: 'FOB',
    loadingPortId: await port('TRGEM'),
    paymentTermId: await term('SUP-BL-COPY'),
    expectedReadyDate: addDays(today, 15),
    notes: 'Opportunistic stock purchase at a good price — to be allocated to upcoming Egyptian orders',
    lines: [line(hcs.id, spec.hcs7, '24', '1005')],
  });
  await advance(poStock.id, ['SENT', 'CONFIRMED'], { supplierRef: 'MP-2026-0931' });

  // Milestones on the Al Noor PO.
  await pos.saveMilestone(wei, poAlnoor.id, { milestone: 'INSPECTION', plannedDate: daysAgo(42), actualDate: daysAgo(41), notes: 'SGS pre-shipment inspection passed' });

  // Left open on purpose: Polska (awaiting purchase), Gulf draft, Al Noor pending confirmation.
  void soPolska;
  void soDraft;
}

void main();
