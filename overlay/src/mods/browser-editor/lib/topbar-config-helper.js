import {
  radioJsTemplate,
  radioCssTemplate,
  particlesJsTemplate,
  particlesCssTemplate
} from './templates';

// Helper to remove a block enclosed by start and end markers
function removeBlock(content, startMarker, endMarker) {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) return content;
  
  const endIndex = content.indexOf(endMarker, startIndex);
  if (endIndex === -1) return content;
  
  const before = content.substring(0, startIndex);
  let after = content.substring(endIndex + endMarker.length);
  
  // Clean up trailing/leading newlines
  if (after.startsWith('\n')) {
    after = after.substring(1);
  }
  return (before.trimEnd() + '\n\n' + after.trimStart()).trim();
}

// Helper to add or replace a block
function upsertBlock(content, startMarker, endMarker, blockTemplate) {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex + endMarker.length);
    return before + blockTemplate + after;
  }
  
  // Block not found, append it to the end
  let newContent = content.trim();
  if (newContent) {
    newContent += '\n\n';
  }
  return newContent + blockTemplate + '\n';
}

// Parser for radio buttons order in custom.js
export function parseRadioButtonsOrder(customJs) {
  const match = customJs.match(/const\s+radioButtonsOrder\s*=\s*`([\s\S]*?)`/);
  if (!match) {
    return ['trackinfo', 'like', 'dislike', 'playlist', 'plapau', 'volumedown', 'volumeset', 'volumeup'];
  }
  
  const text = match[1];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// Parser for radio stations in custom.js
export function parseRadioStations(customJs) {
  const match = customJs.match(/const\s+stationList\s*=\s*`([\s\S]*?)`/);
  if (!match) return [];
  
  const text = match[1];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const isDefault = line.startsWith('*');
      const normalizedLine = isDefault ? line.slice(1).trim() : line;
      const parts = normalizedLine.split(',').map(p => p.trim());
      if (parts.length < 2) return null;
      
      const label = parts[0];
      const url = parts[1];
      const showTrackInfo = parts[2] === 'true';
      const trackInfoUrl = parts[3] || '';
      const trackInfoKey = parts[4] || '';
      
      return {
        id: `station-${index}`,
        label,
        url,
        isDefault,
        showTrackInfo,
        trackInfoUrl,
        trackInfoKey
      };
    })
    .filter(Boolean);
}

// Parser for IP config in custom.js
export function parseIpProviders(customJs) {
  const match = customJs.match(/const\s+ipProviderList\s*=\s*`([\s\S]*?)`/);
  if (!match) return [];
  
  const text = match[1];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separatorIndex = line.indexOf(',');
      if (separatorIndex === -1) return null;
      
      const label = line.slice(0, separatorIndex).trim();
      const rest = line.slice(separatorIndex + 1).trim();
      
      const secondSep = rest.indexOf(',');
      let url = rest;
      let jsonKey = "";
      if (secondSep !== -1) {
        url = rest.slice(0, secondSep).trim();
        jsonKey = rest.slice(secondSep + 1).trim();
      }
      return { id: `ip-provider-${index}`, label, url, jsonKey };
    })
    .filter(Boolean);
}

export function parseIpEnabled(customJs) {
  const match = customJs.match(/const\s+ipEnabled\s*=\s*(true|false)/);
  return match ? match[1] === 'true' : true;
}

export function parseRadioEnabled(customJs) {
  const match = customJs.match(/const\s+radioEnabled\s*=\s*(true|false)/);
  return match ? match[1] === 'true' : true;
}

export function parseIpConfig(customJs) {
  const hideMatch = customJs.match(/const\s+ipHideOnError\s*=\s*(true|false)/);
  
  return {
    ipEnabled: parseIpEnabled(customJs),
    ipProviders: parseIpProviders(customJs),
    ipHideOnError: hideMatch ? hideMatch[1] === 'true' : true
  };
}

export function parseRadioButtonsStyle(customJs) {
  const match = customJs.match(/const\s+radioButtonsStyle\s*=\s*"([^"]+)"/);
  return match ? match[1] : 'classic';
}

export function parseRadioIconSize(customJs) {
  const match = customJs.match(/const\s+radioIconSize\s*=\s*(\d+)/);
  return match ? parseInt(match[1], 10) : 10;
}

export function parseRadioButtonSize(customJs) {
  const match = customJs.match(/const\s+radioButtonSize\s*=\s*(\d+)/);
  return match ? parseInt(match[1], 10) : 18;
}

export function parseLinkIpFpsSizes(customJs) {
  const match = customJs.match(/const\s+linkIpFpsSizes\s*=\s*(true|false)/);
  return match ? match[1] === 'true' : false;
}


// Check if radio is enabled in custom.js
export function isRadioEnabled(customJs) {
  return customJs.includes('/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */');
}

// Update custom.js with radio settings
export function updateRadioInCustomJs(
  customJs,
  stations,
  radioEnabled,
  ipProviders = [],
  ipHideOnError = true,
  radioButtonsOrder = ['trackinfo', 'like', 'dislike', 'playlist', 'plapau', 'volumedown', 'volumeset', 'volumeup'],
  radioButtonsStyle = 'classic',
  radioIconSize = 10,
  radioButtonSize = 18,
  linkIpFpsSizes = false,
  ipEnabled = true
) {
  console.log("DEBUG-TEMPLATE: radioJsTemplate has topbarRoot =", radioJsTemplate.includes("topbarRoot"), "has radioRoot =", radioJsTemplate.includes("radioRoot"));
  if (!radioEnabled && !ipEnabled) {
    return removeBlock(customJs, '/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */', '/* <<< HOMEPAGE-EDITOR RADIO JS END <<< */');
  }
  
  // Generate the station list string
  const stationsText = stations.map(s => {
    const prefix = s.isDefault ? '* ' : '';
    const showTrack = s.showTrackInfo ? 'true' : 'false';
    return `    ${prefix}${s.label}, ${s.url}, ${showTrack}, ${s.trackInfoUrl || ''}, ${s.trackInfoKey || ''}`;
  }).join('\n');
  const serializedList = `\n${stationsText}\n  `;
  
  // Generate the ip providers list string
  const ipProvidersText = ipProviders.map(p => {
    const jsonKeyPart = p.jsonKey ? `, ${p.jsonKey}` : '';
    return `    ${p.label}, ${p.url}${jsonKeyPart}`;
  }).join('\n');
  const serializedIpList = `\n${ipProvidersText}\n  `;

  // Generate the buttons order string
  const buttonsOrderText = radioButtonsOrder.join('\n    ');
  const serializedButtonsOrder = `\n    ${buttonsOrderText}\n  `;
  
  const startMarker = '/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */';
  const endMarker = '/* <<< HOMEPAGE-EDITOR RADIO JS END <<< */';
  
  const hideLine = `const ipHideOnError = ${ipHideOnError};`;
  const styleLine = `const radioButtonsStyle = "${radioButtonsStyle}";`;
  const sizeLine = `const radioIconSize = ${radioIconSize};`;
  const btnSizeLine = `const radioButtonSize = ${radioButtonSize};`;
  const linkIpFpsLine = `const linkIpFpsSizes = ${linkIpFpsSizes};`;
  const radioEnabledLine = `const radioEnabled = ${radioEnabled};`;
  const ipEnabledLine = `const ipEnabled = ${ipEnabled};`;
  
  // Always regenerate the block from baseTemplate to make sure the code matches the templates (including createRadioMarkup improvements)
  const baseTemplate = radioJsTemplate;
  let configuredBlock = baseTemplate.replace(/(const\s+stationList\s*=\s*`)([\s\S]*?)(`)/, `$1${serializedList}$3`);
  configuredBlock = configuredBlock.replace(/(const\s+ipProviderList\s*=\s*`)([\s\S]*?)(`)/, `$1${serializedIpList}$3`);
  configuredBlock = configuredBlock.replace(/const\s+ipHideOnError\s*=\s*(true|false);/, hideLine);
  configuredBlock = configuredBlock.replace(/const\s+radioButtonsStyle\s*=\s*"[^"]+";/, styleLine);
  configuredBlock = configuredBlock.replace(/const\s+radioIconSize\s*=\s*\d+;/, sizeLine);
  configuredBlock = configuredBlock.replace(/const\s+radioButtonSize\s*=\s*\d+;/, btnSizeLine);
  configuredBlock = configuredBlock.replace(/const\s+linkIpFpsSizes\s*=\s*(true|false);/, linkIpFpsLine);
  configuredBlock = configuredBlock.replace(/const\s+radioEnabled\s*=\s*(true|false);/, radioEnabledLine);
  configuredBlock = configuredBlock.replace(/const\s+ipEnabled\s*=\s*(true|false);/, ipEnabledLine);
  configuredBlock = configuredBlock.replace(/(const\s+radioButtonsOrder\s*=\s*`)([\s\S]*?)(`)/, `$1${serializedButtonsOrder}$3`);
  
  return upsertBlock(customJs, startMarker, endMarker, configuredBlock);
}

// Update custom.css with radio styles
export function updateRadioInCustomCss(customCss, enabled) {
  if (!enabled) {
    return removeBlock(customCss, '/* >>> HOMEPAGE-EDITOR RADIO CSS START >>> */', '/* <<< HOMEPAGE-EDITOR RADIO CSS END <<< */');
  }
  return upsertBlock(customCss, '/* >>> HOMEPAGE-EDITOR RADIO CSS START >>> */', '/* <<< HOMEPAGE-EDITOR RADIO CSS END <<< */', radioCssTemplate);
}

// Parser for particles config in custom.js
export function parseParticlesConfig(customJs) {
  const defMatch = customJs.match(/const\s+DEFAULT_EFFECT\s*=\s*"([^"]+)"/);
  const defaultEffect = defMatch ? defMatch[1] : 'rocket';
  
  const funcMatch = customJs.match(/function\s+getDefaultEffects\(\)\s*\{\s*return\s+new\s+Set\(\s*\[([\s\S]*?)\]\s*\);\s*\}/);
  if (!funcMatch) {
    return {
      enabledEffects: [defaultEffect],
      defaultEffect
    };
  }
  
  const effectsText = funcMatch[1];
  const enabledEffects = effectsText
    .split(',')
    .map(e => e.trim().replace(/['"]/g, ''))
    .filter(Boolean);
    
  return {
    enabledEffects,
    defaultEffect
  };
}

// Check if particles are enabled in custom.js
export function isParticlesEnabled(customJs) {
  return customJs.includes('/* >>> HOMEPAGE-EDITOR PARTICLES JS START >>> */');
}

// Update custom.js with particles settings
export function updateParticlesInCustomJs(customJs, enabledEffects, defaultEffect, enabled) {
  if (!enabled) {
    return removeBlock(customJs, '/* >>> HOMEPAGE-EDITOR PARTICLES JS START >>> */', '/* <<< HOMEPAGE-EDITOR PARTICLES JS END <<< */');
  }
  
  const startMarker = '/* >>> HOMEPAGE-EDITOR PARTICLES JS START >>> */';
  const endMarker = '/* <<< HOMEPAGE-EDITOR PARTICLES JS END <<< */';
  
  const effectsStr = enabledEffects.map(e => `"${e}"`).join(', ');
  const defaultEffectLine = `const DEFAULT_EFFECT = "${defaultEffect}";`;
  const getDefaultEffectsFunc = `function getDefaultEffects() {\n    return new Set([${effectsStr}]);\n  }`;
  
  const startIndex = customJs.indexOf(startMarker);
  const endIndex = customJs.indexOf(endMarker);
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    let blockContent = customJs.substring(startIndex, endIndex + endMarker.length);
    // Replace const DEFAULT_EFFECT and getDefaultEffects() function
    blockContent = blockContent.replace(/const\s+DEFAULT_EFFECT\s*=\s*"[^"]+";/, defaultEffectLine);
    blockContent = blockContent.replace(/function\s+getDefaultEffects\(\)\s*\{[\s\S]*?\}/, getDefaultEffectsFunc);
    return customJs.substring(0, startIndex) + blockContent + customJs.substring(endIndex + endMarker.length);
  }
  
  // Block does not exist, insert template with our settings
  let configuredBlock = particlesJsTemplate;
  configuredBlock = configuredBlock.replace(/const\s+DEFAULT_EFFECT\s*=\s*"[^"]+";/, defaultEffectLine);
  configuredBlock = configuredBlock.replace(/function\s+getDefaultEffects\(\)\s*\{[\s\S]*?\}/, getDefaultEffectsFunc);
  return upsertBlock(customJs, startMarker, endMarker, configuredBlock);
}

// Update custom.css with particles styles
export function updateParticlesInCustomCss(customCss, enabled) {
  if (!enabled) {
    return removeBlock(customCss, '/* >>> HOMEPAGE-EDITOR PARTICLES CSS START >>> */', '/* <<< HOMEPAGE-EDITOR PARTICLES CSS END <<< */');
  }
  return upsertBlock(customCss, '/* >>> HOMEPAGE-EDITOR PARTICLES CSS START >>> */', '/* <<< HOMEPAGE-EDITOR PARTICLES CSS END <<< */', particlesCssTemplate);
}
