import { Field, Flash, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { updateSettingsAction } from "@/server/actions";
import { requireOffice } from "@/server/session";
import { getCompanySettings } from "@adel/core";
import Link from "next/link";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; forbidden?: string }>;
}) {
  const actor = await requireOffice();
  const query = await searchParams;
  const settings = await getCompanySettings();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings" lede="Adel Electric, LLC runs as one company. Adel Electric and HED are brands on the same books." />
      <Flash error={query.error} notice={query.notice} forbidden={query.forbidden} />
      <div className="flex flex-wrap gap-3 text-sm">
        <Link className="font-semibold text-pine" href="/settings/team">
          People
        </Link>
        <Link className="font-semibold text-pine" href="/settings/tokens">
          API tokens
        </Link>
        <Link className="font-semibold text-pine" href="/settings/webhooks">
          Webhooks
        </Link>
        <a className="font-semibold text-pine" href="/api/openapi">
          OpenAPI
        </a>
      </div>
      {actor.role === "admin" ? (
        <form action={updateSettingsAction} className="space-y-3">
          <Field label="Legal name">
            <input className={inputClass} name="legalName" defaultValue={settings.legalName} required />
          </Field>
          <Field label="Shop address">
            <input className={inputClass} name="shopAddress" defaultValue={settings.shopAddress} required />
          </Field>
          <Field label="Time zone">
            <select className={inputClass} name="timeZone" defaultValue={settings.timeZone}>
              <option value="America/New_York">Eastern (most of Florida)</option>
              <option value="America/Chicago">Central (panhandle)</option>
            </select>
          </Field>
          <Field label="Default tax percent">
            <input className={inputClass} name="taxPercent" defaultValue={(settings.defaultTaxRateBps / 100).toFixed(2)} required />
          </Field>
          <Field label="Tax label">
            <input className={inputClass} name="taxLabel" defaultValue={settings.taxLabel} required />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requireSignatureToComplete" defaultChecked={settings.requireSignatureToComplete} />
            Technicians must capture a signature to complete a visit
          </label>
          <button className={buttonClass} type="submit">
            Save
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">Tax is {settings.taxLabel} at {(settings.defaultTaxRateBps / 100).toFixed(2)}%. An admin can change it.</p>
      )}
    </div>
  );
}
