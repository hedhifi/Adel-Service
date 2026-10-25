"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-serif text-4xl">Something broke</h1>
      <p className="mt-2 text-sm text-muted">Reload this page. If it keeps happening, check the server log.</p>
      <button className="mt-4 rounded-md bg-pine px-3 py-2 text-sm font-semibold text-white" type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
