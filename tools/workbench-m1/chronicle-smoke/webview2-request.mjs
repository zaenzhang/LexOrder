import assert from "node:assert/strict";

export function webViewRequest(page, desktopOrigin) {
  // The request client shares the test WebView's real local workspace session.
  const api = page.context().request;
  return async (route, body, expected = 200) => {
    assert(route.startsWith("/api/") && !route.startsWith("//"));
    const response = await api.fetch(desktopOrigin + route, {
      method: body ? "POST" : "GET", headers: { Origin: desktopOrigin },
      ...(body instanceof FormData ? { multipart: body } : body && { data: body }),
      maxRedirects: 0, timeout: 45_000,
    });
    if (response.status() !== expected) {
      const { error } = await response.json().catch(() => ({}));
      throw new Error(route.split("?")[0] + " returned " + response.status() + (error ? " · " + error : ""));
    }
    return response;
  };
}
