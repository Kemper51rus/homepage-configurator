const EDITOR_TOKEN_STORAGE_KEY = "homepage-editor-token";

function storedEditorToken() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(EDITOR_TOKEN_STORAGE_KEY) ?? "";
}

function askForEditorToken() {
  if (typeof window === "undefined") {
    return "";
  }

  const token = window.prompt("Введите токен редактора Homepage")?.trim() ?? "";
  if (token) {
    window.localStorage.setItem(EDITOR_TOKEN_STORAGE_KEY, token);
  }

  return token;
}

export async function editorWriteFetch(url, options = {}, retryWithPrompt = true) {
  const headers = new Headers(options.headers ?? {});
  const token = storedEditorToken();

  if (token) {
    headers.set("X-Homepage-Editor-Token", token);
  }

  let response = await fetch(url, { ...options, headers });
  if (response.status !== 401 || !retryWithPrompt) {
    return response;
  }

  const nextToken = askForEditorToken();
  if (!nextToken) {
    return response;
  }

  headers.set("X-Homepage-Editor-Token", nextToken);
  response = await fetch(url, { ...options, headers });
  if (response.status === 401 && typeof window !== "undefined") {
    window.localStorage.removeItem(EDITOR_TOKEN_STORAGE_KEY);
  }

  return response;
}
