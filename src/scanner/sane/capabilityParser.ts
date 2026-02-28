import type {
  ScanOption,
  ScanOptionBool,
  ScanOptionEnum,
  ScanOptionRange,
  ScannerCapabilityDetails,
} from '../../shared/types/domain.js';

/**
 * Parses the output of `scanimage -A --device-name=<device>` into structured capabilities.
 *
 * Example output format:
 *   --mode Color|Gray|Black & White [Color]
 *   --resolution 100|150|200|300|600|1200dpi [300]
 *   --source FlatBed|Automatic Document Feeder(left aligned) [FlatBed]
 *   --brightness -50..50% (in steps of 1) [0]
 *   --duplex[=(yes|no)] [inactive]
 *   -l 0..215.9mm [0]
 *   -x 0..215.9mm [215.9]
 */

// Regex patterns for common scanimage -A option formats
const OPTION_HEADER_RE = /^\s+(-{1,2}[\w-]+)/;
const ENUM_RE = /^\s+(-{1,2}[\w-]+)\s+(.+?)(?:\s+\[(.+?)\])?$/;
const RANGE_RE =
  /^\s+(-{1,2}[\w-]+)\s+(-?[\d.]+)\.\.(-?[\d.]+)([\w%]*)\s*(?:\(in steps of ([\d.]+)\))?\s*(?:\[(-?[\d.]+)\])?$/;
const BOOL_RE = /^\s+(-{1,2}[\w-]+)\[=\(yes\|no\)\]\s*(?:\[(.+?)\])?$/;

const normalizeOptionName = (raw: string): string => {
  // Strip leading dashes and normalize
  return raw
    .replace(/^-{1,2}/, '')
    .toLowerCase()
    .replace(/-/g, '_');
};

const parseEnumValues = (raw: string): { values: string[]; unit?: string } => {
  // Strip trailing unit from last value (e.g. "100|200|300dpi")
  const unitMatch = raw.match(/(dpi|mm|%|us)$/i);
  const unit = unitMatch?.[1]?.toLowerCase();
  const cleaned = unit ? raw.slice(0, -unit.length) : raw;
  const values = cleaned
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
  const result: { values: string[]; unit?: string } = { values };
  if (unit) result.unit = unit;
  return result;
};

const parseSingleLine = (line: string): [string, ScanOption] | null => {
  // Try boolean first (e.g. --duplex[=(yes|no)] [inactive])
  const boolMatch = line.match(BOOL_RE);
  if (boolMatch && boolMatch[1]) {
    const name = normalizeOptionName(boolMatch[1]);
    const defaultVal = boolMatch[2];
    const option: ScanOptionBool = {
      type: 'bool',
      inactive: defaultVal === 'inactive',
      default: defaultVal === 'yes',
    };
    return [name, option];
  }

  // Try range (e.g.  --brightness -50..50% (in steps of 1) [0])
  const rangeMatch = line.match(RANGE_RE);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2] && rangeMatch[3]) {
    const name = normalizeOptionName(rangeMatch[1]);
    const option: ScanOptionRange = {
      type: 'range',
      min: parseFloat(rangeMatch[2]),
      max: parseFloat(rangeMatch[3]),
    };
    if (rangeMatch[4]) option.unit = rangeMatch[4];
    if (rangeMatch[5]) option.step = parseFloat(rangeMatch[5]);
    if (rangeMatch[6] !== undefined) option.default = parseFloat(rangeMatch[6]);
    return [name, option];
  }

  // Try enum (e.g. --mode Color|Gray|Lineart [Color])
  // Must have at least one `|` to be an enum
  if (!OPTION_HEADER_RE.test(line)) {
    return null;
  }

  const enumMatch = line.match(ENUM_RE);
  if (enumMatch && enumMatch[1] && enumMatch[2] && enumMatch[2].includes('|')) {
    const name = normalizeOptionName(enumMatch[1]);
    const { values, unit } = parseEnumValues(enumMatch[2]);
    const option: ScanOptionEnum = {
      type: 'enum',
      values,
    };
    if (unit) option.unit = unit;
    if (enumMatch[3]) option.default = enumMatch[3];
    return [name, option];
  }

  return null;
};

/**
 * Parse scanimage -A output into structured capabilities.
 */
export const parseCapabilities = (stdout: string, device: string): ScannerCapabilityDetails => {
  const options: Record<string, ScanOption> = {};

  for (const line of stdout.split('\n')) {
    const parsed = parseSingleLine(line);
    if (parsed) {
      const [name, option] = parsed;
      options[name] = option;
    }
  }

  // Derive convenience fields
  const sourceOption = options.source;
  const sources: string[] = sourceOption?.type === 'enum' ? sourceOption.values : [];

  const modeOption = options.mode;
  const colorModes: string[] = modeOption?.type === 'enum' ? modeOption.values : [];

  const resOption = options.resolution;
  let resolutionsDpi: number[] = [];
  if (resOption?.type === 'enum') {
    resolutionsDpi = resOption.values.map(Number).filter((n) => !isNaN(n));
  } else if (resOption?.type === 'range') {
    // Generate a sensible list from a range
    const common = [75, 100, 150, 200, 300, 400, 600, 1200, 2400, 4800];
    resolutionsDpi = common.filter((r) => r >= resOption.min && r <= resOption.max);
    if (resolutionsDpi.length === 0) {
      resolutionsDpi = [resOption.min, resOption.max];
    }
  }

  const sourceLower = sources.map((s) => s.toLowerCase());
  const hasAdf = sourceLower.some(
    (s) => s.includes('adf') || s.includes('document feeder') || s.includes('feeder'),
  );
  const hasFlatbed = sourceLower.some((s) => s.includes('flatbed') || s.includes('flat'));
  const hasDuplex =
    (options.duplex?.type === 'bool' && !options.duplex.inactive) ||
    sourceLower.some((s) => s.includes('duplex'));

  // Geometry from -x and -y options
  const xOpt = options.x;
  const yOpt = options.y;

  const result: ScannerCapabilityDetails = {
    device,
    queriedAt: new Date().toISOString(),
    options,
    sources,
    colorModes,
    resolutionsDpi,
    hasAdf,
    hasFlatbed,
    hasDuplex,
  };

  if (xOpt?.type === 'range' && yOpt?.type === 'range') {
    result.geometry = { maxWidthMm: xOpt.max, maxHeightMm: yOpt.max };
  }

  return result;
};
