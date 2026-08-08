export const serviceUpdateTypes = {
  docker: {
    label: "Docker",
    description: "Контейнеры автоматически загружаются из подключений Homepage в docker.yaml.",
  },
  lxc: {
    label: "LXC",
    description: "LXC автоматически загружаются из подключений Homepage в proxmox.yaml.",
  },
};

export const serviceUpdateTargetPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const serviceUpdateSourcePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const serviceUpdateStates = new Set(["idle", "available", "running", "success", "error", "unavailable"]);

function boundedText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeServiceUpdateConfig(value) {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = Object.hasOwn(serviceUpdateTypes, config.type) ? config.type : "docker";
  const source = boundedText(config.source, 64);
  const target = boundedText(config.target, 64);

  return {
    enabled: config.enabled !== false && Boolean(config.type || target),
    source,
    type,
    target,
  };
}

export function validateServiceUpdateConfig(value) {
  const rawType = value && typeof value === "object" && !Array.isArray(value) ? value.type : undefined;
  const config = normalizeServiceUpdateConfig(value);

  if (!config.enabled) {
    return config;
  }

  if (!Object.hasOwn(serviceUpdateTypes, rawType)) {
    throw new Error("Выберите тип информатора обновлений");
  }

  if (!serviceUpdateTargetPattern.test(config.target)) {
    throw new Error("Выберите найденный сервис для информатора обновлений");
  }

  if (config.source && !serviceUpdateSourcePattern.test(config.source)) {
    throw new Error("Некорректный источник обновлений");
  }

  return config;
}

export function serializeServiceUpdateConfig(value) {
  const config = validateServiceUpdateConfig(value);

  if (!config.enabled) {
    return null;
  }

  return {
    ...(config.source ? { source: config.source } : {}),
    type: config.type,
    target: config.target,
  };
}

export function normalizeServiceUpdateRegistry(value) {
  const registry = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const targets = registry.targets && typeof registry.targets === "object" && !Array.isArray(registry.targets)
    ? registry.targets
    : {};

  return Object.entries(targets).map(([id, rawTarget]) => {
    if (!serviceUpdateTargetPattern.test(id)) {
      throw new Error(`Некорректный ID цели обновления: ${id}`);
    }

    const target = rawTarget && typeof rawTarget === "object" && !Array.isArray(rawTarget) ? rawTarget : {};
    if (!Object.hasOwn(serviceUpdateTypes, target.type)) {
      throw new Error(`Цель ${id}: type должен быть docker или lxc`);
    }

    const runner = boundedText(target.runner || id, 64);
    if (!serviceUpdateTargetPattern.test(runner)) {
      throw new Error(`Цель ${id}: некорректное имя runner`);
    }

    return {
      id,
      label: boundedText(target.label, 120) || id,
      runner,
      type: target.type,
    };
  });
}

export function normalizeServiceUpdateStatus(value, fallback = {}) {
  const status = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const updateAvailable = status.updateAvailable === true;
  let state = serviceUpdateStates.has(status.state) ? status.state : updateAvailable ? "available" : "idle";

  if (updateAvailable && state === "idle") {
    state = "available";
  }

  return {
    configured: status.configured !== false,
    currentVersion: boundedText(status.currentVersion, 128),
    latestVersion: boundedText(status.latestVersion, 128),
    message: boundedText(status.message, 2000),
    releaseNotes: boundedText(status.releaseNotes, 10000),
    state,
    updateAvailable,
    ...fallback,
  };
}
