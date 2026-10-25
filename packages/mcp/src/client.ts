export type ApiResult = { ok: true; status: number; body: unknown } | { ok: false; status: number; body: unknown };

export function apiConfig() {
  const base = process.env.ADEL_API_BASE?.replace(/\/$/, "");
  const token = process.env.ADEL_API_TOKEN;
  if (!base || !token) {
    throw new Error("Set ADEL_API_BASE (for example http://localhost:3000) and ADEL_API_TOKEN (an adel_ token).");
  }
  return { base, token };
}

export async function api(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const { base, token } = apiConfig();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  } else {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, body: parsed };
}
