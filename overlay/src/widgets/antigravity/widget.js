import antigravityProxyHandler from "./proxy";

const widget = {
  proxyHandler: antigravityProxyHandler,
  allowedEndpoints: /stats/,
};

export default widget;
