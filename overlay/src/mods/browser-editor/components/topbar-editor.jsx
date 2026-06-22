import React, { useState, useEffect } from 'react';
import classNames from 'classnames';
import {
  parseRadioStations,
  isRadioEnabled,
  updateRadioInCustomJs,
  updateRadioInCustomCss,
  parseParticlesConfig,
  isParticlesEnabled,
  updateParticlesInCustomJs,
  updateParticlesInCustomCss,
  parseIpConfig
} from '../lib/topbar-config-helper';

const AVAILABLE_EFFECTS = [
  { id: 'particles', label: 'Частицы' },
  { id: 'stars', label: 'Звёзды' },
  { id: 'fog', label: 'Туман' },
  { id: 'rocket', label: 'Ракета' },
  { id: 'lava', label: 'Лава' },
  { id: 'meteor', label: 'Метеор' }
];

export default function TopBarSettingsEditor({
  customJs,
  customCss,
  onChangeCustomJs,
  onChangeCustomCss,
  mode = 'all'
}) {
  // Radio States
  const [radioEnabled, setRadioEnabled] = useState(false);
  const [stations, setStations] = useState([]);

  // Particles States
  const [particlesEnabled, setParticlesEnabled] = useState(false);
  const [enabledEffects, setEnabledEffects] = useState(['rocket']);
  const [defaultEffect, setDefaultEffect] = useState('rocket');

  // IP Widget States
  const [ipProviders, setIpProviders] = useState([]);
  const [ipHideOnError, setIpHideOnError] = useState(true);

  // Load configuration initially
  useEffect(() => {
    const isRadio = isRadioEnabled(customJs);
    setRadioEnabled(isRadio);
    if (isRadio) {
      setStations(parseRadioStations(customJs));
    } else {
      // Default initial stations
      setStations([
        { id: 'initial-1', label: 'DFM', url: 'https://dfm.hostingradio.ru/dfm96.aacp', isDefault: true },
        { id: 'initial-2', label: 'Power', url: 'https://radio.dline-media.com/powerhit128', isDefault: false }
      ]);
    }

    const isParticles = isParticlesEnabled(customJs);
    setParticlesEnabled(isParticles);
    if (isParticles) {
      const conf = parseParticlesConfig(customJs);
      setEnabledEffects(conf.enabledEffects);
      setDefaultEffect(conf.defaultEffect);
    }

    const ipConf = parseIpConfig(customJs);
    setIpHideOnError(ipConf.ipHideOnError);
    if (ipConf.ipProviders && ipConf.ipProviders.length > 0) {
      setIpProviders(ipConf.ipProviders);
    } else {
      setIpProviders([
        { id: 'initial-ip-1', label: 'ipwho.is', url: 'https://ipwho.is/', jsonKey: 'ip' },
        { id: 'initial-ip-2', label: 'ipapi.co', url: 'https://ipapi.co/json/', jsonKey: 'ip' },
        { id: 'initial-ip-3', label: 'api.ipify.org', url: 'https://api.ipify.org?format=json', jsonKey: 'ip' }
      ]);
    }
  }, [customJs]);

  // Sync changes back to custom.js and custom.css
  const syncChanges = (
    nextRadioEnabled,
    nextStations,
    nextParticlesEnabled,
    nextEnabledEffects,
    nextDefaultEffect,
    nextIpProviders = ipProviders,
    nextIpHideOnError = ipHideOnError
  ) => {
    let newJs = customJs;
    let newCss = customCss;

    // Apply Radio and IP Changes
    newJs = updateRadioInCustomJs(newJs, nextStations, nextRadioEnabled, nextIpProviders, nextIpHideOnError);
    newCss = updateRadioInCustomCss(newCss, nextRadioEnabled);

    // Apply Particles Changes
    newJs = updateParticlesInCustomJs(newJs, nextEnabledEffects, nextDefaultEffect, nextParticlesEnabled);
    newCss = updateParticlesInCustomCss(newCss, nextParticlesEnabled);

    onChangeCustomJs(newJs);
    onChangeCustomCss(newCss);
  };

  const handleRadioToggle = (e) => {
    const enabled = e.target.checked;
    setRadioEnabled(enabled);
    syncChanges(enabled, stations, particlesEnabled, enabledEffects, defaultEffect);
  };

  const handleStationChange = (id, field, value) => {
    const nextStations = stations.map(s => {
      if (s.id !== id) return s;
      return { ...s, [field]: value };
    });
    setStations(nextStations);
    syncChanges(radioEnabled, nextStations, particlesEnabled, enabledEffects, defaultEffect);
  };

  const handleSetDefaultStation = (id) => {
    const nextStations = stations.map(s => ({
      ...s,
      isDefault: s.id === id
    }));
    setStations(nextStations);
    syncChanges(radioEnabled, nextStations, particlesEnabled, enabledEffects, defaultEffect);
  };

  const handleAddStation = () => {
    const nextStations = [
      ...stations,
      {
        id: `station-new-${Date.now()}`,
        label: 'Новое Радио',
        url: '',
        isDefault: stations.length === 0
      }
    ];
    setStations(nextStations);
    syncChanges(radioEnabled, nextStations, particlesEnabled, enabledEffects, defaultEffect);
  };

  const handleRemoveStation = (id) => {
    let nextStations = stations.filter(s => s.id !== id);
    // If the default station was removed, make the first one default
    if (stations.find(s => s.id === id)?.isDefault && nextStations.length > 0) {
      nextStations[0].isDefault = true;
    }
    setStations(nextStations);
    syncChanges(radioEnabled, nextStations, particlesEnabled, enabledEffects, defaultEffect);
  };

  // Drag and Drop Station sorting
  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index);
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;

    const nextStations = [...stations];
    const [moved] = nextStations.splice(sourceIndex, 1);
    nextStations.splice(targetIndex, 0, moved);

    setStations(nextStations);
    syncChanges(radioEnabled, nextStations, particlesEnabled, enabledEffects, defaultEffect);
  };

  const moveStation = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= stations.length) return;

    const nextStations = [...stations];
    const temp = nextStations[index];
    nextStations[index] = nextStations[targetIndex];
    nextStations[targetIndex] = temp;

    setStations(nextStations);
    syncChanges(radioEnabled, nextStations, particlesEnabled, enabledEffects, defaultEffect);
  };

  // Particles Event Handlers
  const handleParticlesToggle = (e) => {
    const enabled = e.target.checked;
    setParticlesEnabled(enabled);
    syncChanges(radioEnabled, stations, enabled, enabledEffects, defaultEffect);
  };

  const handleEffectToggle = (effectId, checked) => {
    let nextEffects = [...enabledEffects];
    if (checked) {
      if (!nextEffects.includes(effectId)) {
        nextEffects.push(effectId);
      }
    } else {
      nextEffects = nextEffects.filter(id => id !== effectId);
    }

    // Ensure we have at least one effect enabled if main toggle is active
    if (nextEffects.length === 0) {
      nextEffects = ['rocket'];
    }

    // If current default effect is disabled, update default
    let nextDefault = defaultEffect;
    if (!nextEffects.includes(defaultEffect)) {
      nextDefault = nextEffects[0];
    }

    setEnabledEffects(nextEffects);
    setDefaultEffect(nextDefault);
    syncChanges(radioEnabled, stations, particlesEnabled, nextEffects, nextDefault);
  };

  const handleSetDefaultEffect = (effectId) => {
    setDefaultEffect(effectId);
    syncChanges(radioEnabled, stations, particlesEnabled, enabledEffects, effectId);
  };

  const handleIpProviderChange = (id, field, value) => {
    const nextProviders = ipProviders.map(p => {
      if (p.id !== id) return p;
      return { ...p, [field]: value };
    });
    setIpProviders(nextProviders);
    syncChanges(radioEnabled, stations, particlesEnabled, enabledEffects, defaultEffect, nextProviders, ipHideOnError);
  };

  const handleAddIpProvider = () => {
    const nextProviders = [
      ...ipProviders,
      {
        id: `ip-provider-new-${Date.now()}`,
        label: 'Новый провайдер',
        url: '',
        jsonKey: ''
      }
    ];
    setIpProviders(nextProviders);
    syncChanges(radioEnabled, stations, particlesEnabled, enabledEffects, defaultEffect, nextProviders, ipHideOnError);
  };

  const handleRemoveIpProvider = (id) => {
    const nextProviders = ipProviders.filter(p => p.id !== id);
    setIpProviders(nextProviders);
    syncChanges(radioEnabled, stations, particlesEnabled, enabledEffects, defaultEffect, nextProviders, ipHideOnError);
  };

  const handleIpDragStart = (e, index) => {
    e.dataTransfer.setData('text/ip-provider-index', index);
  };

  const handleIpDrop = (e, targetIndex) => {
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData('text/ip-provider-index'), 10);
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;

    const nextProviders = [...ipProviders];
    const [moved] = nextProviders.splice(sourceIndex, 1);
    nextProviders.splice(targetIndex, 0, moved);

    setIpProviders(nextProviders);
    syncChanges(radioEnabled, stations, particlesEnabled, enabledEffects, defaultEffect, nextProviders, ipHideOnError);
  };

  const moveIpProvider = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= ipProviders.length) return;

    const nextProviders = [...ipProviders];
    const temp = nextProviders[index];
    nextProviders[index] = nextProviders[targetIndex];
    nextProviders[targetIndex] = temp;

    setIpProviders(nextProviders);
    syncChanges(radioEnabled, stations, particlesEnabled, enabledEffects, defaultEffect, nextProviders, ipHideOnError);
  };

  const handleIpHideOnErrorToggle = (e) => {
    const hide = e.target.checked;
    setIpHideOnError(hide);
    syncChanges(radioEnabled, stations, particlesEnabled, enabledEffects, defaultEffect, ipProviders, hide);
  };

  return (
    <div className="topbar-settings-editor flex flex-col gap-6 text-sm text-theme-800 dark:text-theme-200 overflow-y-auto max-h-[60vh] pr-2 pb-4">
      {/* 1. RADIO SECTION */}
      {(mode === 'all' || mode === 'radio') && (
        <div className="rounded-xl border border-theme-300/40 bg-theme-50/20 p-5 dark:border-white/10 dark:bg-white/5">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-base font-bold text-theme-900 dark:text-white">Музыкальное радио</h3>
            <p className="text-xs text-theme-500 dark:text-theme-400 mt-1">Виджет проигрывателя интернет-радиостанций в верхней панели</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={radioEnabled}
              onChange={handleRadioToggle}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-theme-300 dark:bg-theme-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-theme-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            <span className="ml-2 text-xs font-semibold uppercase tracking-wider">{radioEnabled ? 'Вкл' : 'Выкл'}</span>
          </label>
        </div>

        {radioEnabled && (
          <div className="space-y-3 mt-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-theme-500 dark:text-theme-400 block mb-2">Список станций</span>
            
            <div className="space-y-2">
              {stations.map((station, index) => (
                <div
                  key={station.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, index)}
                  className="flex items-center gap-2 rounded-lg border border-theme-300/30 bg-theme-100/10 px-3 py-2 dark:border-white/5 dark:bg-theme-900/10 hover:border-theme-300/60 dark:hover:border-white/20 transition-colors"
                >
                  {/* Drag Handle */}
                  <div className="cursor-grab text-theme-400 hover:text-theme-600 dark:hover:text-theme-200 px-1 font-bold select-none text-base">
                    ⋮⋮
                  </div>

                  {/* Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1">
                    <input
                      type="text"
                      value={station.label}
                      onChange={(e) => handleStationChange(station.id, 'label', e.target.value)}
                      placeholder="Название радиостанции"
                      className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="text"
                      value={station.url}
                      onChange={(e) => handleStationChange(station.id, 'url', e.target.value)}
                      placeholder="URL-ссылка на аудиопоток (mp3 / aac / m3u8)"
                      className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {/* Default Radio */}
                    <label className="flex items-center gap-1 text-[11px] cursor-pointer" title="Воспроизводить по умолчанию">
                      <input
                        type="radio"
                        name="default-radio-station"
                        checked={station.isDefault}
                        onChange={() => handleSetDefaultStation(station.id)}
                        className="text-emerald-500 focus:ring-emerald-500 border-theme-300 dark:border-white/10"
                      />
                      <span className="hidden lg:inline opacity-70">Дефолт</span>
                    </label>

                    {/* Up/Down buttons for mobile/no-drag */}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveStation(index, -1)}
                      className="p-1 rounded text-theme-400 hover:bg-theme-200/50 dark:hover:bg-white/5 disabled:opacity-30"
                      title="Переместить вверх"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={index === stations.length - 1}
                      onClick={() => moveStation(index, 1)}
                      className="p-1 rounded text-theme-400 hover:bg-theme-200/50 dark:hover:bg-white/5 disabled:opacity-30"
                      title="Переместить вниз"
                    >
                      ▼
                    </button>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => handleRemoveStation(station.id)}
                      className="p-1 rounded text-rose-500 hover:bg-rose-500/10 dark:hover:bg-rose-500/20"
                      title="Удалить радиостанцию"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddStation}
              className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/5 dark:hover:bg-emerald-400/5 transition-colors flex items-center justify-center gap-1 w-full"
            >
              + Добавить радиостанцию
            </button>
          </div>
        )}
      </div>
      )}

      {/* 2. IP WIDGET SECTION */}
      {(mode === 'all' || mode === 'topbar') && (
        <div className="rounded-xl border border-theme-300/40 bg-theme-50/20 p-5 dark:border-white/10 dark:bg-white/5">
        <div className="mb-4">
          <h3 className="text-base font-bold text-theme-900 dark:text-white">Определение IP-адреса</h3>
          <p className="text-xs text-theme-500 dark:text-theme-400 mt-1">Настройки виджета внешнего IP-адреса на верхней панели</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-theme-500 dark:text-theme-400 block mb-2">Список провайдеров (опрашиваются по очереди сверху вниз)</span>
            
            <div className="space-y-2">
              {ipProviders.map((provider, index) => (
                <div
                  key={provider.id}
                  draggable
                  onDragStart={(e) => handleIpDragStart(e, index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleIpDrop(e, index)}
                  className="flex items-center gap-2 rounded-lg border border-theme-300/30 bg-theme-100/10 px-3 py-2 dark:border-white/5 dark:bg-theme-900/10 hover:border-theme-300/60 dark:hover:border-white/20 transition-colors"
                >
                  {/* Drag Handle */}
                  <div className="cursor-grab text-theme-400 hover:text-theme-600 dark:hover:text-theme-200 px-1 font-bold select-none text-base">
                    ⋮⋮
                  </div>

                  {/* Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 flex-1">
                    <input
                      type="text"
                      value={provider.label}
                      onChange={(e) => handleIpProviderChange(provider.id, 'label', e.target.value)}
                      placeholder="Название провайдера"
                      className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="text"
                      value={provider.url}
                      onChange={(e) => handleIpProviderChange(provider.id, 'url', e.target.value)}
                      placeholder="URL-ссылка запроса"
                      className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="text"
                      value={provider.jsonKey}
                      onChange={(e) => handleIpProviderChange(provider.id, 'jsonKey', e.target.value)}
                      placeholder="Ключ JSON (пусто, если plain text)"
                      className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveIpProvider(index, -1)}
                      className="p-1 rounded text-theme-400 hover:bg-theme-200/50 dark:hover:bg-white/5 disabled:opacity-30"
                      title="Переместить вверх"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={index === ipProviders.length - 1}
                      onClick={() => moveIpProvider(index, 1)}
                      className="p-1 rounded text-theme-400 hover:bg-theme-200/50 dark:hover:bg-white/5 disabled:opacity-30"
                      title="Переместить вниз"
                    >
                      ▼
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveIpProvider(provider.id)}
                      className="p-1 rounded text-rose-500 hover:bg-rose-500/10 dark:hover:bg-rose-500/20"
                      title="Удалить провайдера"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddIpProvider}
              className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/5 dark:hover:bg-emerald-400/5 transition-colors flex items-center justify-center gap-1 w-full"
            >
              + Добавить провайдера
            </button>
          </div>

          <label className="flex items-center gap-2 cursor-pointer font-medium text-xs text-theme-800 dark:text-theme-200 mt-4 border-t border-theme-300/20 dark:border-white/5 pt-4">
            <input
              type="checkbox"
              checked={ipHideOnError}
              onChange={handleIpHideOnErrorToggle}
              className="rounded text-emerald-500 focus:ring-emerald-500 border-theme-300 dark:border-white/15 dark:bg-theme-900 h-4 w-4"
            />
            Скрывать виджет при ошибке определения IP
          </label>
        </div>
      </div>
      )}

      {/* 3. PARTICLES SECTION */}
      {(mode === 'all' || mode === 'topbar') && (
        <div className="rounded-xl border border-theme-300/40 bg-theme-50/20 p-5 dark:border-white/10 dark:bg-white/5">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-base font-bold text-theme-900 dark:text-white">Интерактивные живые обои</h3>
            <p className="text-xs text-theme-500 dark:text-theme-400 mt-1">Анимированные эффекты на заднем плане и счетчик производительности FPS</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={particlesEnabled}
              onChange={handleParticlesToggle}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-theme-300 dark:bg-theme-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-theme-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            <span className="ml-2 text-xs font-semibold uppercase tracking-wider">{particlesEnabled ? 'Вкл' : 'Выкл'}</span>
          </label>
        </div>

        {particlesEnabled && (
          <div className="space-y-4 mt-4 border-t border-theme-300/20 dark:border-white/5 pt-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-theme-500 dark:text-theme-400 block mb-3">Доступные эффекты</span>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {AVAILABLE_EFFECTS.map((effect) => {
                  const isChecked = enabledEffects.includes(effect.id);
                  const isDefault = defaultEffect === effect.id;

                  return (
                    <div
                      key={effect.id}
                      className={classNames(
                        "flex flex-col gap-2 rounded-lg border px-3 py-2.5 transition-colors select-none",
                        isChecked
                          ? "border-emerald-500/30 bg-emerald-500/5 dark:border-emerald-400/20"
                          : "border-theme-300/30 bg-theme-100/5 dark:border-white/5"
                      )}
                    >
                      <label className="flex items-center gap-2 cursor-pointer font-medium text-xs">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleEffectToggle(effect.id, e.target.checked)}
                          className="rounded text-emerald-500 focus:ring-emerald-500 border-theme-300 dark:border-white/15 dark:bg-theme-900"
                        />
                        {effect.label}
                      </label>

                      {isChecked && (
                        <label className="flex items-center gap-1 text-[10px] cursor-pointer mt-1 border-t border-emerald-500/10 pt-1 text-emerald-600 dark:text-emerald-400">
                          <input
                            type="radio"
                            name="default-particle-effect"
                            checked={isDefault}
                            onChange={() => handleSetDefaultEffect(effect.id)}
                            className="text-emerald-500 focus:ring-emerald-500 border-theme-300 dark:border-white/15"
                          />
                          <span>По умолчанию</span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
