import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { StudioModalWindow } from "mods/browser-editor/components/dashboard-studio";

const statusStyles = {
  available:
    "border-amber-400/50 bg-amber-400/20 text-amber-800 dark:text-amber-200",
  error: "border-rose-400/50 bg-rose-400/20 text-rose-800 dark:text-rose-200",
  running: "border-sky-400/50 bg-sky-400/20 text-sky-800 dark:text-sky-200",
  success:
    "border-emerald-400/50 bg-emerald-400/20 text-emerald-800 dark:text-emerald-200",
  unavailable:
    "border-theme-400/40 bg-theme-400/10 text-theme-600 dark:text-theme-300",
};

function statusLabel(status) {
  if (status?.state === "running") return "Обновление...";
  if (status?.state === "success") return "Обновлено";
  if (status?.state === "error") return "Ошибка обновления";
  if (status?.state === "unavailable" || status?.configured === false)
    return "Updater недоступен";
  if (status?.updateAvailable) return "Доступно обновление";
  return "";
}

async function fetchStatus(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function ServiceUpdateModal({
  config,
  initialStatus,
  onClose,
  onStatusChange,
}) {
  const [status, setStatus] = useState(initialStatus);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const query = new URLSearchParams({
    ...(config.source ? { source: config.source } : {}),
    target: config.target,
    type: config.type,
  });

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  async function refresh(force = false) {
    setError("");
    try {
      const suffix = force ? "&force=true" : "";
      const nextStatus = await fetchStatus(
        `/api/config/service-updates?${query.toString()}${suffix}`,
      );
      setStatus(nextStatus);
      onStatusChange(nextStatus);
    } catch (refreshError) {
      setError(refreshError.message);
    }
  }

  async function runUpdate() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/config/service-updates?${query.toString()}`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const nextStatus = await response.json();
      setStatus(nextStatus);
      onStatusChange(nextStatus);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === "undefined") {
    return null;
  }

  const running = status?.state === "running";
  const canUpdate =
    status?.configured !== false && status?.updateAvailable && !running;
  const currentStatusLabel = statusLabel(status) || "Статус не проверен";
  const checkedAt = status?.checkedAt
    ? new Date(status.checkedAt).toLocaleString("ru-RU")
    : "Ещё не проверялось";

  return createPortal(
    <StudioModalWindow
      ariaLabel={`Обновление ${status?.label || config.target}`}
      description={`${config.type === "docker" ? "Docker" : "LXC"} · ${config.source ? `${config.source} · ` : ""}${config.target}`}
      defaultHeight={620}
      defaultWidth={760}
      minHeight={440}
      minWidth={560}
      onClose={onClose}
      title={status?.label || config.target}
      zIndex={1000}
    >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-transparent to-theme-100/30 p-5 dark:to-black/10">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-theme-300/40 bg-theme-50/60 p-3 dark:border-white/10 dark:bg-white/5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-theme-500 dark:text-theme-400">
                Текущий статус
              </div>
              <div className="mt-1 text-sm font-semibold text-theme-900 dark:text-theme-100">
                {currentStatusLabel}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-theme-500 dark:text-theme-400">
                Последняя проверка
              </div>
              <div className="mt-1 text-xs text-theme-700 dark:text-theme-300">
                {checkedAt}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-theme-300/30 bg-theme-200/30 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-theme-500 dark:text-theme-400">
                Установленная версия
              </div>
              <div className="mt-1.5 font-mono text-sm font-semibold text-theme-900 dark:text-theme-100">
                {status?.currentVersion || "Не определено"}
              </div>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">
                Доступная версия
              </div>
              <div className="mt-1.5 font-mono text-sm font-semibold text-theme-900 dark:text-theme-100">
                {status?.latestVersion || "Не определено"}
              </div>
            </div>
          </div>

          {(status?.message || error) && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                error || status?.state === "error"
                  ? "border-rose-400/40 bg-rose-400/10 text-rose-800 dark:text-rose-200"
                  : "border-theme-300/40 bg-theme-100/60 text-theme-700 dark:border-white/10 dark:bg-white/5 dark:text-theme-200"
              }`}
            >
              {error || status.message}
            </div>
          )}

          {status?.releaseNotes && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-theme-800 dark:text-theme-100">
                Описание обновления
              </h3>
              <div className="whitespace-pre-wrap rounded-lg bg-theme-200/40 p-3 text-sm text-theme-700 dark:bg-white/5 dark:text-theme-300">
                {status.releaseNotes}
              </div>
            </div>
          )}

          {status?.log && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-theme-800 dark:text-theme-100">
                Журнал
              </h3>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/90 p-3 text-xs text-zinc-100">
                {status.log}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-theme-300/30 bg-theme-100/40 px-5 py-4 dark:border-white/10 dark:bg-black/10">
          <p className="max-w-sm text-[11px] leading-relaxed text-theme-500 dark:text-theme-400">
            Проверка только собирает сведения. Установка запускается отдельной
            кнопкой.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => refresh(true)}
              disabled={submitting || running}
              className="rounded-lg border border-theme-400/50 bg-theme-50/50 px-4 py-2 text-sm font-medium text-theme-700 transition-colors hover:bg-theme-200/60 disabled:opacity-50 dark:bg-white/5 dark:text-theme-200 dark:hover:bg-white/10"
            >
              Проверить
            </button>
            <button
              type="button"
              onClick={runUpdate}
              disabled={!canUpdate || submitting}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black shadow-sm transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running || submitting
                ? "Обновление..."
                : "Установить обновление"}
            </button>
          </div>
        </div>
    </StudioModalWindow>,
    document.body,
  );
}

export default function ServiceUpdateBadge({ service }) {
  const config = service?.serviceUpdate;
  const target = typeof config?.target === "string" ? config.target.trim() : "";
  const source = typeof config?.source === "string" ? config.source.trim() : "";
  const type = config?.type === "lxc" ? "lxc" : "docker";
  const [modalOpen, setModalOpen] = useState(false);
  const statusKey = [type, source, target].filter(Boolean).join("-");
  const query = target
    ? new URLSearchParams({
        ...(source ? { source } : {}),
        target,
        type,
      }).toString()
    : "";
  const { data, error, mutate } = useSWR(
    target ? "/api/config/service-updates?cached=true" : null,
    fetchStatus,
    {
      refreshInterval: (payload) =>
        Object.values(payload?.statuses ?? {}).some(
          (candidate) => candidate?.state === "running",
        )
          ? 3000
          : 15 * 1000,
      revalidateOnFocus: false,
    },
  );
  const matchingStatuses = Object.values(data?.statuses ?? {}).filter(
    (candidate) =>
      candidate?.id === target &&
      candidate?.type === type &&
      (!source || candidate.source === source),
  );
  const cachedStatus =
    data?.statuses?.[statusKey] ||
    (!source && matchingStatuses.length === 1 ? matchingStatuses[0] : null);

  if (!target || (!cachedStatus && !error)) {
    return null;
  }

  const status = error
    ? {
        configured: false,
        label: service.name,
        message: error.message,
        state: "unavailable",
        type,
      }
    : cachedStatus;
  const label = statusLabel(status);

  if (!label) {
    return null;
  }

  const style = statusStyles[status?.state] || statusStyles.available;

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setModalOpen(true);
        }}
        className={`shrink-0 rounded-b-[3px] border px-1.5 py-0.5 text-[8px] font-bold uppercase ${style}`}
        title={status?.message || label}
      >
        {label}
      </button>
      {modalOpen && (
        <ServiceUpdateModal
          config={{ source, target, type }}
          initialStatus={status}
          onClose={() => setModalOpen(false)}
          onStatusChange={(nextStatus) =>
            mutate(
              (current) => ({
                ...current,
                statuses: {
                  ...current?.statuses,
                  [statusKey]: nextStatus,
                },
              }),
              { revalidate: false },
            )
          }
        />
      )}
    </>
  );
}
