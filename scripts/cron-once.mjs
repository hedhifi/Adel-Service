const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
const secret = process.env.CRON_SECRET ?? "";

if (!base.startsWith("http://") && !base.startsWith("https://")) {
  console.error("APP_URL must be the hosted origin, including https://");
  process.exit(1);
}

const response = await fetch(`${base}/api/cron/run`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});
const text = await response.text();
console.log(response.status, text);
if (!response.ok) process.exit(1);
