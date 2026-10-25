import { sql } from "@adel/db";

type Row = {
  id: string;
  name: string;
  brand_id: string;
  property_id: string | null;
  label: string | null;
  city: string | null;
};

export async function loadPicker() {
  const rows = await sql<Row[]>`
    select c.id, c.name, c.brand_id, p.id as property_id, p.label, p.city
    from customers c
    left join properties p on p.customer_id = c.id
    order by c.name, p.label
  `;
  const map = new Map<string, { id: string; name: string; brandId: string; properties: Array<{ id: string; label: string; city: string }> }>();
  for (const row of rows) {
    const current = map.get(row.id) ?? { id: row.id, name: row.name, brandId: row.brand_id, properties: [] };
    if (row.property_id && row.label && row.city) {
      current.properties.push({ id: row.property_id, label: row.label, city: row.city });
    }
    map.set(row.id, current);
  }
  return [...map.values()].filter((customer) => customer.properties.length > 0);
}
