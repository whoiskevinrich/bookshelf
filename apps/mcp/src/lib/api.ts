export async function apiFetch(
  url: string,
  idToken: string,
  options?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(options?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (err) {
    return { ok: false, status: 0, data: { error: `Network error: ${String(err)}` } };
  }

  if (res.status === 204) return { ok: true, status: 204, data: null };
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function apiError(status: number, data: unknown): string {
  const msg = (data as Record<string, unknown>)?.["error"] ?? "Unknown error";
  return `API error (${status}): ${String(msg)}`;
}

const textContent = (text: string) => ({ type: "text" as const, text });

export const okResult = (data: unknown) => ({
  content: [textContent(JSON.stringify(data, null, 2))],
});

export const errResult = (status: number, data: unknown) => ({
  content: [textContent(apiError(status, data))],
  isError: true as const,
});
