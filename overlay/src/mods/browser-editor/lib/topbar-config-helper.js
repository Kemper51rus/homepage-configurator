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
      const separatorIndex = normalizedLine.indexOf(',');
      if (separatorIndex === -1) return null;
      
      const label = normalizedLine.slice(0, separatorIndex).trim();
      const url = normalizedLine.slice(separatorIndex + 1).trim();
      return { id: `station-${index}`, label, url, isDefault };
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

export function parseIpConfig(customJs) {
  const hideMatch = customJs.match(/const\s+ipHideOnError\s*=\s*(true|false)/);
  
  return {
    ipProviders: parseIpProviders(customJs),
    ipHideOnError: hideMatch ? hideMatch[1] === 'true' : true
  };
}

// Check if radio is enabled in custom.js
export function isRadioEnabled(customJs) {
  return customJs.includes('/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */');
}

// Update custom.js with radio settings
export function updateRadioInCustomJs(customJs, stations, enabled, ipProviders = [], ipHideOnError = true) {
  if (!enabled) {
    return removeBlock(customJs, '/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */', '/* <<< HOMEPAGE-EDITOR RADIO JS END <<< */');
  }
  
  // Generate the station list string
  const stationsText = stations.map(s => {
    const prefix = s.isDefault ? '* ' : '';
    return `    ${prefix}${s.label}, ${s.url}`;
  }).join('\n');
  const serializedList = `\n${stationsText}\n  `;
  
  // Generate the ip providers list string
  const ipProvidersText = ipProviders.map(p => {
    const jsonKeyPart = p.jsonKey ? `, ${p.jsonKey}` : '';
    return `    ${p.label}, ${p.url}${jsonKeyPart}`;
  }).join('\n');
  const serializedIpList = `\n${ipProvidersText}\n  `;
  
  // If block exists, update it
  const startMarker = '/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */';
  const endMarker = '/* <<< HOMEPAGE-EDITOR RADIO JS END <<< */';
  
  const providerListDecl = `const ipProviderList = \`${serializedIpList}\`;`;
  const hideLine = `const ipHideOnError = ${ipHideOnError};`;
  
  const startIndex = customJs.indexOf(startMarker);
  const endIndex = customJs.indexOf(endMarker);
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    let blockContent = customJs.substring(startIndex, endIndex + endMarker.length);
    // Replace the stationList definition inside the block
    blockContent = blockContent.replace(/(const\s+stationList\s*=\s*`)([\s\S]*?)(`)/, `$1${serializedList}$3`);
    
    // Replace ipProviderList
    if (blockContent.includes('const ipProviderList =')) {
      blockContent = blockContent.replace(/(const\s+ipProviderList\s*=\s*`)([\s\S]*?)(`)/, `$1${serializedIpList}$3`);
    } else {
      // Remove old const ipProvider = ... line if any
      blockContent = blockContent.replace(/const\s+ipProvider\s*=\s*"[^"]+";\n?\s*/, '');
      blockContent = blockContent.replace('const stationList =', `${providerListDecl}\n  const stationList =`);
    }
    
    // Replace ipHideOnError
    if (blockContent.includes('const ipHideOnError =')) {
      blockContent = blockContent.replace(/const\s+ipHideOnError\s*=\s*(true|false);/, hideLine);
    } else {
      blockContent = blockContent.replace('const stationList =', `${hideLine}\n  const stationList =`);
    }
    
    return customJs.substring(0, startIndex) + blockContent + customJs.substring(endIndex + endMarker.length);
  }
  
  // Block does not exist, insert template with our serialized list
  const baseTemplate = radioJsTemplate;
  let configuredBlock = baseTemplate.replace(/(const\s+stationList\s*=\s*`)([\s\S]*?)(`)/, `$1${serializedList}$3`);
  configuredBlock = configuredBlock.replace(/(const\s+ipProviderList\s*=\s*`)([\s\S]*?)(`)/, `$1${serializedIpList}$3`);
  configuredBlock = configuredBlock.replace(/const\s+ipHideOnError\s*=\s*(true|false);/, hideLine);
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
