import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { httpProxy } from "utils/proxy/http";

const proxyName = "codexProxyHandler";
const logger = createLogger(proxyName);

export default async function codexProxyHandler(req, res) {
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
  const targetUrl = new URL(`${baseUrl}/codex-usage`);

  try {
    const [status, , data] = await httpProxy(targetUrl, { method: "GET" });
    if (status !== 200 || !data) {
      return res.status(200).json({
        plan: "Error",
        used: "-",
        remaining: "-",
        limit: "Proxy Error",
        reset: "n/a",
        plan_ends: "-"
      });
    }
    const parsed = JSON.parse(data.toString());
    return res.status(200).json(parsed);
  } catch (e) {
    logger.error("Error calling Codex usage API: %s", e);
    return res.status(200).json({
      plan: "Error",
      used: "-",
      remaining: "-",
      limit: "Exception",
      reset: "n/a",
      plan_ends: "-"
    });
  }
}
