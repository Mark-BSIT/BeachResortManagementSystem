import * as SecureStore from "expo-secure-store";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.251.107.28:4000/api";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await SecureStore.getItemAsync("brms_access_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response
    .json()
    .catch(() => ({ error: "Unable to read server response" }));
  if (!response.ok)
    throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}
export const saveToken = (token: string) =>
  SecureStore.setItemAsync("brms_access_token", token);
export const clearToken = () =>
  SecureStore.deleteItemAsync("brms_access_token");
