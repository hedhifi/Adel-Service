"use client";

import { inputClass } from "@/components/ui";
import { useMemo, useState } from "react";

export type PickerCustomer = {
  id: string;
  name: string;
  brandId: string;
  properties: Array<{ id: string; label: string; city: string }>;
};

export function CustomerPicker({
  customers,
  customerId,
  propertyId,
  brandId,
}: {
  customers: PickerCustomer[];
  customerId?: string;
  propertyId?: string;
  brandId?: string;
}) {
  const [selected, setSelected] = useState(customerId || customers[0]?.id || "");
  const properties = useMemo(() => customers.find((customer) => customer.id === selected)?.properties ?? [], [customers, selected]);
  const brand = customers.find((customer) => customer.id === selected)?.brandId ?? brandId ?? "";

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Customer</span>
        <select className={inputClass} name="customerId" value={selected} onChange={(event) => setSelected(event.target.value)} required>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Service location</span>
        <select className={inputClass} name="propertyId" defaultValue={propertyId || properties[0]?.id} required>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.label} · {property.city}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="brandId" value={brand} />
    </div>
  );
}
