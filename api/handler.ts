import app from "../apps/server/src/index.js";

export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    const apiPath = url.searchParams.get("path") ?? "";
    url.searchParams.delete("path");
    url.pathname = `/api/${apiPath}`;
    return app.fetch(new Request(url, request));
  }
};
