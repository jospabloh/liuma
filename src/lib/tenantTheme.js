const DEFAULT_THEME = {
  palette: {
    primary: '#4f46e5',
    secondary: '#6366f1',
    accent: '#8b5cf6',
    neutral: '#334155',
  },
  shades: {},
  source: 'default',
};

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3 ? normalized.split('').map((s) => s + s).join('') : normalized;
  const num = Number.parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

// Returns a space-separated HSL triplet ("243 75% 59%") suitable for the
// `hsl(var(--token))` consumption pattern used by the shadcn/Tailwind tokens.
function hexToHslTriplet(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / delta) % 6;
        break;
      case gn:
        h = (bn - rn) / delta + 2;
        break;
      default:
        h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function luminance({ r, g, b }) {
  const chan = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function distance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function mix(rgb, target, weight) {
  return {
    r: rgb.r * (1 - weight) + target.r * weight,
    g: rgb.g * (1 - weight) + target.g * weight,
    b: rgb.b * (1 - weight) + target.b * weight,
  };
}

function ensureAccessiblePair(bgHex, minContrast = 4.5) {
  let bg = hexToRgb(bgHex);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  if (contrastRatio(bg, white) >= minContrast) return { background: rgbToHex(bg), foreground: '#ffffff' };
  if (contrastRatio(bg, black) >= minContrast) return { background: rgbToHex(bg), foreground: '#000000' };
  let candidate = bg;
  for (let i = 1; i <= 10; i += 1) {
    candidate = mix(bg, black, i * 0.08);
    if (contrastRatio(candidate, white) >= minContrast) return { background: rgbToHex(candidate), foreground: '#ffffff' };
  }
  return { background: '#1f2937', foreground: '#ffffff' };
}

function generateShades(hex) {
  const rgb = hexToRgb(hex);
  return {
    soft: rgbToHex(mix(rgb, { r: 255, g: 255, b: 255 }, 0.85)),
    muted: rgbToHex(mix(rgb, { r: 255, g: 255, b: 255 }, 0.65)),
    strong: rgbToHex(mix(rgb, { r: 0, g: 0, b: 0 }, 0.25)),
  };
}

function normalizeHex(hex, fallback) {
  if (typeof hex !== 'string') return fallback;
  const value = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(value) || /^#[0-9a-f]{6}$/.test(value)) return value;
  return fallback;
}

function enforcePaletteSafety(palette) {
  const sanitized = {
    primary: normalizeHex(palette.primary, DEFAULT_THEME.palette.primary),
    secondary: normalizeHex(palette.secondary, DEFAULT_THEME.palette.secondary),
    accent: normalizeHex(palette.accent, DEFAULT_THEME.palette.accent),
    neutral: normalizeHex(palette.neutral, DEFAULT_THEME.palette.neutral),
  };
  const reasons = [];

  const roles = ['primary', 'secondary', 'accent', 'neutral'];
  for (const role of roles) {
    const pair = ensureAccessiblePair(sanitized[role], 4.5);
    if (pair.background !== sanitized[role]) {
      reasons.push(`${role}_contrast_adjusted`);
      sanitized[role] = pair.background;
    }
  }

  const primaryRgb = hexToRgb(sanitized.primary);
  const semanticSafeguards = {
    danger: '#dc2626',
    warning: '#d97706',
    success: '#16a34a',
  };
  for (const [name, semanticHex] of Object.entries(semanticSafeguards)) {
    const semanticRgb = hexToRgb(semanticHex);
    if (distance(primaryRgb, semanticRgb) < 26) {
      reasons.push(`primary_too_close_to_${name}`);
      sanitized.primary = ensureAccessiblePair(DEFAULT_THEME.palette.primary, 4.5).background;
      break;
    }
  }

  const uniqueCount = new Set(Object.values(sanitized)).size;
  if (uniqueCount < 2) {
    reasons.push('monochrome_palette_auto_spread');
    sanitized.secondary = ensureAccessiblePair(DEFAULT_THEME.palette.secondary, 4.5).background;
    sanitized.accent = ensureAccessiblePair(DEFAULT_THEME.palette.accent, 4.5).background;
    sanitized.neutral = ensureAccessiblePair(DEFAULT_THEME.palette.neutral, 4.5).background;
  }

  return { palette: sanitized, reasons };
}

export function extractPaletteFromImageData(imageData, options = {}) {
  const { targetCount = 4, minCount = 2 } = options;
  const bins = new Map();
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i]; const g = imageData[i + 1]; const b = imageData[i + 2]; const a = imageData[i + 3];
    if (a < 180) continue;
    const brightness = (r + g + b) / 3;
    if (brightness > 245 || brightness < 18) continue;
    const key = `${Math.round(r / 24) * 24}-${Math.round(g / 24) * 24}-${Math.round(b / 24) * 24}`;
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  const colors = [...bins.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => {
    const [r, g, b] = k.split('-').map(Number);
    return { r, g, b };
  });
  const distinct = [];
  for (const color of colors) {
    if (!distinct.some((picked) => distance(picked, color) < 42)) distinct.push(color);
    if (distinct.length >= targetCount) break;
  }
  const quality = distinct.length >= targetCount ? 'high' : distinct.length >= minCount ? 'low' : 'failed';
  if (quality === 'failed') return { ...DEFAULT_THEME, quality };

  const pickedHex = distinct.map(rgbToHex);
  const palette = {
    primary: pickedHex[0],
    secondary: pickedHex[1] || pickedHex[0],
    accent: pickedHex[2] || pickedHex[1] || pickedHex[0],
    neutral: pickedHex[3] || '#334155',
  };

  const { palette: safePalette, reasons } = enforcePaletteSafety(palette);
  if (reasons.length) {
    console.warn('tenant_theme_palette_adjusted', {
      reasons,
      originalPalette: palette,
      adjustedPalette: safePalette,
    });
  }

  return {
    palette: safePalette,
    shades: Object.fromEntries(Object.entries(safePalette).map(([name, hex]) => [name, generateShades(hex)])),
    source: 'logo',
    quality,
    extractedAt: new Date().toISOString(),
  };
}

export async function extractPaletteFromFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  const maxWidth = 160;
  const scale = Math.min(1, maxWidth / img.width);
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return extractPaletteFromImageData(data);
}

export function buildThemeCssVars(themeSettings = DEFAULT_THEME) {
  const { palette } = enforcePaletteSafety(themeSettings.palette || DEFAULT_THEME.palette);
  // Drive the shadcn `--primary`/`--ring` tokens (consumed as hsl(var(--token)))
  // from the tenant brand color so the school's identity reaches every
  // component, not just the few spots that read --tenant-primary directly.
  const primaryTriplet = hexToHslTriplet(palette.primary);
  const { r, g, b } = hexToRgb(palette.primary);
  const primaryRgbChannels = `${r} ${g} ${b}`;
  const primaryForeground = contrastRatio(hexToRgb(palette.primary), { r: 255, g: 255, b: 255 }) >= 3
    ? '0 0% 100%'
    : '30 10% 11%';
  return {
    '--tenant-primary': palette.primary,
    '--tenant-primary-rgb': primaryRgbChannels,
    '--tenant-secondary': palette.secondary,
    '--tenant-accent': palette.accent,
    '--tenant-neutral': palette.neutral,
    '--primary': primaryTriplet,
    '--primary-foreground': primaryForeground,
    '--ring': primaryTriplet,
    '--sidebar-primary': primaryTriplet,
    '--sidebar-primary-foreground': primaryForeground,
    '--sidebar-ring': primaryTriplet,
  };
}

export { DEFAULT_THEME, ensureAccessiblePair, enforcePaletteSafety };
