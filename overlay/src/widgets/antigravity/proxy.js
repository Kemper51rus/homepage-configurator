import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { httpProxy } from "utils/proxy/http";

const proxyName = "antigravityProxyHandler";
const logger = createLogger(proxyName);

export default async function antigravityProxyHandler(req, res) {
  const { group, service, index } = req.query;

  if (!group || !service) {
    logger.debug("Invalid or missing service '%s' or group '%s'", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  const widget = await getServiceWidget(group, service, index);

  if (!widget) {
    logger.debug("Invalid or missing widget for service '%s' in group '%s'", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  const baseUrl = widget.url.replace(/\/+$/, "");
  const targetUrl = new URL(`${baseUrl}/antigravity-usage`);

  try {
    const [status, , data] = await httpProxy(targetUrl, { method: "GET" });
    if (status !== 200 || !data) {
      return res.status(200).json({
        plan: "Error",
        limit: "Proxy Error",
        remaining: "-",
        used: "-",
        reset: "n/a"
      });
    }
    const parsed = JSON.parse(data.toString());
    return res.status(200).json(parsed);
  } catch (e) {
    logger.error("Error calling Antigravity usage API: %s", e);
    return res.status(200).json({
      plan: "Error",
      limit: "Exception",
      remaining: "-",
      used: "-",
      reset: "n/a"
    });
  }
}
