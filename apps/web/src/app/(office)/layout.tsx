import { OfficeNav } from "@/components/office-nav";
import { requireOffice } from "@/server/session";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireOffice();
  return (
    <div className="md:grid md:grid-cols-[232px_1fr]">
      <OfficeNav name={actor.name} role={actor.role} />
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
