// Every window.api.* call resolves to { ok: true, data } or { ok: false, error }
// (see electron/ipc/handlers.ts). This turns that into a plain throwing async
// call, matching the `if (error) throw error` pattern already used
// throughout the app's react-query mutations/queries — so most call sites
// only need their data source swapped, not restructured.

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
