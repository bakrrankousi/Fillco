import type { AddressDto, ContactDto } from '@fillco/contracts';
import type { Prisma } from '@fillco/db';

type ContactRow = Prisma.CustomerContactGetPayload<object> | Prisma.SupplierContactGetPayload<object>;
type AddressRow = Prisma.CustomerAddressGetPayload<object> | Prisma.SupplierAddressGetPayload<object>;

export function contactDto(c: ContactRow): ContactDto {
  return {
    id: c.id,
    name: c.name,
    position: c.position,
    phone: c.phone,
    email: c.email,
    whatsapp: c.whatsapp,
    isPrimary: c.isPrimary,
    notes: c.notes,
  };
}

export function addressDto(a: AddressRow): AddressDto {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    isDefault: a.isDefault,
  };
}
