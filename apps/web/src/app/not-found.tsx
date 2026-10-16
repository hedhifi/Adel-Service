import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-serif text-4xl">That page isn't here</h1>
      <p className="mt-2 text-sm text-muted">Check the link, or go back to the office board.</p>
      <Link className="mt-4 inline-block font-semibold text-pine" href="/">
        Back to today
      </Link>
    </main>
  );
}
