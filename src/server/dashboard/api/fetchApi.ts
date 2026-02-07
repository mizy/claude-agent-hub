/**
 * API fetch wrapper
 *
 * All API responses wrap data in `{ success, data, error }`.
 * For GET endpoints that return arrays/objects directly (tasks list, task detail, timeline),
 * the response IS the data.
 */
export async function fetchApi<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, options)
    if (!res.ok) return null

    const json = await res.json()

    // Some endpoints return { success, data }, others return raw data
    if (json && typeof json === 'object' && 'data' in json) {
      return json.data as T
    }
    return json as T
  } catch {
    return null
  }
}

export async function postApi<T>(url: string, body?: unknown): Promise<T | null> {
  return fetchApi<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

export async function deleteApi<T>(url: string): Promise<T | null> {
  return fetchApi<T>(url, { method: 'DELETE' })
}
