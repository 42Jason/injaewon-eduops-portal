/**
 * Small helpers for talking to the Electron preload API.
 * When `window.api` is missing (e.g. a plain browser preview of the Vite build)
 * these helpers resolve to `null` / `[]` so the UI can still render mock data.
 */

export function getApi(): NonNullable<Window['api']> | null {
  return typeof window !== 'undefined' && window.api ? window.api : null;
}

export function hasApi(): boolean {
  return getApi() !== null;
}
