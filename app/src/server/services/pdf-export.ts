// PDF Export service for tournament brackets
import { jsPDF } from 'jspdf';

export interface BracketCompetitor {
  id: string;
  name: string;
  school: string;
}

export interface BracketMatch {
  matchNumber: number;
  round: number;
  bracketType: 'winners' | 'losers' | 'finals';
  competitor1?: BracketCompetitor | null;
  competitor2?: BracketCompetitor | null;
  winner?: BracketCompetitor | null;
  score1?: number | null;
  score2?: number | null;
  status: string;
}

export interface DivisionInfo {
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  weightClass?: string | null;
}

export interface TournamentInfo {
  name: string;
  date: string;
  location?: string | null;
}

export interface BracketPDFOptions {
  tournament: TournamentInfo;
  division: DivisionInfo;
  matches: BracketMatch[];
  showResults?: boolean;
}

const PAGE_WIDTH = 612; // Letter size in points
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

/**
 * Generates a PDF for a single bracket
 */
export function generateBracketPDF(options: BracketPDFOptions): jsPDF {
  const { tournament, division, matches, showResults = false } = options;
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = PAGE_HEIGHT; // Landscape
  const pageHeight = PAGE_WIDTH;
  const margin = 30;

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(tournament.name, pageWidth / 2, margin, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(tournament.date, pageWidth / 2, margin + 15, { align: 'center' });
  if (tournament.location) {
    doc.text(tournament.location, pageWidth / 2, margin + 28, { align: 'center' });
  }

  // Division name
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(division.name, pageWidth / 2, margin + 50, { align: 'center' });

  // Separate matches by bracket type
  const winnersMatches = matches.filter(m => m.bracketType === 'winners');
  const losersMatches = matches.filter(m => m.bracketType === 'losers');
  const finalsMatches = matches.filter(m => m.bracketType === 'finals');

  // Draw bracket structure
  const bracketStartY = margin + 70;
  const bracketHeight = pageHeight - bracketStartY - margin;

  // Draw winners bracket on left side
  drawWinnersBracket(doc, winnersMatches, margin, bracketStartY, 350, bracketHeight, showResults);

  // Draw losers bracket in middle
  drawLosersBracket(doc, losersMatches, 400, bracketStartY, 250, bracketHeight, showResults);

  // Draw finals on right
  drawFinals(doc, finalsMatches, 680, bracketStartY + bracketHeight / 3, showResults);

  // Footer
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text(
    `Generated: ${new Date().toLocaleDateString()}`,
    pageWidth - margin,
    pageHeight - 15,
    { align: 'right' }
  );

  return doc;
}

function drawWinnersBracket(
  doc: jsPDF,
  matches: BracketMatch[],
  x: number,
  y: number,
  width: number,
  height: number,
  showResults: boolean
): void {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Winners Bracket', x + width / 2, y - 5, { align: 'center' });

  const round1 = matches.filter(m => m.round === 1);
  const round2 = matches.filter(m => m.round === 2);
  const round3 = matches.filter(m => m.round === 3);

  const matchWidth = 100;
  const matchHeight = 40;
  const colSpacing = (width - matchWidth) / 3;

  // Round 1 - 4 matches
  const r1Spacing = height / 4;
  round1.forEach((match, i) => {
    drawMatchBox(doc, match, x, y + i * r1Spacing, matchWidth, matchHeight, showResults);
  });

  // Round 2 - 2 matches
  const r2Spacing = height / 2;
  round2.forEach((match, i) => {
    drawMatchBox(
      doc,
      match,
      x + colSpacing,
      y + r1Spacing / 2 + i * r2Spacing,
      matchWidth,
      matchHeight,
      showResults
    );
  });

  // Round 3 - 1 match (winners final)
  if (round3.length > 0) {
    drawMatchBox(
      doc,
      round3[0],
      x + colSpacing * 2,
      y + height / 2 - matchHeight / 2,
      matchWidth,
      matchHeight,
      showResults
    );
  }

  // Draw connecting lines
  doc.setDrawColor(150);
  doc.setLineWidth(0.5);

  // R1 to R2 connections
  for (let i = 0; i < 2; i++) {
    const y1Top = y + i * 2 * r1Spacing + matchHeight / 2;
    const y1Bot = y + (i * 2 + 1) * r1Spacing + matchHeight / 2;
    const yMid = (y1Top + y1Bot) / 2;
    const x1 = x + matchWidth;
    const x2 = x + colSpacing;

    doc.line(x1, y1Top, x1 + 10, y1Top);
    doc.line(x1, y1Bot, x1 + 10, y1Bot);
    doc.line(x1 + 10, y1Top, x1 + 10, y1Bot);
    doc.line(x1 + 10, yMid, x2, yMid);
  }

  // R2 to R3 connections
  const y2Top = y + r1Spacing / 2 + matchHeight / 2;
  const y2Bot = y + r1Spacing / 2 + r2Spacing + matchHeight / 2;
  const yMid = (y2Top + y2Bot) / 2;
  const x2End = x + colSpacing + matchWidth;
  const x3Start = x + colSpacing * 2;

  doc.line(x2End, y2Top, x2End + 10, y2Top);
  doc.line(x2End, y2Bot, x2End + 10, y2Bot);
  doc.line(x2End + 10, y2Top, x2End + 10, y2Bot);
  doc.line(x2End + 10, yMid, x3Start, yMid);
}

function drawLosersBracket(
  doc: jsPDF,
  matches: BracketMatch[],
  x: number,
  y: number,
  width: number,
  height: number,
  showResults: boolean
): void {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Losers Bracket', x + width / 2, y - 5, { align: 'center' });

  const matchWidth = 90;
  const matchHeight = 35;

  // Group by rounds
  const rounds = new Map<number, BracketMatch[]>();
  matches.forEach(m => {
    if (!rounds.has(m.round)) rounds.set(m.round, []);
    rounds.get(m.round)!.push(m);
  });

  const numRounds = rounds.size;
  const colSpacing = width / (numRounds + 1);
  let col = 0;

  rounds.forEach((roundMatches, round) => {
    const spacing = height / (roundMatches.length + 1);
    roundMatches.forEach((match, i) => {
      drawMatchBox(
        doc,
        match,
        x + col * colSpacing,
        y + (i + 1) * spacing - matchHeight / 2,
        matchWidth,
        matchHeight,
        showResults
      );
    });
    col++;
  });
}

function drawFinals(
  doc: jsPDF,
  matches: BracketMatch[],
  x: number,
  y: number,
  showResults: boolean
): void {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Finals', x + 50, y - 15, { align: 'center' });

  const matchWidth = 100;
  const matchHeight = 45;

  matches.forEach((match, i) => {
    const label = match.matchNumber === 14 ? 'Grand Finals' :
                  match.matchNumber === 15 ? 'Reset (if needed)' : '';

    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text(label, x + matchWidth / 2, y + i * 80 - 5, { align: 'center' });

    drawMatchBox(doc, match, x, y + i * 80, matchWidth, matchHeight, showResults);
  });
}

function drawMatchBox(
  doc: jsPDF,
  match: BracketMatch,
  x: number,
  y: number,
  width: number,
  height: number,
  showResults: boolean
): void {
  // Match box
  doc.setDrawColor(0);
  doc.setLineWidth(1);
  doc.rect(x, y, width, height);

  // Divider line
  doc.setLineWidth(0.5);
  doc.line(x, y + height / 2, x + width, y + height / 2);

  // Match number
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`#${match.matchNumber}`, x + 2, y + 8);
  doc.setTextColor(0);

  // Competitor names
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');

  const c1Name = match.competitor1?.name || '________';
  const c2Name = match.competitor2?.name || '________';

  // Truncate long names
  const maxLen = 15;
  const name1 = c1Name.length > maxLen ? c1Name.substring(0, maxLen) + '...' : c1Name;
  const name2 = c2Name.length > maxLen ? c2Name.substring(0, maxLen) + '...' : c2Name;

  doc.text(name1, x + 15, y + height / 4 + 3);
  doc.text(name2, x + 15, y + height * 3 / 4 + 3);

  // Score boxes
  if (showResults && match.status === 'completed') {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');

    // Highlight winner
    if (match.winner) {
      const winnerY = match.winner.id === match.competitor1?.id ? y : y + height / 2;
      doc.setFillColor(230, 245, 230);
      doc.rect(x, winnerY, width, height / 2, 'F');
      doc.rect(x, y, width, height); // Redraw border
      doc.line(x, y + height / 2, x + width, y + height / 2);
    }

    if (match.score1 !== null && match.score1 !== undefined) {
      doc.text(String(match.score1), x + width - 15, y + height / 4 + 3);
    }
    if (match.score2 !== null && match.score2 !== undefined) {
      doc.text(String(match.score2), x + width - 15, y + height * 3 / 4 + 3);
    }
  } else {
    // Empty score boxes for printing
    doc.setDrawColor(180);
    doc.rect(x + width - 25, y + 3, 20, height / 2 - 6);
    doc.rect(x + width - 25, y + height / 2 + 3, 20, height / 2 - 6);
  }
}

/**
 * Generates a results PDF for completed brackets
 */
export function generateResultsPDF(
  tournament: TournamentInfo,
  divisions: Array<{
    division: DivisionInfo;
    placements: Array<{ place: number; name: string; school: string }>;
  }>
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  let currentY = MARGIN;

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(tournament.name, PAGE_WIDTH / 2, currentY, { align: 'center' });
  currentY += 25;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('Tournament Results', PAGE_WIDTH / 2, currentY, { align: 'center' });
  currentY += 20;

  doc.setFontSize(10);
  doc.text(tournament.date, PAGE_WIDTH / 2, currentY, { align: 'center' });
  if (tournament.location) {
    currentY += 12;
    doc.text(tournament.location, PAGE_WIDTH / 2, currentY, { align: 'center' });
  }
  currentY += 30;

  // Results by division
  for (const { division, placements } of divisions) {
    // Check if we need a new page
    if (currentY > PAGE_HEIGHT - 150) {
      doc.addPage();
      currentY = MARGIN;
    }

    // Division header
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(division.name, MARGIN, currentY);
    currentY += 5;

    // Underline
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, currentY, MARGIN + CONTENT_WIDTH, currentY);
    currentY += 15;

    // Placements
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    for (const p of placements) {
      const placeLabel = p.place === 1 ? '1st' :
                         p.place === 2 ? '2nd' :
                         p.place === 3 ? '3rd' : `${p.place}th`;

      const medal = p.place === 1 ? '🥇' :
                    p.place === 2 ? '🥈' :
                    p.place === 3 ? '🥉' : '';

      doc.text(`${placeLabel} Place: ${p.name}`, MARGIN + 20, currentY);
      doc.setTextColor(100);
      doc.text(`(${p.school})`, MARGIN + 200, currentY);
      doc.setTextColor(0);
      currentY += 14;
    }

    currentY += 15;
  }

  // Footer
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text(
    `Generated: ${new Date().toLocaleDateString()}`,
    PAGE_WIDTH - MARGIN,
    PAGE_HEIGHT - 20,
    { align: 'right' }
  );

  return doc;
}

/**
 * Generates a batch of bracket PDFs as a combined document
 */
export function generateBatchBracketsPDF(
  tournament: TournamentInfo,
  brackets: Array<{ division: DivisionInfo; matches: BracketMatch[] }>,
  showResults: boolean = false
): jsPDF {
  if (brackets.length === 0) {
    const doc = new jsPDF();
    doc.text('No brackets to export', 50, 50);
    return doc;
  }

  // Generate first bracket
  let doc = generateBracketPDF({
    tournament,
    division: brackets[0].division,
    matches: brackets[0].matches,
    showResults,
  });

  // Add remaining brackets on new pages
  for (let i = 1; i < brackets.length; i++) {
    doc.addPage('letter', 'landscape');
    const { division, matches } = brackets[i];

    // We need to draw on the new page - recreate the content
    const pageWidth = 792; // Landscape
    const pageHeight = 612;
    const margin = 30;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(tournament.name, pageWidth / 2, margin, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(tournament.date, pageWidth / 2, margin + 15, { align: 'center' });

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(division.name, pageWidth / 2, margin + 50, { align: 'center' });

    // Separate matches by bracket type
    const winnersMatches = matches.filter(m => m.bracketType === 'winners');
    const losersMatches = matches.filter(m => m.bracketType === 'losers');
    const finalsMatches = matches.filter(m => m.bracketType === 'finals');

    const bracketStartY = margin + 70;
    const bracketHeight = pageHeight - bracketStartY - margin;

    drawWinnersBracket(doc, winnersMatches, margin, bracketStartY, 350, bracketHeight, showResults);
    drawLosersBracket(doc, losersMatches, 400, bracketStartY, 250, bracketHeight, showResults);
    drawFinals(doc, finalsMatches, 680, bracketStartY + bracketHeight / 3, showResults);
  }

  return doc;
}
