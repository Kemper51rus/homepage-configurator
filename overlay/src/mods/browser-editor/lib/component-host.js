const componentIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const EDITOR_COMPONENT_HOST_VERSION = 1;

export function validateInstalledEditorComponents(components) {
  if (!Array.isArray(components)) {
    throw new TypeError("Installed editor component registry must be an array");
  }

  const ids = new Set();
  return components.map((component, index) => {
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      throw new TypeError(`Installed editor component at index ${index} must be an object`);
    }
    if (!componentIdPattern.test(component.id ?? "")) {
      throw new TypeError(`Installed editor component at index ${index} has an invalid id`);
    }
    if (ids.has(component.id)) {
      throw new TypeError(`Duplicate installed editor component id: ${component.id}`);
    }
    ids.add(component.id);

    for (const slot of ["ToolbarAction", "Overlay"]) {
      if (component[slot] !== undefined && typeof component[slot] !== "function") {
        throw new TypeError(`Installed editor component ${component.id}.${slot} must be a component function`);
      }
    }

    return Object.freeze({
      id: component.id,
      ToolbarAction: component.ToolbarAction,
      Overlay: component.Overlay,
    });
  });
}

export function createEditorComponentHost({ snapshot, actions, editor, ui }) {
  if (!actions || typeof actions !== "object") {
    throw new TypeError("Editor component host actions are required");
  }

  return Object.freeze({
    version: EDITOR_COMPONENT_HOST_VERSION,
    snapshot: snapshot ?? null,
    actions: Object.freeze({ ...actions }),
    editor: editor ?? null,
    ui: Object.freeze({ ...(ui ?? {}) }),
  });
}
