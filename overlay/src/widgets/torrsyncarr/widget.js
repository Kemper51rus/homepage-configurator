import torrsyncarrProxyHandler from "./proxy";

const widget = {
  api: "{url}/{endpoint}",
  proxyHandler: torrsyncarrProxyHandler,

  mappings: {
    stats: {
      endpoint: "stats",
    },
  },
};

export default widget;
