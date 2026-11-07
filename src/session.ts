export async function connectSession() {
  const original = window.fetch.bind(window);
  const ticket = new URLSearchParams(location.hash.slice(1)).get("session");
  if (ticket) history.replaceState(null, "", location.pathname + location.search);
  const response = await original("/api/session", ticket ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket }),
  } : undefined);
  if (!response.ok) throw Error("Open PixelCrew using its launcher to connect securely.");
  const { csrf } = await response.json();
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return original(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (csrf) headers.set("X-PixelCrew-CSRF", csrf);
    return original(input, { ...init, headers });
  };
}
