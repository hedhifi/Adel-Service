import Link from "next/link";

export const inputClass =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-ink outline-none focus:border-pine";
export const buttonClass =
  "inline-flex items-center justify-center rounded-md bg-pine px-3 py-2 text-sm font-semibold text-white hover:bg-pine-2";
export const ghostClass =
  "inline-flex items-center justify-center rounded-md border border-line bg-card px-3 py-2 text-sm font-semibold text-ink hover:border-pine";
export const dangerClass =
  "inline-flex items-center justify-center rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm font-semibold text-danger";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}

export function Flash({
  error,
  notice,
  forbidden,
}: {
  error?: string;
  notice?: string;
  forbidden?: string;
}) {
  const message = error || (forbidden ? "You don't have access to that." : undefined);
  if (!message && !notice) return null;
  if (message) {
    return (
      <p className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
        {message}
      </p>
    );
  }
  return <p className="rounded-md border border-ok/30 bg-ok-bg px-3 py-2 text-sm text-ok">{notice}</p>;
}

export function PageHeader({
  title,
  lede,
  action,
}: {
  title: string;
  lede?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-3xl text-ink">{title}</h1>
        {lede ? <p className="mt-1 max-w-2xl text-sm text-muted">{lede}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-card p-4 ${className}`}>{children}</section>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

const tones: Record<string, string> = {
  new: "bg-[#efe7d6] text-[#5c4a2a]",
  reviewing: "bg-[#efe7d6] text-[#5c4a2a]",
  quoted: "bg-[#e7efe9] text-pine",
  scheduled: "bg-[#e7efe9] text-pine",
  sent: "bg-[#f6e7dc] text-copper",
  approved: "bg-ok-bg text-ok",
  completed: "bg-ok-bg text-ok",
  paid: "bg-ok-bg text-ok",
  on_site: "bg-[#f6e7dc] text-copper",
  en_route: "bg-[#f6e7dc] text-copper",
  in_progress: "bg-[#f6e7dc] text-copper",
  partial: "bg-[#f6e7dc] text-copper",
  issued: "bg-[#e7eef6] text-[#1e3a5f]",
  draft: "bg-[#eeeae3] text-[#5c564c]",
  declined: "bg-danger-bg text-danger",
  canceled: "bg-danger-bg text-danger",
  void: "bg-[#eeeae3] text-[#5c564c]",
  closed: "bg-[#eeeae3] text-[#5c564c]",
  unscheduled: "bg-[#eeeae3] text-[#5c564c]",
  failed: "bg-danger-bg text-danger",
  processing: "bg-[#efe7d6] text-[#5c4a2a]",
  succeeded: "bg-ok-bg text-ok",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${tones[status] ?? "bg-[#eeeae3]"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function BrandChip({ name }: { name: string }) {
  const hed = name === "HED";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${hed ? "text-[#312e81]" : "text-copper"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${hed ? "bg-[#312e81]" : "bg-copper"}`} />
      {name}
    </span>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-pine underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
