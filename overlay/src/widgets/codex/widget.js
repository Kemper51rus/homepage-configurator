import codexProxyHandler from "./proxy";

const widget = {
  proxyHandler: codexProxyHandler,
  allowedEndpoints: /stats/,
};

export default widget;
