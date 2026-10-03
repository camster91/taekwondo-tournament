/**
 * Naming shared by the "classic" paper brackets (one legal-landscape
 * sheet per division, zipped into folders like the old
 * `CB Females Sparring/` directories) and the printable ring schedule,
 * so a volunteer can find a division's sheet from the schedule.
 *
 * Event names always come from the caller (getEventTypeLabel), never a
 * hardcoded "Patterns"/"Sparring".
 */

export interface ClassicDivisionNaming {
  name: string;
  beltLevel: string;
  gender: string;
  ageMin: number;
  ageMax: number;
  weightClass?: string | null;
  beltColors?: string | null; // JSON array, as stored on Division
  danMin?: number | null;
  danMax?: number | null;
}

/** "Males" / "Females" / "Mixed", as the old sheets wrote it. */
export function genderPlural(gender: string): string {
  if (gender === 'M') return 'Males';
  if (gender === 'F') return 'Females';
  return 'Mixed';
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

/**
 * Make a division or folder name safe as a file name on Windows, macOS
 * and Linux. "/" becomes "_" so "Blue/Red" reads "Blue_Red", like the
 * old files ("All Blue_All Red Belts").
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned.slice(0, 120) || 'Division';
}

/** Folder for a division's sheet, e.g. "CB Females Sparring". */
export function classicFolderName(beltLevel: string, gender: string, eventLabel: string): string {
  return safeFileName(`${beltLevel} ${genderPlural(gender)} ${eventLabel}`);
}

/** Age band as the old headers wrote it: "10 - 11", "36 Plus". */
export function ageBandLabel(ageMin: number, ageMax: number): string {
  if (ageMax >= 99) return `${ageMin} Plus`;
  if (ageMin <= 0) return `${ageMax} and Under`;
  if (ageMin === ageMax) return String(ageMin);
  return `${ageMin} - ${ageMax}`;
}

/** Sheet header, e.g. "SPARRING Females 10 - 11 Heavy". */
export function classicHeaderTitle(division: ClassicDivisionNaming, eventLabel: string): string {
  const parts = [
    eventLabel.toUpperCase(),
    genderPlural(division.gender),
    ageBandLabel(division.ageMin, division.ageMax),
  ];
  if (division.weightClass) parts.push(division.weightClass);
  return parts.join(' ');
}

function parseBeltColors(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Belt or dan range printed at the foot of the sheet, e.g.
 * "Black belts: 1st - 2nd Dan" or "Colour belts: Blue and Red".
 */
export function beltRangeLabel(division: ClassicDivisionNaming): string {
  if (division.beltLevel === 'BB') {
    const { danMin, danMax } = division;
    if (danMin != null && danMax != null) {
      return danMin === danMax
        ? `Black belts: ${ordinal(danMin)} Dan`
        : `Black belts: ${ordinal(danMin)} - ${ordinal(danMax)} Dan`;
    }
    if (danMin != null) return `Black belts: ${ordinal(danMin)} Dan and up`;
    return 'Black belts';
  }
  const colors = parseBeltColors(division.beltColors);
  if (colors.length === 0) return 'Colour belts';
  if (colors.length === 1) return `Colour belts: ${colors[0]}`;
  if (colors.length === 2) return `Colour belts: ${colors[0]} and ${colors[1]}`;
  return `Colour belts: ${colors[0]} to ${colors[colors.length - 1]}`;
}

/**
 * Where a division's sheet sits inside the ZIP, e.g.
 * "CB Females Sparring/10-11 CB-All Blue_Red Belts Females Sparring Heavy.pdf".
 * `taken` de-duplicates identical names by adding " (2)", " (3)", ...
 */
export function classicZipPath(
  division: Pick<ClassicDivisionNaming, 'name' | 'beltLevel' | 'gender'>,
  eventLabel: string,
  taken: Set<string>,
): string {
  const folder = classicFolderName(division.beltLevel, division.gender, eventLabel);
  const base = safeFileName(division.name);
  let path = `${folder}/${base}.pdf`;
  for (let n = 2; taken.has(path.toLowerCase()); n++) {
    path = `${folder}/${base} (${n}).pdf`;
  }
  taken.add(path.toLowerCase());
  return path;
}

export interface FittedText {
  text: string;
  fontSize: number;
  /** True when the text still did not fit at `minSize` and was cut with "…". */
  truncated: boolean;
}

/**
 * Fit text into `maxWidth` by shrinking the font (from `maxSize` down to
 * `minSize`) instead of cutting names at a fixed length. Only when it
 * still does not fit at `minSize` is it cut with "…". `measure` returns
 * the width of `text` at `fontSize` (with jsPDF:
 * `doc.getStringUnitWidth(t) * size / doc.internal.scaleFactor`). Width
 * grows in step with the font size, so one measurement picks the size.
 */
export function fitTextToWidth(
  text: string,
  maxWidth: number,
  measure: (text: string, fontSize: number) => number,
  maxSize: number,
  minSize = 6,
): FittedText {
  const width = measure(text, maxSize);
  if (width <= maxWidth) return { text, fontSize: maxSize, truncated: false };
  // Quarter-point steps, rounded down so the result always fits.
  const size = Math.floor(((maxSize * maxWidth) / width) * 4) / 4;
  if (size >= minSize) return { text, fontSize: size, truncated: false };
  let cut = text;
  while (cut.length > 1 && measure(`${cut.trimEnd()}…`, minSize) > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, fontSize: minSize, truncated: true };
}
