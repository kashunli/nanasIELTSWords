import type { Chapter, Item, Summary } from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {error?: string};
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const getSummary = () => request<Summary>("/api/summary");
export const getChapters = () => request<Chapter[]>("/api/chapters");
export const getItems = (chapter: number | null) => {
  const params = new URLSearchParams();
  if (chapter !== null) params.set("chapter", String(chapter));
  return request<Item[]>(`/api/items?${params.toString()}`);
};
export const getItem = (stableId: string) => request<Item>(`/api/items/${encodeURIComponent(stableId)}`);
export const getBatch = (stableIds: string[]) => request<Item[]>("/api/items/batch", {
  method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({stable_ids: stableIds}),
});
