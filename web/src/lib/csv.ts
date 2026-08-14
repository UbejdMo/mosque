import type { ImportHousehold, ImportPerson } from './import-api';

/**
 * CSV path for anyone who would rather prepare the notebook in a spreadsheet
 * (SPEC §15).
 *
 * Rows sharing a `household_ref` become one household. Ticked years go in
 * `settled_years` as `2016;2017;2019`.
 */

export class CsvError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(message);
    this.line = line;
  }
}

/**
 * RFC 4180 parsing, done properly rather than by splitting on commas: village
 * notes contain commas, and a mis-split row would silently shift every column
 * after it.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  // Strip a UTF-8 BOM, which Excel adds and which would corrupt the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (index < input.length) {
    const char = input[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

const REQUIRED_COLUMNS = ['first_name', 'father_name', 'last_name', 'joined_year'] as const;

export interface CsvParseResult {
  households: ImportHousehold[];
  personCount: number;
}

export function csvToHouseholds(text: string): CsvParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new CsvError(1, 'The file has no data rows');

  const header = rows[0]!.map((cell) => cell.trim().toLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new CsvError(1, `Missing column "${column}"`);
  }

  const cell = (cells: string[], name: string): string => {
    const position = header.indexOf(name);
    return position === -1 ? '' : (cells[position] ?? '').trim();
  };

  // Insertion-ordered, so the imported households keep the notebook's order —
  // which is how the transcriber will check the result against the paper.
  const grouped = new Map<string, ImportHousehold>();

  rows.slice(1).forEach((cells, offset) => {
    const line = offset + 2;

    const person: ImportPerson = {
      firstName: cell(cells, 'first_name'),
      fatherName: cell(cells, 'father_name'),
      lastName: cell(cells, 'last_name'),
      joinedYear: requireYear(cell(cells, 'joined_year'), line, 'joined_year'),
      isHead: isTruthy(cell(cells, 'is_head')),
      livesAbroad: isTruthy(cell(cells, 'lives_abroad')),
    };
    if (!person.firstName || !person.fatherName || !person.lastName) {
      throw new CsvError(line, 'first_name, father_name and last_name are all required');
    }
    const leftYearRaw = cell(cells, 'left_year');
    if (leftYearRaw) person.leftYear = requireYear(leftYearRaw, line, 'left_year');

    // Without an explicit ref, each row is its own single-person household.
    const ref = cell(cells, 'household_ref') || `row-${line}`;
    const existing = grouped.get(ref);

    if (existing) {
      existing.persons.push(person);
      return;
    }

    grouped.set(ref, {
      neighbourhood: cell(cells, 'neighbourhood') || null,
      phone: cell(cells, 'phone') || null,
      notes: cell(cells, 'notes') || null,
      needsReview: isTruthy(cell(cells, 'needs_review')),
      persons: [person],
      settledYears: parseYearList(cell(cells, 'settled_years'), line),
    });
  });

  const households = [...grouped.values()];
  return {
    households,
    personCount: households.reduce((total, household) => total + household.persons.length, 0),
  };
}

function requireYear(value: string, line: number, column: string): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new CsvError(line, `"${value}" is not a valid ${column}`);
  }
  return year;
}

/** `2016;2017;2019` — semicolons, so the field survives a comma-separated file. */
function parseYearList(value: string, line: number): number[] {
  if (!value) return [];
  return value
    .split(/[;| ]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => requireYear(part, line, 'settled_years'));
}

function isTruthy(value: string): boolean {
  return ['1', 'true', 'yes', 'x', 'po', 'y'].includes(value.trim().toLowerCase());
}
