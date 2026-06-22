import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { httpProxy } from "utils/proxy/http";

const proxyName = "torrsyncarrProxyHandler";
const logger = createLogger(proxyName);

export default async function torrsyncarrProxyHandler(req, res) {
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

  // Fetch /api/imported
  const importedUrl = new URL(`${baseUrl}/api/imported`);
  const [importedStatus, , importedData] = await httpProxy(importedUrl, { method: "GET" });

  // Fetch /api.php?action=get_not_imported
  const notImportedUrl = new URL(`${baseUrl}/api.php?action=get_not_imported`);
  const [notImportedStatus, , notImportedData] = await httpProxy(notImportedUrl, { method: "GET" });

  let movies = 0;
  let series = 0;
  let anime = 0;
  let cartoons = 0;
  let notImportedCount = 0;

  if (importedStatus === 200 && importedData) {
    try {
      const parsed = JSON.parse(importedData.toString());
      if (parsed && Array.isArray(parsed.items)) {
        parsed.items.forEach((item) => {
          const pathLower = (item.path || "").toLowerCase();
          if (pathLower.includes("/movies/")) {
            movies++;
          } else if (pathLower.includes("/series/")) {
            series++;
          } else if (pathLower.includes("/anime/")) {
            anime++;
          } else if (pathLower.includes("/cartoons/")) {
            cartoons++;
          } else {
            if (item.type === "movie") {
              movies++;
            } else if (item.type === "series") {
              series++;
            }
          }
        });
      }
    } catch (e) {
      logger.error("Error parsing imported media: %s", e);
    }
  }

  if (notImportedStatus === 200 && notImportedData) {
    try {
      const parsed = JSON.parse(notImportedData.toString());
      if (parsed && Array.isArray(parsed.data)) {
        notImportedCount = parsed.data.length;
      }
    } catch (e) {
      logger.error("Error parsing not imported media: %s", e);
    }
  }

  return res.status(200).json({
    movies,
    series,
    anime,
    cartoons,
    waitingForImport: notImportedCount,
  });
}
