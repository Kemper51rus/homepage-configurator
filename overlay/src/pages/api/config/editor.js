import handler from "mods/browser-editor/api/editor";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export default handler;
