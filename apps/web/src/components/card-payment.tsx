"use client";

import { buttonClass } from "@/components/ui";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { useRef, useState } from "react";

export function CardPayment({
  invoiceId,
  publishableKey,
  balanceLabel,
}: {
  invoiceId: string;
  publishableKey: string | null;
  balanceLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentId = useRef<string | null>(null);

  async function start() {
    setError(null);
    if (!publishableKey) {
      setError("Add a pk_test_ key to take a card in Stripe test mode.");
      return;
    }
    const response = await fetch(`/api/v1/invoices/${invoiceId}/payment-intent`, { method: "POST" });
    const body = (await response.json()) as { message?: string; data?: { clientSecret: string; paymentId: string } };
    if (!response.ok || !body.data?.clientSecret) {
      setError(body.message ?? "Could not start the card payment.");
      return;
    }
    const stripe = await loadStripe(publishableKey);
    if (!stripe) {
      setError("Stripe.js did not load.");
      return;
    }
    const elements = stripe.elements({ clientSecret: body.data.clientSecret });
    const payment = elements.create("payment");
    payment.mount(mountRef.current!);
    stripeRef.current = stripe;
    elementsRef.current = elements;
    paymentId.current = body.data.paymentId;
    setReady(true);
  }

  async function confirm() {
    setError(null);
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements || !paymentId.current) return;
    const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (result.error) {
      setError(result.error.message ?? "The card was not charged.");
      return;
    }
    await fetch(`/api/v1/invoices/${invoiceId}/payment-intent/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentId: paymentId.current }),
    });
    setDone(true);
    window.location.reload();
  }

  if (done) return <p className="text-sm text-ok">Payment recorded. Refresh if the balance is still showing.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Card payments use Stripe test mode and take the remaining balance ({balanceLabel}). Use card 4242 4242 4242 4242.</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div ref={mountRef} />
      {ready ? (
        <button className={buttonClass} type="button" onClick={confirm}>
          Charge card
        </button>
      ) : (
        <button className={buttonClass} type="button" onClick={start} disabled={!publishableKey}>
          {publishableKey ? "Take a card" : "Stripe test keys not set"}
        </button>
      )}
    </div>
  );
}
