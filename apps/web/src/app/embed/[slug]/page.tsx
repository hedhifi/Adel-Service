import { ReceptionistWidget, type ReceptionistChat } from "@/components/receptionist-widget";
import { AppError, startReceptionistConversation } from "@adel/core";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EmbedChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const language = query.lang === "es" ? "es" : "en";
  let started: { data: ReceptionistChat };
  try {
    started = (await startReceptionistConversation({ entitySlug: slug, channel: "web", language })) as { data: ReceptionistChat };
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
  const entityName = started.data.conversation.entityName;
  const spanish = language === "es";
  return (
    <main className="min-h-screen bg-paper px-4 py-8">
      <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1fr_24rem] md:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-copper">{entityName}</p>
          <h1 className="mt-2 font-serif text-4xl">{spanish ? "Hable con la oficina" : "Talk with the office"}</h1>
          <p className="mt-3 max-w-xl text-sm text-muted">
            {spanish
              ? "Este chat es solo para esta empresa. La otra compañía no ve la conversación."
              : "This chat belongs to this company only. The other company does not see the conversation."}
          </p>
          <p className="mt-6 text-sm">
            <a className="font-semibold text-pine" href={spanish ? `/embed/${slug}` : `/embed/${slug}?lang=es`}>
              {spanish ? "English" : "Español"}
            </a>
          </p>
        </div>
        <ReceptionistWidget initial={started.data} />
      </div>
    </main>
  );
}
