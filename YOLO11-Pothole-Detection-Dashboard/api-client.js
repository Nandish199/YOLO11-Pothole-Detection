// Central API configuration for dashboard requests.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api/v1';
const AUTH_TOKEN_KEY = 'yolo11_access_token';
let accessToken = sessionStorage.getItem(AUTH_TOKEN_KEY);

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token;
  if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  else sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

export function apiUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = new URL(API_BASE_URL, window.location.origin);
  const prefix = base.pathname.replace(/\/+$/, '');
  const value = String(path);
  const route = value === prefix || value.startsWith(`${prefix}/`)
    ? value
    : `${prefix}/${value.replace(/^\/+/, '')}`;
  return new URL(route, base.origin).href;
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(apiUrl(path), { ...options, headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (response.status === 401 && accessToken && !path.startsWith('/auth/token') && !path.startsWith('/auth/register')) {
      setAccessToken(null);
      window.dispatchEvent(new Event('auth:expired'));
    }
    throw new Error(detail.detail || `API request failed (${response.status})`);
  }
  return response;
}

export async function apiRequest(path, options = {}) {
  const response = await apiFetch(path, options);
  if (response.status === 204) return null;
  return response.json();
}

export async function apiBlob(path, options = {}) {
  const response = await apiFetch(path, options);
  return response.blob();
}
