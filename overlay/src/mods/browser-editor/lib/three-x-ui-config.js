export const threeXuiSourcePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const threeXuiInternalApiPath = "/api/config/three-x-ui";
export const threeXuiDefaultSource = "main";
export const threeXuiDefaultRefreshInterval = 30000;

export const threeXuiMetricDefinitions = [
  { key: "tcp", label: "TCP-соединения", format: "number", default: true },
  { key: "udp", label: "UDP-соединения", format: "number", default: true },
  { key: "online", label: "Клиенты онлайн", format: "number", default: true },
  { key: "sent", label: "Отправлено", format: "bytes", default: true },
  { key: "received", label: "Получено", format: "bytes", default: true },
  {
    key: "xrayState",
    label: "Состояние Xray",
    format: "text",
    remap: [
      { value: "running", to: "Работает" },
      { value: "stop", to: "Остановлен" },
      { value: "error", to: "Ошибка" },
    ],
  },
];

const metricByKey = new Map(threeXuiMetricDefinitions.map((metric) => [metric.key, metric]));

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function responseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "obj")) {
    return value.obj;
  }
  return value;
}

export function aggregateThreeXuiSummary(statusResponse, onlineResponse) {
  const status = responseObject(statusResponse) ?? {};
  const online = responseObject(onlineResponse);

  return {
    tcp: finiteNumber(status.tcpCount),
    udp: finiteNumber(status.udpCount),
    online: Array.isArray(online) ? online.length : 0,
    sent: finiteNumber(status.netTraffic?.sent),
    received: finiteNumber(status.netTraffic?.recv),
    xrayState: String(status.xray?.state ?? ""),
  };
}

export function defaultThreeXuiMetricKeys() {
  return threeXuiMetricDefinitions.filter((metric) => metric.default).map((metric) => metric.key);
}

export function threeXuiMetricKeysFromWidget(widget) {
  const selected = Array.isArray(widget?.mappings)
    ? widget.mappings
        .map((mapping) => String(mapping?.field ?? ""))
        .filter((field) => metricByKey.has(field))
    : [];
  return selected.length ? [...new Set(selected)] : defaultThreeXuiMetricKeys();
}

export function threeXuiMappings(metricKeys) {
  const selected = new Set(Array.isArray(metricKeys) ? metricKeys : []);
  return threeXuiMetricDefinitions
    .filter((metric) => selected.has(metric.key))
    .map(({ key, label, format, suffix, remap }) => ({
      field: key,
      label,
      format,
      ...(suffix ? { suffix } : {}),
      ...(remap ? { remap } : {}),
    }));
}

export function threeXuiSourceFromWidget(widget) {
  if (widget?.type !== "customapi" || typeof widget.url !== "string") {
    return "";
  }

  try {
    const url = new URL(widget.url);
    if (url.pathname !== threeXuiInternalApiPath) {
      return "";
    }
    const source = url.searchParams.get("source") ?? "";
    return threeXuiSourcePattern.test(source) ? source : "";
  } catch {
    return "";
  }
}

export function isThreeXuiWidget(widget) {
  return Boolean(threeXuiSourceFromWidget(widget));
}

export function buildThreeXuiWidget(
  source = threeXuiDefaultSource,
  metricKeys = defaultThreeXuiMetricKeys(),
  internalBaseUrl = "http://127.0.0.1:3000",
) {
  const safeSource = threeXuiSourcePattern.test(source) ? source : threeXuiDefaultSource;
  const safeInternalBaseUrl = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(
    internalBaseUrl,
  )
    ? internalBaseUrl.replace(/\/+$/, "")
    : "http://127.0.0.1:3000";
  return {
    type: "customapi",
    url: `${safeInternalBaseUrl}${threeXuiInternalApiPath}?source=${encodeURIComponent(safeSource)}`,
    refreshInterval: threeXuiDefaultRefreshInterval,
    mappings: threeXuiMappings(metricKeys),
  };
}
