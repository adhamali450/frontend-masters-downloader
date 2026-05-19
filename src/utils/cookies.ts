import { readFile, writeFile } from "node:fs/promises";
import type { Cookie } from "playwright";

export async function saveCookies(filePath: string, cookies: Cookie[]): Promise<void> {
  await writeFile(filePath, JSON.stringify(cookies, null, 2), "utf-8");
}

export async function loadCookies(filePath: string): Promise<Cookie[]> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as Cookie[];
}

export function cookiesToHeader(cookies: Cookie[]): Record<string, string> {
  if (cookies.length === 0) return {};
  return { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}
