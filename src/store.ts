import type { Favorite, Scan } from "./types";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno o bloqueado */
  }
}

export const settings = {
  get apiKey() {
    return read<string>("armario.apiKey", "");
  },
  set apiKey(v: string) {
    write("armario.apiKey", v);
  },
  get country() {
    return read<string>("armario.country", "España (precios en EUR)");
  },
  set country(v: string) {
    write("armario.country", v);
  },
};

const MAX_SCANS = 20;

export function getScans(): Scan[] {
  return read<Scan[]>("armario.scans", []);
}

export function saveScan(scan: Scan) {
  const scans = getScans().filter((s) => s.id !== scan.id);
  scans.unshift(scan);
  write("armario.scans", scans.slice(0, MAX_SCANS));
}

export function deleteScan(id: string) {
  write("armario.scans", getScans().filter((s) => s.id !== id));
}

export function getFavorites(): Favorite[] {
  return read<Favorite[]>("armario.favs", []);
}

export function isFavorite(url: string) {
  return getFavorites().some((f) => f.url === url);
}

export function toggleFavorite(fav: Favorite): boolean {
  const favs = getFavorites();
  const idx = favs.findIndex((f) => f.url === fav.url);
  if (idx >= 0) {
    favs.splice(idx, 1);
    write("armario.favs", favs);
    return false;
  }
  favs.unshift(fav);
  write("armario.favs", favs);
  return true;
}
