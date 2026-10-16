"use client";

import { logoutAction } from "@/server/actions";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Today"],
  ["/schedule", "Dispatch"],
  ["/requests", "Requests"],
  ["/quotes", "Estimates"],
  ["/jobs", "Jobs"],
  ["/invoices", "Invoices"],
  ["/customers", "Customers"],
  ["/settings", "Settings"],
];

export function OfficeNav({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  return (
    <aside className="no-print border-b border-line bg-pine text-[#f6f1e6] md:min-h-screen md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-3 px-4 py-4 md:block">
        <Link href="/" className="block">
          <span className="font-serif text-xl leading-none">Adel Service</span>
          <span className="mt-1 block text-xs text-[#d7c7ae]">Adel Electric · HED</span>
        </Link>
        <p className="text-xs md:mt-4">
          {name}
          <span className="block capitalize text-[#d7c7ae]">{role}</span>
        </p>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:block md:space-y-1 md:px-3">
        {links.map(([href, label]) => {
          const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm ${active ? "bg-[#f6f1e6] text-pine" : "hover:bg-white/10"}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <form action={logoutAction} className="px-3 pb-4">
        <button className="text-sm text-[#d7c7ae] underline-offset-2 hover:underline" type="submit">
          Sign out
        </button>
      </form>
    </aside>
  );
}
