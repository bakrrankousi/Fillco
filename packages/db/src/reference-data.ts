/**
 * Reference data loaded on every environment (idempotent). Users can extend all of it in Settings.
 */

export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', minorUnits: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', minorUnits: 2 },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', minorUnits: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', minorUnits: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minorUnits: 2 },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JOD', minorUnits: 3 },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD', minorUnits: 2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', minorUnits: 2 },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', minorUnits: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', minorUnits: 2 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KWD', minorUnits: 3 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR', minorUnits: 2 },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'TND', minorUnits: 3 },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DZD', minorUnits: 2 },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', minorUnits: 2 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', minorUnits: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', minorUnits: 2 },
] as const;

export const COUNTRIES: { code: string; name: string; region: string }[] = [
  { code: 'TR', name: 'Türkiye', region: 'Europe / Middle East' },
  { code: 'CN', name: 'China', region: 'Asia' },
  { code: 'EG', name: 'Egypt', region: 'Middle East & North Africa' },
  { code: 'SA', name: 'Saudi Arabia', region: 'Middle East & North Africa' },
  { code: 'AE', name: 'United Arab Emirates', region: 'Middle East & North Africa' },
  { code: 'JO', name: 'Jordan', region: 'Middle East & North Africa' },
  { code: 'MA', name: 'Morocco', region: 'Middle East & North Africa' },
  { code: 'TN', name: 'Tunisia', region: 'Middle East & North Africa' },
  { code: 'DZ', name: 'Algeria', region: 'Middle East & North Africa' },
  { code: 'LY', name: 'Libya', region: 'Middle East & North Africa' },
  { code: 'IQ', name: 'Iraq', region: 'Middle East & North Africa' },
  { code: 'LB', name: 'Lebanon', region: 'Middle East & North Africa' },
  { code: 'KW', name: 'Kuwait', region: 'Middle East & North Africa' },
  { code: 'QA', name: 'Qatar', region: 'Middle East & North Africa' },
  { code: 'OM', name: 'Oman', region: 'Middle East & North Africa' },
  { code: 'BH', name: 'Bahrain', region: 'Middle East & North Africa' },
  { code: 'SD', name: 'Sudan', region: 'Africa' },
  { code: 'NG', name: 'Nigeria', region: 'Africa' },
  { code: 'KE', name: 'Kenya', region: 'Africa' },
  { code: 'GH', name: 'Ghana', region: 'Africa' },
  { code: 'SN', name: 'Senegal', region: 'Africa' },
  { code: 'CI', name: "Côte d'Ivoire", region: 'Africa' },
  { code: 'TZ', name: 'Tanzania', region: 'Africa' },
  { code: 'ET', name: 'Ethiopia', region: 'Africa' },
  { code: 'ZA', name: 'South Africa', region: 'Africa' },
  { code: 'IT', name: 'Italy', region: 'Europe' },
  { code: 'DE', name: 'Germany', region: 'Europe' },
  { code: 'PL', name: 'Poland', region: 'Europe' },
  { code: 'ES', name: 'Spain', region: 'Europe' },
  { code: 'FR', name: 'France', region: 'Europe' },
  { code: 'NL', name: 'Netherlands', region: 'Europe' },
  { code: 'BE', name: 'Belgium', region: 'Europe' },
  { code: 'GB', name: 'United Kingdom', region: 'Europe' },
  { code: 'GR', name: 'Greece', region: 'Europe' },
  { code: 'RO', name: 'Romania', region: 'Europe' },
  { code: 'BG', name: 'Bulgaria', region: 'Europe' },
  { code: 'PT', name: 'Portugal', region: 'Europe' },
  { code: 'UA', name: 'Ukraine', region: 'Europe' },
  { code: 'IN', name: 'India', region: 'Asia' },
  { code: 'PK', name: 'Pakistan', region: 'Asia' },
  { code: 'BD', name: 'Bangladesh', region: 'Asia' },
  { code: 'VN', name: 'Vietnam', region: 'Asia' },
  { code: 'US', name: 'United States', region: 'Americas' },
];

export const PORTS: { locode: string; name: string; countryCode: string }[] = [
  { locode: 'TRMER', name: 'Mersin', countryCode: 'TR' },
  { locode: 'TRAMR', name: 'Istanbul (Ambarli)', countryCode: 'TR' },
  { locode: 'TRGEM', name: 'Gemlik', countryCode: 'TR' },
  { locode: 'TRIZM', name: 'Izmir', countryCode: 'TR' },
  { locode: 'CNSHA', name: 'Shanghai', countryCode: 'CN' },
  { locode: 'CNNGB', name: 'Ningbo', countryCode: 'CN' },
  { locode: 'CNTAO', name: 'Qingdao', countryCode: 'CN' },
  { locode: 'CNXMN', name: 'Xiamen', countryCode: 'CN' },
  { locode: 'EGALY', name: 'Alexandria', countryCode: 'EG' },
  { locode: 'EGPSD', name: 'Port Said', countryCode: 'EG' },
  { locode: 'SAJED', name: 'Jeddah', countryCode: 'SA' },
  { locode: 'SADMM', name: 'Dammam', countryCode: 'SA' },
  { locode: 'AEJEA', name: 'Jebel Ali', countryCode: 'AE' },
  { locode: 'JOAQJ', name: 'Aqaba', countryCode: 'JO' },
  { locode: 'MACAS', name: 'Casablanca', countryCode: 'MA' },
  { locode: 'MAPTM', name: 'Tanger Med', countryCode: 'MA' },
  { locode: 'TNTUN', name: 'Tunis', countryCode: 'TN' },
  { locode: 'DZALG', name: 'Algiers', countryCode: 'DZ' },
  { locode: 'ITGOA', name: 'Genoa', countryCode: 'IT' },
  { locode: 'PLGDN', name: 'Gdansk', countryCode: 'PL' },
  { locode: 'DEHAM', name: 'Hamburg', countryCode: 'DE' },
  { locode: 'ESVLC', name: 'Valencia', countryCode: 'ES' },
  { locode: 'GRPIR', name: 'Piraeus', countryCode: 'GR' },
  { locode: 'NGAPP', name: 'Lagos (Apapa)', countryCode: 'NG' },
  { locode: 'KEMBA', name: 'Mombasa', countryCode: 'KE' },
];

export const INCOTERMS = [
  { code: 'EXW', name: 'Ex Works', main: false, ins: false, sea: false },
  { code: 'FCA', name: 'Free Carrier', main: false, ins: false, sea: false },
  { code: 'FAS', name: 'Free Alongside Ship', main: false, ins: false, sea: true },
  { code: 'FOB', name: 'Free On Board', main: false, ins: false, sea: true },
  { code: 'CFR', name: 'Cost and Freight', main: true, ins: false, sea: true },
  { code: 'CIF', name: 'Cost, Insurance and Freight', main: true, ins: true, sea: true },
  { code: 'CPT', name: 'Carriage Paid To', main: true, ins: false, sea: false },
  { code: 'CIP', name: 'Carriage and Insurance Paid To', main: true, ins: true, sea: false },
  { code: 'DAP', name: 'Delivered at Place', main: true, ins: false, sea: false },
  { code: 'DPU', name: 'Delivered at Place Unloaded', main: true, ins: false, sea: false },
  { code: 'DDP', name: 'Delivered Duty Paid', main: true, ins: false, sea: false },
] as const;

export const UOMS = [
  { code: 'KG', name: 'Kilogram', dimension: 'MASS', factorToBase: '1', isBase: true },
  { code: 'MT', name: 'Metric ton', dimension: 'MASS', factorToBase: '1000', isBase: false },
  { code: 'LB', name: 'Pound', dimension: 'MASS', factorToBase: '0.45359237', isBase: false },
] as const;

export const PACKAGING_TYPES = [
  { code: 'BALE', name: 'Compressed bale (~250–300 kg)', nominalWeightKg: '270' },
  { code: 'CARTON', name: 'Carton (yarn cones)', nominalWeightKg: '25' },
  { code: 'PALLET', name: 'Palletized cartons', nominalWeightKg: '1000' },
  { code: 'BAG', name: 'Woven bag', nominalWeightKg: '25' },
] as const;

type Installment = {
  percent: string;
  triggerEvent:
    | 'ORDER_CONFIRMATION'
    | 'BEFORE_LOADING'
    | 'INVOICE_DATE'
    | 'BL_DATE'
    | 'ETA'
    | 'ARRIVAL'
    | 'DELIVERY';
  offsetDays: number;
  instrument?: 'TT' | 'CAD' | 'LC' | 'CASH' | 'CHEQUE';
};

export const PAYMENT_TERMS: { code: string; name: string; installments: Installment[] }[] = [
  { code: 'CIA', name: 'Cash in advance', installments: [{ percent: '100', triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0, instrument: 'TT' }] },
  { code: 'NET30', name: '30 days from invoice', installments: [{ percent: '100', triggerEvent: 'INVOICE_DATE', offsetDays: 30, instrument: 'TT' }] },
  { code: 'NET60', name: '60 days from invoice', installments: [{ percent: '100', triggerEvent: 'INVOICE_DATE', offsetDays: 60, instrument: 'TT' }] },
  { code: 'NET90', name: '90 days from invoice', installments: [{ percent: '100', triggerEvent: 'INVOICE_DATE', offsetDays: 90, instrument: 'TT' }] },
  { code: 'NET120', name: '120 days from invoice', installments: [{ percent: '100', triggerEvent: 'INVOICE_DATE', offsetDays: 120, instrument: 'TT' }] },
  {
    code: 'ADV30-BL70',
    name: '30% advance, 70% against BL',
    installments: [
      { percent: '30', triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0, instrument: 'TT' },
      { percent: '70', triggerEvent: 'BL_DATE', offsetDays: 0, instrument: 'TT' },
    ],
  },
  {
    code: 'ADV20-BL60',
    name: '20% advance, 80% 60 days after BL',
    installments: [
      { percent: '20', triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0, instrument: 'TT' },
      { percent: '80', triggerEvent: 'BL_DATE', offsetDays: 60, instrument: 'TT' },
    ],
  },
  { code: 'CAD', name: 'Cash against documents', installments: [{ percent: '100', triggerEvent: 'BL_DATE', offsetDays: 7, instrument: 'CAD' }] },
  { code: 'LC-SIGHT', name: 'Irrevocable L/C at sight', installments: [{ percent: '100', triggerEvent: 'BL_DATE', offsetDays: 10, instrument: 'LC' }] },
  { code: 'LC-90', name: 'L/C 90 days from BL', installments: [{ percent: '100', triggerEvent: 'BL_DATE', offsetDays: 90, instrument: 'LC' }] },
  {
    code: 'SUP-30-70-LOAD',
    name: 'Supplier: 30% deposit, 70% before loading',
    installments: [
      { percent: '30', triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0, instrument: 'TT' },
      { percent: '70', triggerEvent: 'BEFORE_LOADING', offsetDays: 0, instrument: 'TT' },
    ],
  },
  { code: 'SUP-BL-COPY', name: 'Supplier: 100% against copy of BL', installments: [{ percent: '100', triggerEvent: 'BL_DATE', offsetDays: 3, instrument: 'TT' }] },
];

/** Textile specification attributes. More can be added in Settings → Product attributes. */
export const ATTRIBUTES = [
  { code: 'denier', label: 'Denier', dataType: 'NUMBER', unit: 'D', minValue: '0.1', maxValue: '200' },
  { code: 'cut_length_mm', label: 'Cut length', dataType: 'NUMBER', unit: 'mm', minValue: '1', maxValue: '200' },
  {
    code: 'cross_section',
    label: 'Cross-section',
    dataType: 'ENUM',
    enumOptions: [
      { value: 'SOLID', label: 'Solid' },
      { value: 'HOLLOW', label: 'Hollow' },
      { value: 'HOLLOW_CONJUGATED', label: 'Hollow Conjugated' },
    ],
  },
  { code: 'siliconized', label: 'Siliconized', dataType: 'BOOLEAN', trueLabel: 'Siliconized', falseLabel: 'Non-siliconized' },
  {
    code: 'color',
    label: 'Color',
    dataType: 'ENUM',
    enumOptions: [
      { value: 'RAW_WHITE', label: 'Raw White' },
      { value: 'OPTICAL_WHITE', label: 'Optical White' },
      { value: 'SEMI_DULL', label: 'Semi Dull' },
      { value: 'BLACK', label: 'Black' },
      { value: 'DOPE_DYED', label: 'Dope Dyed' },
    ],
  },
  {
    code: 'material',
    label: 'Raw material',
    dataType: 'ENUM',
    enumOptions: [
      { value: 'VIRGIN', label: 'Virgin' },
      { value: 'RECYCLED', label: 'Recycled' },
    ],
  },
  {
    code: 'grade',
    label: 'Grade',
    dataType: 'ENUM',
    enumOptions: [
      { value: 'AA', label: 'AA Grade' },
      { value: 'A', label: 'A Grade' },
      { value: 'B', label: 'B Grade' },
    ],
  },
  { code: 'low_melt_pct', label: 'Low melt share', dataType: 'NUMBER', unit: '%', minValue: '0', maxValue: '100' },
  { code: 'melt_point_c', label: 'Melting point', dataType: 'NUMBER', unit: '°C', minValue: '60', maxValue: '260' },
  {
    code: 'yarn_type',
    label: 'Yarn type',
    dataType: 'ENUM',
    enumOptions: [
      { value: 'DTY', label: 'DTY' },
      { value: 'FDY', label: 'FDY' },
      { value: 'POY', label: 'POY' },
      { value: 'SPUN', label: 'Spun' },
    ],
  },
  { code: 'filaments', label: 'Filaments', dataType: 'NUMBER', unit: 'F', minValue: '1', maxValue: '1000' },
  {
    code: 'luster',
    label: 'Luster',
    dataType: 'ENUM',
    enumOptions: [
      { value: 'SD', label: 'Semi Dull' },
      { value: 'FD', label: 'Full Dull' },
      { value: 'BR', label: 'Bright' },
    ],
  },
] as const;

type Rule = { code: string; required?: boolean; variantDefining?: boolean };

/** Category tree with specification rules. Children inherit their parents' rules. */
export const CATEGORIES: { code: string; name: string; parent?: string; sortOrder: number; rules: Rule[] }[] = [
  {
    code: 'FIBER',
    name: 'Fiber',
    sortOrder: 1,
    rules: [
      { code: 'denier', required: true },
      { code: 'cut_length_mm', required: true },
      { code: 'color', required: true },
      { code: 'material' },
      { code: 'grade' },
    ],
  },
  {
    code: 'PSF',
    name: 'Polyester Staple Fiber',
    parent: 'FIBER',
    sortOrder: 1,
    rules: [{ code: 'cross_section', required: true }, { code: 'siliconized', required: true }],
  },
  { code: 'MICRO', name: 'Microfiber', parent: 'FIBER', sortOrder: 2, rules: [{ code: 'siliconized' }] },
  {
    code: 'LOWMELT',
    name: 'Low Melt Fiber',
    parent: 'FIBER',
    sortOrder: 3,
    rules: [{ code: 'melt_point_c', required: true }, { code: 'low_melt_pct' }],
  },
  {
    code: 'YARN',
    name: 'Yarn',
    sortOrder: 2,
    rules: [
      { code: 'yarn_type', required: true },
      { code: 'denier', required: true },
      { code: 'filaments', required: true },
      { code: 'luster' },
      { code: 'color', required: true },
      { code: 'material' },
      { code: 'grade' },
    ],
  },
  { code: 'PES-YARN', name: 'Polyester Yarn', parent: 'YARN', sortOrder: 1, rules: [] },
  { code: 'OTHER', name: 'Other textile raw materials', sortOrder: 9, rules: [] },
];
