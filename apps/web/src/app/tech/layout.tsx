import { FieldStatus } from "@/components/field-status";
import { LocationReporter } from "@/components/location-reporter";
import { logoutAction, switchEntityAction } from "@/server/actions";
import { requireUser } from "@/server/session";
import Link from "next/link";

export default async function TechLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  return (
    <div className="mx-auto min-h-screen max-w-lg pb-16">
      <header className="flex items-center justify-between bg-pine px-4 py-3 text-[#f6f1e6]">
        <Link href="/tech">
          <span className="font-serif text-xl">Adel</span>
          <span className="block text-xs text-[#d7c7ae]">Field</span>
        </Link>
        <div className="text-right text-xs">
          <p>{actor.name}</p>
          <form action={switchEntityAction} className="mt-1 flex justify-end gap-1">
            <select name="entityId" defaultValue={actor.entityId} className="max-w-36 rounded bg-[#f6f1e6] px-1 text-pine" aria-label="Company">
              {actor.entities.map((entity) => (
                <option key={entity.entityId} value={entity.entityId}>
                  {entity.name}
                </option>
              ))}
            </select>
            <button className="text-[#d7c7ae]" type="submit">
              Use
            </button>
          </form>
          {actor.role !== "tech" ? (
            <Link className="underline" href="/">
              Office
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button className="text-[#d7c7ae]" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="px-4 py-4">
        <FieldStatus />
        <LocationReporter />
        {children}
      </main>
    </div>
  );
}
