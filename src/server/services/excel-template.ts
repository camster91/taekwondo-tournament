import * as XLSX from 'xlsx';

/**
 * Column definitions for the import template
 */
interface TemplateColumn {
  header: string;
  key: string;
  required: boolean;
  example: string;
  note?: string;
}

export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  { header: 'First Name', key: 'firstName', required: true, example: 'John' },
  { header: 'Last Name', key: 'lastName', required: true, example: 'Smith' },
  { header: 'Gender', key: 'gender', required: true, example: 'M', note: 'M or F' },
  { header: 'Date of Birth', key: 'dateOfBirth', required: true, example: '2015-03-15', note: 'YYYY-MM-DD format' },
  { header: 'Belt', key: 'belt', required: true, example: 'Blue', note: 'White, Yellow, Green, Blue, Red, or Black' },
  { header: 'Dan Rank', key: 'danRank', required: false, example: '1st', note: 'Required for Black belts (1st-6th)' },
  { header: 'Weight (lbs)', key: 'weight', required: true, example: '85', note: 'Required for Sparring events' },
  { header: 'Height', key: 'height', required: false, example: "4'8\"", note: 'Optional, format: 5\'10" or inches' },
  { header: 'School/Dojang', key: 'school', required: true, example: 'Tiger TKD Academy' },
  { header: 'Patterns', key: 'patterns', required: false, example: 'Y', note: 'Y (or Yes, X, 1) to enter; blank if not' },
  { header: 'Sparring', key: 'sparring', required: false, example: 'Y', note: 'Y (or Yes, X, 1) to enter; blank if not' },
  { header: 'Special Needs', key: 'specialNeeds', required: false, example: '', note: 'Optional notes' },
];

/**
 * Sample data rows for the template
 */
const SAMPLE_DATA = [
  {
    'First Name': 'John',
    'Last Name': 'Smith',
    'Gender': 'M',
    'Date of Birth': '2015-03-15',
    'Belt': 'Blue',
    'Dan Rank': '',
    'Weight (lbs)': 85,
    'Height': "4'8\"",
    'School/Dojang': 'Tiger TKD Academy',
    'Patterns': 'Y',
    'Sparring': 'Y',
    'Special Needs': '',
  },
  {
    'First Name': 'Sarah',
    'Last Name': 'Johnson',
    'Gender': 'F',
    'Date of Birth': '2012-07-22',
    'Belt': 'Black',
    'Dan Rank': '1st',
    'Weight (lbs)': 95,
    'Height': "5'2\"",
    'School/Dojang': 'Elite Martial Arts',
    'Patterns': 'Y',
    'Sparring': 'Y',
    'Special Needs': '',
  },
  {
    'First Name': 'Michael',
    'Last Name': 'Lee',
    'Gender': 'M',
    'Date of Birth': '2010-11-08',
    'Belt': 'Red',
    'Dan Rank': '',
    'Weight (lbs)': 110,
    'Height': "5'5\"",
    'School/Dojang': 'Champions Dojang',
    'Patterns': 'Y',
    'Sparring': '',
    'Special Needs': '',
  },
  {
    'First Name': 'Emily',
    'Last Name': 'Chen',
    'Gender': 'F',
    'Date of Birth': '2018-01-30',
    'Belt': 'Yellow',
    'Dan Rank': '',
    'Weight (lbs)': 45,
    'Height': "3'6\"",
    'School/Dojang': 'Little Dragons TKD',
    'Patterns': 'Y',
    'Sparring': '',
    'Special Needs': '',
  },
  {
    'First Name': 'David',
    'Last Name': 'Park',
    'Gender': 'M',
    'Date of Birth': '1988-05-12',
    'Belt': 'Black',
    'Dan Rank': '3rd',
    'Weight (lbs)': 175,
    'Height': "5'10\"",
    'School/Dojang': 'Elite Martial Arts',
    'Patterns': 'Y',
    'Sparring': 'Y',
    'Special Needs': '',
  },
];

/** Sheet the example rows live on. Never imported (see excel-auto-map). */
export const EXAMPLE_SHEET_NAME = 'Example (not imported)';

/**
 * Generate the Excel import template: an empty "Competitors" sheet with
 * just the column headings (the sheet the app imports), an example sheet
 * showing filled-in rows, instructions and reference sheets. Keeping the
 * examples off the import sheet means a club can paste its roster
 * straight in without importing made-up people by mistake.
 */
export function generateImportTemplate(): Buffer {
  const workbook = XLSX.utils.book_new();
  const headers = TEMPLATE_COLUMNS.map(col => col.header);
  const columnWidths = [
    { wch: 15 }, // First Name
    { wch: 15 }, // Last Name
    { wch: 8 },  // Gender
    { wch: 14 }, // Date of Birth
    { wch: 10 }, // Belt
    { wch: 10 }, // Dan Rank
    { wch: 12 }, // Weight
    { wch: 10 }, // Height
    { wch: 25 }, // School
    { wch: 10 }, // Patterns
    { wch: 10 }, // Sparring
    { wch: 20 }, // Special Needs
  ];

  // The sheet that gets imported: headings only.
  const dataSheet = XLSX.utils.aoa_to_sheet([headers]);
  dataSheet['!cols'] = columnWidths;
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Competitors');

  const exampleSheet = XLSX.utils.json_to_sheet(SAMPLE_DATA, { header: headers });
  exampleSheet['!cols'] = columnWidths;
  XLSX.utils.book_append_sheet(workbook, exampleSheet, EXAMPLE_SHEET_NAME);

  // Create instructions sheet
  const instructions = [
    { 'Import Instructions': 'Competitor Import Template' },
    { 'Import Instructions': '' },
    { 'Import Instructions': 'HOW TO USE THIS TEMPLATE:' },
    { 'Import Instructions': '1. Open the "Competitors" sheet. Keep the headings in row 1.' },
    { 'Import Instructions': '2. Type or paste your competitors under the headings, one competitor per row.' },
    { 'Import Instructions': `   Copying from another spreadsheet? Paste each column under the matching heading. See the "${EXAMPLE_SHEET_NAME}" sheet for what filled-in rows look like.` },
    { 'Import Instructions': '3. Save the file as .xlsx.' },
    { 'Import Instructions': '4. In the app, open your tournament and choose "Import from spreadsheet" to add everyone straight to it,' },
    { 'Import Instructions': '   or go to Competitors > Import to add them to your competitor list only.' },
    { 'Import Instructions': '' },
    { 'Import Instructions': `Only the "Competitors" sheet is imported. The "${EXAMPLE_SHEET_NAME}" sheet and these instructions are ignored.` },
    { 'Import Instructions': '' },
    { 'Import Instructions': 'COLUMN REQUIREMENTS:' },
    { 'Import Instructions': '' },
  ];

  // Add column descriptions
  for (const col of TEMPLATE_COLUMNS) {
    const required = col.required ? '(Required)' : '(Optional)';
    const note = col.note ? ` - ${col.note}` : '';
    instructions.push({
      'Import Instructions': `${col.header} ${required}${note}`,
    });
  }

  instructions.push({ 'Import Instructions': '' });
  instructions.push({ 'Import Instructions': 'BELT OPTIONS:' });
  instructions.push({ 'Import Instructions': '  White, Yellow, Green, Blue, Red, Black' });
  instructions.push({ 'Import Instructions': '' });
  instructions.push({ 'Import Instructions': 'DAN RANK OPTIONS (for Black belts only):' });
  instructions.push({ 'Import Instructions': '  1st, 2nd, 3rd, 4th, 5th, 6th' });
  instructions.push({ 'Import Instructions': '' });
  instructions.push({ 'Import Instructions': 'DATE FORMAT:' });
  instructions.push({ 'Import Instructions': '  YYYY-MM-DD (e.g., 2015-03-15)' });
  instructions.push({ 'Import Instructions': '  or MM/DD/YYYY (e.g., 03/15/2015)' });
  instructions.push({ 'Import Instructions': '' });
  instructions.push({ 'Import Instructions': 'EVENTS:' });
  instructions.push({ 'Import Instructions': '  Enter "Y" (or Yes, X, 1) in the Patterns and/or Sparring column to enter that event' });
  instructions.push({ 'Import Instructions': '  Other sports: rename these two columns to your events (e.g. Kata and Kumite)' });
  instructions.push({ 'Import Instructions': '  Leave blank if not participating in that event' });
  instructions.push({ 'Import Instructions': '' });
  instructions.push({ 'Import Instructions': 'TIPS:' });
  instructions.push({ 'Import Instructions': '  - Weight is required for Sparring participants' });
  instructions.push({ 'Import Instructions': '  - Dan Rank is required for Black belt competitors' });
  instructions.push({ 'Import Instructions': '  - School/Dojang is used for seeding to avoid same-school matchups' });

  const instructionsSheet = XLSX.utils.json_to_sheet(instructions);
  instructionsSheet['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

  // Create belt reference sheet
  const beltReference = [
    { 'Belt': 'White', 'Level': 'Colored Belt (CB)', 'Order': 1 },
    { 'Belt': 'Yellow', 'Level': 'Colored Belt (CB)', 'Order': 2 },
    { 'Belt': 'Green', 'Level': 'Colored Belt (CB)', 'Order': 3 },
    { 'Belt': 'Blue', 'Level': 'Colored Belt (CB)', 'Order': 4 },
    { 'Belt': 'Red', 'Level': 'Colored Belt (CB)', 'Order': 5 },
    { 'Belt': 'Black - 1st Dan', 'Level': 'Black Belt (BB)', 'Order': 6 },
    { 'Belt': 'Black - 2nd Dan', 'Level': 'Black Belt (BB)', 'Order': 7 },
    { 'Belt': 'Black - 3rd Dan', 'Level': 'Black Belt (BB)', 'Order': 8 },
    { 'Belt': 'Black - 4th Dan', 'Level': 'Black Belt (BB)', 'Order': 9 },
    { 'Belt': 'Black - 5th Dan', 'Level': 'Black Belt (BB)', 'Order': 10 },
    { 'Belt': 'Black - 6th Dan', 'Level': 'Black Belt (BB)', 'Order': 11 },
  ];

  const beltSheet = XLSX.utils.json_to_sheet(beltReference);
  beltSheet['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, beltSheet, 'Belt Reference');

  // Create age groups reference sheet
  const ageGroups = [
    { 'Age Group': 'Tiny Tigers', 'Ages': '4-5' },
    { 'Age Group': 'Youth A', 'Ages': '6-7' },
    { 'Age Group': 'Youth B', 'Ages': '8-9' },
    { 'Age Group': 'Junior A', 'Ages': '10-11' },
    { 'Age Group': 'Junior B', 'Ages': '12-13' },
    { 'Age Group': 'Cadet', 'Ages': '14-15' },
    { 'Age Group': 'Junior', 'Ages': '16-17' },
    { 'Age Group': 'Senior', 'Ages': '18-32' },
    { 'Age Group': 'Ultra', 'Ages': '33-39' },
    { 'Age Group': 'Master A', 'Ages': '40-49' },
    { 'Age Group': 'Master B', 'Ages': '50-59' },
    { 'Age Group': 'Grand Master', 'Ages': '60+' },
  ];

  const ageSheet = XLSX.utils.json_to_sheet(ageGroups);
  ageSheet['!cols'] = [{ wch: 15 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, ageSheet, 'Age Groups');

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

/**
 * Get the default column mapping for standard template
 */
export function getDefaultColumnMapping() {
  return {
    firstName: 'First Name',
    lastName: 'Last Name',
    gender: 'Gender',
    dateOfBirth: 'Date of Birth',
    belt: 'Belt',
    danRank: 'Dan Rank',
    weight: 'Weight (lbs)',
    height: 'Height',
    school: 'School/Dojang',
    patterns: 'Patterns',
    sparring: 'Sparring',
    specialNeeds: 'Special Needs',
  };
}
