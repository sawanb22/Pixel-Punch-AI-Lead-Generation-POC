export function canonicalDomain(website: string | null): string | null {
  if (!website) return null;
  let s = website.trim().toLowerCase();
  if (s.length === 0) return null;
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  s = s.split("#")[0];
  s = s.replace(/:\d+$/, ""); // strip port
  return s.length > 0 ? s : null;
}
