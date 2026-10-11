const discoveryTimeoutMs = 8000;
const localIconPattern = /^\/api\/config\/icon\/discovered-[a-f0-9]{64}\.(?:gif|ico|jpg|png|svg|webp)$/;

// Best effort, only for newly created entries; explicit choices always win.
export async function discoverNewItemIcon(modal, config, request = fetch) {
  if (
    modal?.mode === "edit" ||
    !["services", "bookmarks"].includes(modal?.type) ||
    (config?.icon != null && (typeof config.icon !== "string" || config.icon.trim() !== "")) ||
    typeof config?.href !== "string" || !/^https?:\/\//i.test(config.href.trim())
  ) {
    return config;
  }

  let url;
  try {
    url = new URL(config.href.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return config;
  } catch {
    return config;
  }

  const controller = new AbortController();
  let timeoutId;
  try {
    // Race as well as abort so a stalled request never blocks saving indefinitely.
    return await Promise.race([
      (async () => {
        const response = await request("/api/config/icon/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.toString() }),
          signal: controller.signal,
        });
        if (!response.ok) return config;
        const result = await response.json();
        return result?.success === true && typeof result.localIcon === "string" && localIconPattern.test(result.localIcon)
          ? { ...config, icon: result.localIcon }
          : config;
      })(),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          resolve(config);
        }, discoveryTimeoutMs);
      }),
    ]);
  } catch {
    return config;
  } finally {
    clearTimeout(timeoutId);
  }
}
