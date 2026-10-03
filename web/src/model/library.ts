export type LibraryFileKind = "ephemeris" | "almanac" | "antenna" | "precise-orbit" | "precise-clock" | "other";

export type LibraryFileRecord = {
  id: string;
  revision: number;
  name: string;
  extension: string;
  kind: LibraryFileKind;
  size: number;
  digest: string;
  created: number;
};

export function libraryFileName(value: string): string {
  const name = value.replaceAll("\\", "/").split("/").at(-1)?.trim() ?? "";
  if (name === "" || name === "." || name === ".." || name.includes("\0")) throw new Error("Choose a filename");
  return name;
}

export function libraryFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function identifyLibraryFile(name: string, bytes: Uint8Array): LibraryFileKind {
  const text = new TextDecoder().decode(bytes.subarray(0, 65_536)).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  if (first.includes("ANTEX VERSION / SYST")) return "antenna";
  if (first.includes("RINEX VERSION / TYPE")) {
    const type = first[20]?.toUpperCase();
    if (type === "C" || /CLOCK DATA/i.test(first)) return "precise-clock";
    if (type === "N" || type === "G" || type === "H" || /NAVIGATION|NAV DATA/i.test(first)) return "ephemeris";
    return "other";
  }
  if (/^#[a-d][PV]\s*\d{4}\s/i.test(first)) return "precise-orbit";
  if (/\bID\s*:\s*\d+/i.test(text) && /\bEccentricity\s*:/i.test(text) && /Time of Applicability/i.test(text)) return "almanac";
  if (/<issueDate[\s>]/i.test(text) && /<svAlmanac[\s>]/i.test(text)) return "almanac";
  const extension = libraryFileExtension(name);
  if (["atx", "antex"].includes(extension)) return "antenna";
  if (extension === "sp3") return "precise-orbit";
  if (extension === "clk") return "precise-clock";
  if (["alm", "al3", "sem", "yuma", "agl"].includes(extension)) return "almanac";
  if (extension === "nav" || /^\d{2}[nglhp]$/.test(extension)) return "ephemeris";
  return "other";
}
