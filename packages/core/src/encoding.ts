/**
 * Cross-platform base64 JSON encoding — needs to work identically in the
 * Node-based server/demo-api and the browser-based demo-agent, so this
 * avoids Node's Buffer and uses whichever primitive is available.
 */
export function toBase64(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json, "utf-8").toString("base64");
}

export function fromBase64<T>(encoded: string): T {
  let json: string;
  if (typeof atob === "function") {
    json = decodeURIComponent(escape(atob(encoded)));
  } else {
    json = Buffer.from(encoded, "base64").toString("utf-8");
  }
  return JSON.parse(json) as T;
}
