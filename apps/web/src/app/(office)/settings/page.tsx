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
        <Link className="font-semibold text-pine" href="/settings/terms">
          Speech dictionary
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
          <Field label="Tracking hours start">
            <input className={inputClass} name="trackingStart" defaultValue={settings.trackingStart} required />
          </Field>
          <Field label="Tracking hours end">
            <input className={inputClass} name="trackingEnd" defaultValue={settings.trackingEnd} required />
          </Field>
          <Field label="Keep location points (days)">
            <input className={inputClass} name="locationRetentionDays" type="number" min={1} defaultValue={settings.locationRetentionDays} required />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="reportRemindersEnabled" defaultChecked={settings.reportRemindersEnabled} />
            Remind a technician after they leave a visit if notes or photos are missing
          </label>
          <Field label="Reminder grace (minutes)">
            <input className={inputClass} name="reportReminderGraceMinutes" type="number" min={0} defaultValue={Math.round(settings.reportReminderGraceSeconds / 60)} required />
          </Field>
          <p className="text-xs text-muted">Company policy point for counsel review. This is not legal advice. Tracking is disclosed, limited to these hours, and starts only after the technician acknowledges the notice. There is no covert mode.</p>
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
