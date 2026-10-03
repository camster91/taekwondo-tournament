// PDF Export service for tournament brackets
import { jsPDF } from 'jspdf';
import { firstRoundSeedPairs } from './bracket-generator.js';
import { ordinal } from '../../shared/utils/classic-paper.js';

/**
 * Convert hex color to RGB array for jsPDF
 */
function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  return [r, g, b];
}

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
  ringNumber?: number | null;
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
  brandName?: string | null;
  brandLogoUrl?: string | null;
  brandPrimaryColor?: string | null;
}

export interface BracketPDFOptions {
  tournament: TournamentInfo;
  division: DivisionInfo;
  matches: BracketMatch[];
  showResults?: boolean;
  /**
   * Named positions from the bracket structure. Used by `drawFinals`
   * to label the grand finals + reset match correctly across bracket
   * sizes. The 8-person DE has GF at match 14 / reset at 15, but N=4
   * has GF at match 5 / no reset, and N=16 has GF at match 30 / reset
   * at 31. Without this, only 8-person brackets got labelled.
   */
  positions?: {
    grandFinals?: number | null;
    reset?: number | null;
  };
  ringNumber?: number | null;
  scheduleInfo?: {
    startTime?: string | null;
    estimatedDuration?: string | null;
  };
}

const PAGE_WIDTH = 612; // Letter size in points
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

/**
 * Draw fold marks at the edges of the page for cutting/folding guides.
 * These are print-shop standard guide marks for trimming or folding.
 */
function drawFoldMarks(doc: jsPDF, pageWidth: number, pageHeight: number): void {
  doc.setDrawColor(200);
  doc.setLineWidth(0.5);
  
  const markLength = 12;  // Slightly longer for visibility
  const markOffset = 4;   // Closer to edge
  
  // Top edge marks (at 1/3 and 2/3)
  const third = pageWidth / 3;
  doc.line(third, markOffset, third, markOffset + markLength);
  doc.line(third * 2, markOffset, third * 2, markOffset + markLength);
  
  // Bottom edge marks
  doc.line(third, pageHeight - markOffset - markLength, third, pageHeight - markOffset);
  doc.line(third * 2, pageHeight - markOffset - markLength, third * 2, pageHeight - markOffset);
  
  // Left edge marks (at 1/3 and 2/3)
  const thirdHeight = pageHeight / 3;
  doc.line(markOffset, thirdHeight, markOffset + markLength, thirdHeight);
  doc.line(markOffset, thirdHeight * 2, markOffset + markLength, thirdHeight * 2);
  
  // Right edge marks
  doc.line(pageWidth - markOffset - markLength, thirdHeight, pageWidth - markOffset, thirdHeight);
  doc.line(pageWidth - markOffset - markLength, thirdHeight * 2, pageWidth - markOffset, thirdHeight * 2);
  
  // Center cross-hair marks for perfect alignment
  doc.line(pageWidth / 2 - 6, markOffset, pageWidth / 2 + 6, markOffset);
  doc.line(pageWidth / 2 - 6, pageHeight - markOffset, pageWidth / 2 + 6, pageHeight - markOffset);
  doc.line(markOffset, pageHeight / 2 - 6, markOffset + markLength, pageHeight / 2);
  doc.line(pageWidth - markOffset - markLength, pageHeight / 2, pageWidth - markOffset, pageHeight / 2 + 6);
}

/**
 * Generates a PDF for a single bracket with print-ready features:
 * - Fold marks for easy cutting/folding
 * - Ring assignments
 * - Schedule context (start time, duration)
 * - Tenant branding (organizer name/logo, NO Bowin watermark)
 */
export function generateBracketPDF(options: BracketPDFOptions): jsPDF {
  const { tournament, division, matches, showResults = false, positions, ringNumber, scheduleInfo } = options;
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = PAGE_HEIGHT; // Landscape
  const pageHeight = PAGE_WIDTH;
  const margin = 30;

  // Draw fold marks (small lines at edges for cutting/folding guides)
  drawFoldMarks(doc, pageWidth, pageHeight);

  // Header with tenant branding
  const organizer = tournament.brandName || tournament.name;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(organizer, pageWidth / 2, margin, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(tournament.date, pageWidth / 2, margin + 15, { align: 'center' });
  if (tournament.location) {
    doc.text(tournament.location, pageWidth / 2, margin + 28, { align: 'center' });
  }

  // Division name with ring and schedule info
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  let divisionLine = division.name;
  if (ringNumber) {
    divisionLine += ` — Ring ${ringNumber}`;
  }
  doc.text(divisionLine, pageWidth / 2, margin + 50, { align: 'center' });

  // Schedule info if provided
  if (scheduleInfo?.startTime || scheduleInfo?.estimatedDuration) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    let scheduleLine = '';
    if (scheduleInfo.startTime) scheduleLine += `Start: ${scheduleInfo.startTime}`;
    if (scheduleInfo.estimatedDuration) {
      if (scheduleLine) scheduleLine += ' • ';
      scheduleLine += `Duration: ${scheduleInfo.estimatedDuration}`;
    }
    doc.text(scheduleLine, pageWidth / 2, margin + 65, { align: 'center' });
  }

  // Separate matches by bracket type
  const winnersMatches = matches.filter(m => m.bracketType === 'winners');
  const losersMatches = matches.filter(m => m.bracketType === 'losers');
  const finalsMatches = matches.filter(m => m.bracketType === 'finals');

  // Draw bracket structure (adjust start based on whether schedule info was shown)
  const bracketStartY = margin + (scheduleInfo?.startTime || scheduleInfo?.estimatedDuration ? 80 : 70);
  const bracketHeight = pageHeight - bracketStartY - margin;

  // Draw winners bracket on left side
  drawWinnersBracket(doc, winnersMatches, margin, bracketStartY, 350, bracketHeight, showResults);

  // Draw losers bracket in middle
  drawLosersBracket(doc, losersMatches, 400, bracketStartY, 250, bracketHeight, showResults);

  // Draw finals on right
  drawFinals(doc, finalsMatches, 680, bracketStartY + bracketHeight / 3, showResults, positions);

  // Footer with tenant branding (NO Bowin watermark)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  const footerText = tournament.brandName 
    ? `${tournament.brandName} • Generated: ${new Date().toLocaleDateString()}`
    : `Generated: ${new Date().toLocaleDateString()}`;
  doc.text(footerText, pageWidth / 2, pageHeight - 15, { align: 'center' });

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
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Winners Bracket', x + width / 2, y - 8, { align: 'center' });

  // Rounds come from the data, so every size (including the winners
  // final in round 4+ of a 9-64 person bracket) is laid out.
  const roundNumbers = [...new Set(matches.map(m => m.round))].sort((a, b) => a - b);
  if (roundNumbers.length === 0) return;
  const rounds = roundNumbers.map(round =>
    matches.filter(m => m.round === round).sort((a, b) => a.matchNumber - b.matchNumber),
  );

  // Each round gets an equal column and each match an equal vertical slot
  // in its round; boxes shrink (with their text) when the largest round
  // has more matches than fit at full size, so nothing leaves the page.
  const CONNECTOR_GAP = 14;
  const SLOT_GAP = 4;
  const colWidth = width / rounds.length;
  const maxMatches = Math.max(...rounds.map(r => r.length));
  const matchWidth = Math.min(105, colWidth - CONNECTOR_GAP);
  const matchHeight = Math.min(45, height / maxMatches - SLOT_GAP);
  const scale = Math.min(1, matchWidth / 105, matchHeight / 45);

  const centerY = (roundIndex: number, i: number) => y + (height / rounds[roundIndex].length) * (i + 0.5);

  rounds.forEach((roundMatches, r) => {
    roundMatches.forEach((match, i) => {
      drawMatchBox(
        doc,
        match,
        x + r * colWidth,
        centerY(r, i) - matchHeight / 2,
        matchWidth,
        matchHeight,
        showResults,
        scale,
      );
    });
  });

  // Draw connecting lines (slightly thicker for print clarity): each match
  // feeds the next round's match at the same relative position.
  doc.setDrawColor(120);
  doc.setLineWidth(0.75);
  for (let r = 0; r < rounds.length - 1; r++) {
    const from = rounds[r];
    const to = rounds[r + 1];
    if (to.length === 0) continue;
    const xFrom = x + r * colWidth + matchWidth;
    const xTo = x + (r + 1) * colWidth;
    const xMid = xFrom + (xTo - xFrom) / 2;
    from.forEach((_, i) => {
      const target = Math.min(to.length - 1, Math.floor((i * to.length) / from.length));
      const yFrom = centerY(r, i);
      const yTo = centerY(r + 1, target);
      doc.line(xFrom, yFrom, xMid, yFrom);
      doc.line(xMid, yFrom, xMid, yTo);
      doc.line(xMid, yTo, xTo, yTo);
    });
  }
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
  showResults: boolean,
  positions?: { grandFinals?: number | null; reset?: number | null }
): void {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Finals', x + 50, y - 15, { align: 'center' });

  const matchWidth = 100;
  const matchHeight = 45;

  matches.forEach((match, i) => {
    // Label the grand finals + reset by their actual match numbers
    // (passed in via positions), not hardcoded 14/15. Falls back to
    // the historical 8-person defaults when positions aren't supplied
    // (matches the same legacy-bracket fallback in match-advancement).
    const grandFinalsMatch = positions?.grandFinals ?? 14;
    const resetMatchNumber = positions?.reset ?? 15;
    const label = match.matchNumber === grandFinalsMatch ? 'Grand Finals' :
                  match.matchNumber === resetMatchNumber ? 'Reset (if needed)' : '';

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
  showResults: boolean,
  /** Shrinks text and insets for boxes smaller than the 105x45 default. */
  scale = 1
): void {
  const k = scale;
  // Match box
  doc.setDrawColor(0);
  doc.setLineWidth(1);
  doc.rect(x, y, width, height);

  // Divider line
  doc.setLineWidth(0.5);
  doc.line(x, y + height / 2, x + width, y + height / 2);

  // Match number (larger, bolder, more readable)
  doc.setFontSize(9 * k);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text(`Match #${match.matchNumber}`, x + 3 * k, y + 10 * k);

  // Ring assignment if present
  if (match.ringNumber !== null && match.ringNumber !== undefined) {
    doc.setFontSize(7 * k);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text(`Ring ${match.ringNumber}`, x + width - 25 * k, y + 8 * k);
  }
  
  doc.setTextColor(0);

  // Competitor names (slightly larger for readability)
  doc.setFontSize(9 * k);
  doc.setFont('helvetica', 'normal');

  const c1Name = match.competitor1?.name || '________';
  const c2Name = match.competitor2?.name || '________';

  // Truncate long names but leave more room
  const maxLen = 18;
  const name1 = c1Name.length > maxLen ? c1Name.substring(0, maxLen - 2) + '..' : c1Name;
  const name2 = c2Name.length > maxLen ? c2Name.substring(0, maxLen - 2) + '..' : c2Name;

  doc.text(name1, x + 4 * k, y + height / 4 + 5 * k);
  doc.text(name2, x + 4 * k, y + height * 3 / 4 + 5 * k);

  // Score boxes
  if (showResults && match.status === 'completed') {
    doc.setFontSize(10 * k);
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
      doc.text(String(match.score1), x + width - 15 * k, y + height / 4 + 5 * k);
    }
    if (match.score2 !== null && match.score2 !== undefined) {
      doc.text(String(match.score2), x + width - 15 * k, y + height * 3 / 4 + 5 * k);
    }
  } else {
    // Empty score boxes for printing (slightly larger)
    doc.setDrawColor(180);
    doc.rect(x + width - 28 * k, y + 4 * k, 24 * k, height / 2 - 8 * k);
    doc.rect(x + width - 28 * k, y + height / 2 + 4 * k, 24 * k, height / 2 - 8 * k);
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
export interface CertificateData {
  competitorName: string;
  place: number;
  divisionName: string;
  eventType: string;
  tournament: TournamentInfo;
  branding?: {
    organizationName?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
  };
}

/**
 * Generates a certificate PDF for a medal winner
 */
export function generateCertificatePDF(data: CertificateData): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = 792;
  const pageHeight = 612;
  const centerX = pageWidth / 2;

  // Use branding primary color if available, else default to gold
  const borderColor = data.branding?.primaryColor 
    ? hexToRgb(data.branding.primaryColor) 
    : [180, 140, 80];

  // Decorative border
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.setLineWidth(3);
  doc.rect(30, 30, pageWidth - 60, pageHeight - 60);
  doc.setLineWidth(1.5);
  doc.rect(40, 40, pageWidth - 80, pageHeight - 80);

  // Inner decorative corners
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  const cornerSize = 30;
  // Top-left
  doc.line(50, 55, 50 + cornerSize, 55);
  doc.line(55, 50, 55, 50 + cornerSize);
  // Top-right
  doc.line(pageWidth - 50 - cornerSize, 55, pageWidth - 50, 55);
  doc.line(pageWidth - 55, 50, pageWidth - 55, 50 + cornerSize);
  // Bottom-left
  doc.line(50, pageHeight - 55, 50 + cornerSize, pageHeight - 55);
  doc.line(55, pageHeight - 50 - cornerSize, 55, pageHeight - 50);
  // Bottom-right
  doc.line(pageWidth - 50 - cornerSize, pageHeight - 55, pageWidth - 50, pageHeight - 55);
  doc.line(pageWidth - 55, pageHeight - 50 - cornerSize, pageWidth - 55, pageHeight - 50);

  // Certificate header
  doc.setTextColor(80, 60, 40);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('CERTIFICATE OF ACHIEVEMENT', centerX, 90, { align: 'center' });

  // Organization name if provided (tenant branding)
  let currentY = 110;
  if (data.branding?.organizationName) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Presented by ${data.branding.organizationName}`, centerX, currentY, { align: 'center' });
    currentY += 20;
  } else {
    currentY = 130;
  }

  // Tournament name
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(data.tournament.name, centerX, currentY, { align: 'center' });

  // Date and location
  currentY += 25;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  let subLine = data.tournament.date;
  if (data.tournament.location) {
    subLine += ` • ${data.tournament.location}`;
  }
  doc.text(subLine, centerX, currentY, { align: 'center' });

  // "This certifies that"
  currentY += 45;
  doc.setFontSize(14);
  doc.text('This certifies that', centerX, currentY, { align: 'center' });

  // Competitor name (large and prominent)
  currentY += 50;
  doc.setFontSize(36);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(data.competitorName, centerX, currentY, { align: 'center' });

  // Decorative line under name
  currentY += 15;
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.setLineWidth(1);
  const nameWidth = doc.getTextWidth(data.competitorName);
  doc.line(centerX - nameWidth / 2 - 20, currentY, centerX + nameWidth / 2 + 20, currentY);

  // "has been awarded"
  currentY += 35;
  doc.setTextColor(80, 60, 40);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('has been awarded', centerX, currentY, { align: 'center' });

  // Place (with medal color)
  currentY += 65;
  const placeText = data.place === 1 ? '1ST PLACE' :
                    data.place === 2 ? '2ND PLACE' :
                    data.place === 3 ? '3RD PLACE' : `${data.place}TH PLACE`;

  const medalColor = data.place === 1 ? [218, 165, 32] : // Gold
                     data.place === 2 ? [150, 150, 150] : // Silver
                     data.place === 3 ? [205, 127, 50] : // Bronze
                     [100, 100, 100];

  doc.setFontSize(48);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(medalColor[0], medalColor[1], medalColor[2]);
  doc.text(placeText, centerX, currentY, { align: 'center' });

  // Medal symbol
  const medalSymbol = data.place === 1 ? '★' :
                      data.place === 2 ? '★' :
                      data.place === 3 ? '★' : '';
  if (medalSymbol) {
    doc.setFontSize(24);
    const placeWidth = doc.getTextWidth(placeText);
    doc.text(medalSymbol, centerX - placeWidth / 2 - 30, currentY, { align: 'center' });
    doc.text(medalSymbol, centerX + placeWidth / 2 + 30, currentY, { align: 'center' });
  }

  // Division name
  currentY += 55;
  doc.setTextColor(80, 60, 40);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(data.divisionName, centerX, currentY, { align: 'center' });

  // Event type
  currentY += 25;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(data.eventType.charAt(0).toUpperCase() + data.eventType.slice(1), centerX, currentY, { align: 'center' });

  // Signature lines at bottom
  const sigY = pageHeight - 100;
  const sigWidth = 150;

  // Left signature (Director)
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(100, sigY, 100 + sigWidth, sigY);
  doc.setFontSize(10);
  doc.text('Tournament Director', 100 + sigWidth / 2, sigY + 15, { align: 'center' });

  // Right signature (Date)
  doc.line(pageWidth - 100 - sigWidth, sigY, pageWidth - 100, sigY);
  doc.text('Date', pageWidth - 100 - sigWidth / 2, sigY + 15, { align: 'center' });

  // No footer watermark - certificates are fully tenant-branded

  return doc;
}

/**
 * Generates certificates for all medal winners in a tournament
 */
export function generateBatchCertificatesPDF(
  tournament: TournamentInfo,
  winners: Array<{
    competitorName: string;
    place: number;
    divisionName: string;
    eventType: string;
  }>,
  branding?: {
    organizationName?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
  }
): jsPDF {
  if (winners.length === 0) {
    const doc = new jsPDF();
    doc.text('No winners to generate certificates for', 50, 50);
    return doc;
  }

  // Generate first certificate
  let doc = generateCertificatePDF({
    ...winners[0],
    tournament,
    branding,
  });

  // Add remaining certificates on new pages
  for (let i = 1; i < winners.length; i++) {
    doc.addPage('letter', 'landscape');

    const pageWidth = 792;
    const pageHeight = 612;
    const centerX = pageWidth / 2;
    const data = { ...winners[i], tournament };

    // Decorative border
    doc.setDrawColor(180, 140, 80);
    doc.setLineWidth(3);
    doc.rect(30, 30, pageWidth - 60, pageHeight - 60);
    doc.setLineWidth(1.5);
    doc.rect(40, 40, pageWidth - 80, pageHeight - 80);

    // Inner decorative corners
    const cornerSize = 30;
    doc.line(50, 55, 50 + cornerSize, 55);
    doc.line(55, 50, 55, 50 + cornerSize);
    doc.line(pageWidth - 50 - cornerSize, 55, pageWidth - 50, 55);
    doc.line(pageWidth - 55, 50, pageWidth - 55, 50 + cornerSize);
    doc.line(50, pageHeight - 55, 50 + cornerSize, pageHeight - 55);
    doc.line(55, pageHeight - 50 - cornerSize, 55, pageHeight - 50);
    doc.line(pageWidth - 50 - cornerSize, pageHeight - 55, pageWidth - 50, pageHeight - 55);
    doc.line(pageWidth - 55, pageHeight - 50 - cornerSize, pageWidth - 55, pageHeight - 50);

    // Certificate content
    doc.setTextColor(80, 60, 40);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text('CERTIFICATE OF ACHIEVEMENT', centerX, 90, { align: 'center' });

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(data.tournament.name, centerX, 130, { align: 'center' });

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    let subLine = data.tournament.date;
    if (data.tournament.location) {
      subLine += ` • ${data.tournament.location}`;
    }
    doc.text(subLine, centerX, 155, { align: 'center' });

    doc.setFontSize(14);
    doc.text('This certifies that', centerX, 200, { align: 'center' });

    doc.setFontSize(36);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(data.competitorName, centerX, 250, { align: 'center' });

    doc.setDrawColor(180, 140, 80);
    doc.setLineWidth(1);
    const nameWidth = doc.getTextWidth(data.competitorName);
    doc.line(centerX - nameWidth / 2 - 20, 265, centerX + nameWidth / 2 + 20, 265);

    doc.setTextColor(80, 60, 40);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text('has been awarded', centerX, 300, { align: 'center' });

    const placeText = data.place === 1 ? '1ST PLACE' :
                      data.place === 2 ? '2ND PLACE' :
                      data.place === 3 ? '3RD PLACE' : `${data.place}TH PLACE`;

    const medalColor = data.place === 1 ? [218, 165, 32] :
                       data.place === 2 ? [150, 150, 150] :
                       data.place === 3 ? [205, 127, 50] :
                       [100, 100, 100];

    doc.setFontSize(48);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(medalColor[0], medalColor[1], medalColor[2]);
    doc.text(placeText, centerX, 365, { align: 'center' });

    const medalSymbol = data.place <= 3 ? '★' : '';
    if (medalSymbol) {
      doc.setFontSize(24);
      const placeWidth = doc.getTextWidth(placeText);
      doc.text(medalSymbol, centerX - placeWidth / 2 - 30, 365, { align: 'center' });
      doc.text(medalSymbol, centerX + placeWidth / 2 + 30, 365, { align: 'center' });
    }

    doc.setTextColor(80, 60, 40);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(data.divisionName, centerX, 420, { align: 'center' });

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text(data.eventType.charAt(0).toUpperCase() + data.eventType.slice(1), centerX, 445, { align: 'center' });

    const sigY = pageHeight - 100;
    const sigWidth = 150;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(100, sigY, 100 + sigWidth, sigY);
    doc.setFontSize(10);
    doc.text('Tournament Director', 100 + sigWidth / 2, sigY + 15, { align: 'center' });
    doc.line(pageWidth - 100 - sigWidth, sigY, pageWidth - 100, sigY);
    doc.text('Date', pageWidth - 100 - sigWidth / 2, sigY + 15, { align: 'center' });

    // No footer watermark - certificates are fully tenant-branded
  }

  return doc;
}

export interface SchoolReportData {
  schoolName: string;
  tournament: TournamentInfo;
  placements: Array<{
    competitorName: string;
    divisionName: string;
    eventType: string;
    place: number;
  }>;
  summary: {
    gold: number;
    silver: number;
    bronze: number;
    total: number;
  };
  branding?: {
    organizationName?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
  };
}

/**
 * Generates a school-specific results PDF
 */
export function generateSchoolReportPDF(data: SchoolReportData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  let currentY = MARGIN;

  // Header with school name
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text('SCHOOL RESULTS REPORT', PAGE_WIDTH / 2, currentY, { align: 'center' });
  currentY += 15;

  // Organization name if provided (tenant branding)
  if (data.branding?.organizationName) {
    doc.setFontSize(10);
    doc.text(`Hosted by ${data.branding.organizationName}`, PAGE_WIDTH / 2, currentY, { align: 'center' });
    currentY += 20;
  } else {
    currentY += 10;
  }

  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text(data.schoolName, PAGE_WIDTH / 2, currentY, { align: 'center' });
  currentY += 30;

  // Tournament info
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(data.tournament.name, PAGE_WIDTH / 2, currentY, { align: 'center' });
  currentY += 15;

  doc.setFontSize(10);
  doc.text(data.tournament.date, PAGE_WIDTH / 2, currentY, { align: 'center' });
  if (data.tournament.location) {
    currentY += 12;
    doc.text(data.tournament.location, PAGE_WIDTH / 2, currentY, { align: 'center' });
  }
  currentY += 30;

  // Medal summary box
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(MARGIN, currentY, CONTENT_WIDTH, 60, 5, 5, 'F');

  const medalBoxWidth = CONTENT_WIDTH / 4;
  const medalY = currentY + 20;

  // Gold
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(218, 165, 32);
  doc.text(String(data.summary.gold), MARGIN + medalBoxWidth / 2, medalY, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Gold', MARGIN + medalBoxWidth / 2, medalY + 18, { align: 'center' });

  // Silver
  doc.setFontSize(24);
  doc.setTextColor(150, 150, 150);
  doc.text(String(data.summary.silver), MARGIN + medalBoxWidth * 1.5, medalY, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Silver', MARGIN + medalBoxWidth * 1.5, medalY + 18, { align: 'center' });

  // Bronze
  doc.setFontSize(24);
  doc.setTextColor(205, 127, 50);
  doc.text(String(data.summary.bronze), MARGIN + medalBoxWidth * 2.5, medalY, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Bronze', MARGIN + medalBoxWidth * 2.5, medalY + 18, { align: 'center' });

  // Total
  doc.setFontSize(24);
  doc.setTextColor(0);
  doc.text(String(data.summary.total), MARGIN + medalBoxWidth * 3.5, medalY, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Total', MARGIN + medalBoxWidth * 3.5, medalY + 18, { align: 'center' });

  currentY += 80;

  // Results table header
  doc.setFillColor(50, 50, 50);
  doc.rect(MARGIN, currentY, CONTENT_WIDTH, 25, 'F');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255);
  doc.text('Place', MARGIN + 10, currentY + 17);
  doc.text('Competitor', MARGIN + 70, currentY + 17);
  doc.text('Division', MARGIN + 230, currentY + 17);
  doc.text('Event', MARGIN + 450, currentY + 17);

  currentY += 25;

  // Results rows
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);

  // Sort by place, then by division
  const sortedPlacements = [...data.placements].sort((a, b) => {
    if (a.place !== b.place) return a.place - b.place;
    return a.divisionName.localeCompare(b.divisionName);
  });

  for (const p of sortedPlacements) {
    // Check if we need a new page
    if (currentY > PAGE_HEIGHT - 60) {
      doc.addPage();
      currentY = MARGIN;

      // Repeat header on new page
      doc.setFillColor(50, 50, 50);
      doc.rect(MARGIN, currentY, CONTENT_WIDTH, 25, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255);
      doc.text('Place', MARGIN + 10, currentY + 17);
      doc.text('Competitor', MARGIN + 70, currentY + 17);
      doc.text('Division', MARGIN + 230, currentY + 17);
      doc.text('Event', MARGIN + 450, currentY + 17);
      currentY += 25;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
    }

    // Alternate row colors
    if (sortedPlacements.indexOf(p) % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(MARGIN, currentY, CONTENT_WIDTH, 22, 'F');
    }

    const placeText = p.place === 1 ? '1st' :
                      p.place === 2 ? '2nd' :
                      p.place === 3 ? '3rd' : `${p.place}th`;

    // Place with medal color
    const medalColor = p.place === 1 ? [218, 165, 32] :
                       p.place === 2 ? [150, 150, 150] :
                       p.place === 3 ? [205, 127, 50] :
                       [100, 100, 100];

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(medalColor[0], medalColor[1], medalColor[2]);
    doc.text(placeText, MARGIN + 10, currentY + 15);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0);
    doc.text(p.competitorName, MARGIN + 70, currentY + 15);

    // Truncate long division names
    const maxDivLen = 35;
    const divName = p.divisionName.length > maxDivLen
      ? p.divisionName.substring(0, maxDivLen) + '...'
      : p.divisionName;
    doc.text(divName, MARGIN + 230, currentY + 15);

    doc.text(p.eventType.charAt(0).toUpperCase() + p.eventType.slice(1), MARGIN + 450, currentY + 15);

    currentY += 22;
  }

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(
    `Generated: ${new Date().toLocaleDateString()}`,
    PAGE_WIDTH - MARGIN,
    PAGE_HEIGHT - 20,
    { align: 'right' }
  );

  return doc;
}

/**
 * Payload for a single bracket page in a batch PDF export. Includes
 * the named `positions` so the grand finals + reset labels render
 * correctly across bracket sizes (matches the single-bracket PDF
 * which got this fix in PR #96).
 */
export interface BatchBracketEntry {
  division: DivisionInfo;
  matches: BracketMatch[];
  positions?: {
    grandFinals?: number | null;
    reset?: number | null;
  };
}

export function generateBatchBracketsPDF(
  tournament: TournamentInfo,
  brackets: BatchBracketEntry[],
  showResults: boolean = false
): jsPDF {
  if (brackets.length === 0) {
    const doc = new jsPDF();
    doc.text('No brackets to export', 50, 50);
    return doc;
  }

  // The first bracket goes through the full generateBracketPDF path
  // (which sets up the doc with landscape Letter, header, footer,
  // and the bracket drawing). Each subsequent bracket is appended
  // on a new page using the same drawing helpers — and now with
  // the same `positions`-aware labelling the single-bracket path got.
  let doc = generateBracketPDF({
    tournament,
    division: brackets[0].division,
    matches: brackets[0].matches,
    showResults,
    positions: brackets[0].positions,
  });

  for (let i = 1; i < brackets.length; i++) {
    doc.addPage('letter', 'landscape');
    const { division, matches, positions } = brackets[i];

    // Header with tenant branding (consistent with single-bracket export)
    const pageWidth = 792; // Landscape Letter
    const pageHeight = 612;
    const margin = 30;

    // Draw fold marks on each page
    drawFoldMarks(doc, pageWidth, pageHeight);

    const organizer = tournament.brandName || tournament.name;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(organizer, pageWidth / 2, margin, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(tournament.date, pageWidth / 2, margin + 15, { align: 'center' });
    if (tournament.location) {
      doc.text(tournament.location, pageWidth / 2, margin + 28, { align: 'center' });
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(division.name, pageWidth / 2, margin + 50, { align: 'center' });

    const winnersMatches = matches.filter((m) => m.bracketType === 'winners');
    const losersMatches = matches.filter((m) => m.bracketType === 'losers');
    const finalsMatches = matches.filter((m) => m.bracketType === 'finals');

    const bracketStartY = margin + 70;
    const bracketHeight = pageHeight - bracketStartY - margin;

    drawWinnersBracket(doc, winnersMatches, margin, bracketStartY, 350, bracketHeight, showResults);
    drawLosersBracket(doc, losersMatches, 400, bracketStartY, 250, bracketHeight, showResults);
    // drawFinals is the helper that draws "Grand Finals" / "Reset"
    // labels — pass `positions` so non-8-person brackets get the
    // right match numbers (regression of the same bug fixed in
    // PR #96 for the single-bracket PDF).
    drawFinals(doc, finalsMatches, 680, bracketStartY + bracketHeight / 3, showResults, positions);

    // Footer with tenant branding (NO Bowin watermark)
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    const footerText = tournament.brandName 
      ? `${tournament.brandName} • Generated: ${new Date().toLocaleDateString()}`
      : `Generated: ${new Date().toLocaleDateString()}`;
    doc.text(footerText, pageWidth / 2, pageHeight - 15, { align: 'center' });
  }

  return doc;
}

// ============ Classic paper bracket ============
//
// Matches the sheets the old events printed (see the `CB Females
// Sparring/` etc. folders at the repo root): legal landscape, a single
// elimination tree (16 → 8 → 4 → 2 → winner, or the 8/4/2 sheet for
// smaller divisions), header like "SPARRING Females 10 - 11 Heavy",
// each slot "Name / School" (plus dan for black belts), 1st/2nd/3rd
// boxes on the right and the belt or dan range in the footer.

export interface ClassicSlot {
  id: string;
  name: string;
  school?: string | null;
  danRank?: number | null;
}

export interface ClassicColumnLayout {
  x: number;
  width: number;
  /** Baseline y of each slot line, top to bottom. */
  slotYs: number[];
}

export interface ClassicLayout {
  /** Sheet size: 2, 4, 8, 16, 32 ... first-round slots. */
  capacity: number;
  /** Slot columns (capacity, capacity/2, ..., 2) then the winner column (1). */
  columns: ClassicColumnLayout[];
  placementBoxes: Array<{ label: string; x: number; y: number; width: number; height: number }>;
  page: { width: number; height: number };
  bracketTop: number;
  bracketBottom: number;
}

const CLASSIC_PAGE = { width: 1008, height: 612 }; // US legal, landscape
const CLASSIC_LEFT = 18;
const CLASSIC_TREE_RIGHT = 780;
const CLASSIC_BOXES_X = 800;
const CLASSIC_BOXES_WIDTH = 190;
const CLASSIC_TOP = 78;
const CLASSIC_BOTTOM = 572;

/** Smallest classic sheet (2/4/8/16/32...) that holds `entrants`. */
export function classicSheetCapacity(entrants: number): number {
  let size = 2;
  while (size < entrants) size *= 2;
  return size;
}

/**
 * Geometry of a classic sheet. Pure so the slot positions can be unit
 * tested: each slot in a later column sits exactly halfway between the
 * two slots that feed it.
 */
export function classicBracketLayout(capacity: number): ClassicLayout {
  const size = classicSheetCapacity(capacity);
  const slotColumns = Math.round(Math.log2(size));
  const columnCount = slotColumns + 1; // + winner column
  const total = CLASSIC_TREE_RIGHT - CLASSIC_LEFT;
  const firstWidth = total * Math.max(0.27, 1 / columnCount);
  const restWidth = (total - firstWidth) / (columnCount - 1);
  const height = CLASSIC_BOTTOM - CLASSIC_TOP;

  const columns: ClassicColumnLayout[] = [];
  let x = CLASSIC_LEFT;
  for (let c = 0; c < columnCount; c++) {
    const count = size / 2 ** c;
    const width = c === 0 ? firstWidth : restWidth;
    const slotYs = Array.from({ length: count }, (_, j) => CLASSIC_TOP + ((j + 0.5) * height) / count);
    columns.push({ x, width, slotYs });
    x += width;
  }

  const labels = size >= 4 ? ['1st', '2nd', '3rd', '3rd'] : ['1st', '2nd'];
  const boxHeight = 46;
  const gap = 22;
  const placementBoxes = labels.map((label, i) => ({
    label,
    x: CLASSIC_BOXES_X,
    y: 110 + i * (boxHeight + gap),
    width: CLASSIC_BOXES_WIDTH,
    height: boxHeight,
  }));

  return {
    capacity: size,
    columns,
    placementBoxes,
    page: CLASSIC_PAGE,
    bracketTop: CLASSIC_TOP,
    bracketBottom: CLASSIC_BOTTOM,
  };
}

export interface ClassicMatchInput {
  bracketType: string;
  roundNumber: number;
  matchNumber: number;
  competitor1: ClassicSlot | null;
  competitor2: ClassicSlot | null;
  winner: ClassicSlot | null;
}

export interface ClassicRounds {
  /** columns[0] = first-round slots; columns[k] = who reached column k; last = winner. */
  columns: Array<Array<ClassicSlot | null>>;
  placements: { first: ClassicSlot | null; second: ClassicSlot | null; thirds: ClassicSlot[] };
  /** True when no bracket exists yet and the order is the draft seed order. */
  draft: boolean;
}

/**
 * Fill a classic sheet. With a bracket, the first column follows its
 * round-1 matches (so byes face the same seeds as on screen). Winners,
 * the champion and 1st/2nd/3rd are filled in only for single
 * elimination, where the paper tree is the real bracket; any other
 * format gets the starting names on a blank tree for scoring by hand.
 * Without a bracket, entrants are laid out in standard seed order as a
 * draft.
 */
export function buildClassicRounds(
  bracket: { format: string | null; matches: ClassicMatchInput[] } | null,
  entrants: ClassicSlot[],
): ClassicRounds {
  const noPlacements = (): ClassicRounds['placements'] => ({ first: null, second: null, thirds: [] });

  if (!bracket || bracket.matches.length === 0) {
    const capacity = classicSheetCapacity(entrants.length);
    const first: Array<ClassicSlot | null> = [];
    for (const [a, b] of firstRoundSeedPairs(capacity)) {
      first.push(entrants[a] ?? null, entrants[b] ?? null);
    }
    return { columns: classicEmptyColumns(first), placements: noPlacements(), draft: true };
  }

  const byNumber = (a: ClassicMatchInput, b: ClassicMatchInput) => a.matchNumber - b.matchNumber;
  let roundOne = bracket.matches
    .filter((m) => m.bracketType === 'winners' && m.roundNumber === 1)
    .sort(byNumber);
  if (roundOne.length === 0) {
    // 1-2 competitors: the only match is the final.
    roundOne = bracket.matches.filter((m) => m.bracketType === 'finals').sort(byNumber).slice(0, 1);
  }
  const columns = classicEmptyColumns(roundOne.flatMap((m) => [m.competitor1, m.competitor2]));

  if (bracket.format !== 'single_elim') {
    return { columns, placements: noPlacements(), draft: false };
  }

  // Single elimination: the winners of round c, in match order, fill column c.
  const elimination = bracket.matches
    .filter((m) => m.bracketType === 'winners' || m.bracketType === 'finals')
    .sort(byNumber);
  for (let c = 1; c < columns.length; c++) {
    elimination
      .filter((m) => m.roundNumber === c)
      .forEach((m, j) => {
        if (j < columns[c].length && m.winner) columns[c][j] = m.winner;
      });
  }

  const finalRound = columns.length - 1;
  const loserOf = (m: ClassicMatchInput): ClassicSlot | null => {
    if (!m.winner) return null;
    if (m.competitor1 && m.competitor1.id !== m.winner.id) return m.competitor1;
    if (m.competitor2 && m.competitor2.id !== m.winner.id) return m.competitor2;
    return null;
  };
  const placements = noPlacements();
  const final = elimination.filter((m) => m.roundNumber === finalRound).at(-1);
  if (final?.winner) {
    placements.first = final.winner;
    placements.second = loserOf(final);
  }
  if (finalRound >= 2) {
    for (const semi of elimination.filter((m) => m.roundNumber === finalRound - 1)) {
      const loser = loserOf(semi);
      if (loser) placements.thirds.push(loser);
    }
  }
  return { columns, placements, draft: false };
}

/** First column padded to a sheet size, then empty later columns down to the winner. */
export function classicEmptyColumns(first: Array<ClassicSlot | null>): Array<Array<ClassicSlot | null>> {
  const capacity = classicSheetCapacity(first.length);
  const columns: Array<Array<ClassicSlot | null>> = [
    [...first, ...Array<ClassicSlot | null>(capacity - first.length).fill(null)],
  ];
  for (let count = capacity / 2; count >= 1; count /= 2) {
    columns.push(Array<ClassicSlot | null>(count).fill(null));
  }
  return columns;
}

function fitText(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/** "School · 2nd Dan" under a name. */
export function classicSlotDetail(slot: ClassicSlot): string {
  const parts: string[] = [];
  if (slot.school) parts.push(slot.school);
  if (slot.danRank) parts.push(`${ordinal(slot.danRank)} Dan`);
  return parts.join(' - ');
}

export interface ClassicBracketSheet {
  /** e.g. "SPARRING Females 10 - 11 Heavy" */
  title: string;
  divisionName: string;
  /** e.g. "Colour belts: Blue and Red" — printed in the footer. */
  beltRange: string;
  rounds: ClassicRounds;
}

function drawClassicSheet(doc: jsPDF, tournament: TournamentInfo, sheet: ClassicBracketSheet): void {
  const layout = classicBracketLayout(sheet.rounds.columns[0].length);
  const { width: pageWidth, height: pageHeight } = layout.page;
  const bandTop = layout.bracketTop - 18;
  const bandHeight = layout.bracketBottom - layout.bracketTop + 30;

  // Alternating light bands behind the columns, like the old template.
  doc.setFillColor(242, 242, 242);
  layout.columns.forEach((col, c) => {
    if (c % 2 === 0) doc.rect(col.x, bandTop, col.width, bandHeight, 'F');
  });
  doc.rect(CLASSIC_BOXES_X - 6, bandTop, CLASSIC_BOXES_WIDTH + 12, bandHeight, 'F');

  // Header: organizer on the left, division title on the right.
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(fitText(doc, tournament.brandName || tournament.name, 380), CLASSIC_LEFT, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(fitText(doc, [tournament.date, tournament.location].filter(Boolean).join(' - '), 380), CLASSIC_LEFT, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(fitText(doc, sheet.title, 560), pageWidth - CLASSIC_LEFT, 30, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(fitText(doc, sheet.divisionName, 560), pageWidth - CLASSIC_LEFT, 44, { align: 'right' });

  // Tree lines: a line per slot, and a bar joining each pair.
  doc.setDrawColor(0);
  doc.setLineWidth(1);
  layout.columns.forEach((col, c) => {
    col.slotYs.forEach((y) => doc.line(col.x, y, col.x + col.width, y));
    if (c < layout.columns.length - 1) {
      for (let k = 0; k < col.slotYs.length; k += 2) {
        doc.line(col.x + col.width, col.slotYs[k], col.x + col.width, col.slotYs[k + 1]);
      }
    }
  });

  // Names on the lines.
  const height = layout.bracketBottom - layout.bracketTop;
  layout.columns.forEach((col, c) => {
    const twoLines = height / col.slotYs.length >= 26;
    const slots = sheet.rounds.columns[c] ?? [];
    const maxWidth = col.width - 8;
    col.slotYs.forEach((y, j) => {
      const slot = slots[j];
      if (!slot) {
        // Mark a first-round bye so nobody writes a name there.
        const partner = slots[j % 2 === 0 ? j + 1 : j - 1];
        if (c === 0 && partner) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(7);
          doc.setTextColor(130);
          doc.text('Bye', col.x + 4, y - 3);
          doc.setTextColor(0);
        }
        return;
      }
      const detail = classicSlotDetail(slot);
      doc.setFont('helvetica', 'bold');
      if (twoLines) {
        doc.setFontSize(9);
        doc.text(fitText(doc, slot.name, maxWidth), col.x + 4, y - (detail ? 12 : 3));
        if (detail) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.text(fitText(doc, detail, maxWidth), col.x + 4, y - 3);
        }
      } else {
        doc.setFontSize(7);
        doc.text(fitText(doc, detail ? `${slot.name} (${detail})` : slot.name, maxWidth), col.x + 4, y - 2);
      }
    });
  });

  // 1st / 2nd / 3rd boxes.
  const { placements } = sheet.rounds;
  const placed = [placements.first, placements.second, placements.thirds[0] ?? null, placements.thirds[1] ?? null];
  layout.placementBoxes.forEach((box, i) => {
    // Text colour shares the PDF fill state, so set white on every box.
    doc.setFillColor(255, 255, 255);
    doc.rect(box.x, box.y, box.width, box.height, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(box.label, box.x + 6, box.y + 13);
    const slot = placed[i];
    if (slot) {
      doc.setFontSize(9);
      doc.text(fitText(doc, slot.name, box.width - 12), box.x + 6, box.y + 28);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(fitText(doc, classicSlotDetail(slot), box.width - 12), box.x + 6, box.y + 39);
    }
  });

  // Footer: belt / dan range, plus a note when no bracket exists yet.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(fitText(doc, sheet.beltRange, 600), CLASSIC_LEFT, pageHeight - 14);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(110);
  const note = sheet.rounds.draft
    ? 'Draft order - brackets not made yet'
    : `Printed ${new Date().toLocaleDateString()}`;
  doc.text(note, pageWidth - CLASSIC_LEFT, pageHeight - 14, { align: 'right' });
  doc.setTextColor(0);
}

/** One classic sheet as its own legal-landscape PDF. */
export function generateClassicBracketPDF(tournament: TournamentInfo, sheet: ClassicBracketSheet): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'legal' });
  drawClassicSheet(doc, tournament, sheet);
  return doc;
}
