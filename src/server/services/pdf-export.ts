// PDF Export service for tournament brackets
import { jsPDF } from 'jspdf';

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

  const round1 = matches.filter(m => m.round === 1);
  const round2 = matches.filter(m => m.round === 2);
  const round3 = matches.filter(m => m.round === 3);

  const matchWidth = 105;   // Slightly wider for better readability
  const matchHeight = 45;   // Taller for better spacing
  const colSpacing = (width - matchWidth) / 3;

  // Round 1 - 4 matches with better spacing
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

  // Draw connecting lines (slightly thicker for print clarity)
  doc.setDrawColor(120);
  doc.setLineWidth(0.75);

  // R1 to R2 connections
  for (let i = 0; i < 2; i++) {
    const y1Top = y + i * 2 * r1Spacing + matchHeight / 2;
    const y1Bot = y + (i * 2 + 1) * r1Spacing + matchHeight / 2;
    const yMid = (y1Top + y1Bot) / 2;
    const x1 = x + matchWidth;
    const x2 = x + colSpacing;

    doc.line(x1, y1Top, x1 + 12, y1Top);
    doc.line(x1, y1Bot, x1 + 12, y1Bot);
    doc.line(x1 + 12, y1Top, x1 + 12, y1Bot);
    doc.line(x1 + 12, yMid, x2, yMid);
  }

  // R2 to R3 connections
  const y2Top = y + r1Spacing / 2 + matchHeight / 2;
  const y2Bot = y + r1Spacing / 2 + r2Spacing + matchHeight / 2;
  const yMid = (y2Top + y2Bot) / 2;
  const x2End = x + colSpacing + matchWidth;
  const x3Start = x + colSpacing * 2;

  doc.line(x2End, y2Top, x2End + 12, y2Top);
  doc.line(x2End, y2Bot, x2End + 12, y2Bot);
  doc.line(x2End + 12, y2Top, x2End + 12, y2Bot);
  doc.line(x2End + 12, yMid, x3Start, yMid);
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
  showResults: boolean
): void {
  // Match box
  doc.setDrawColor(0);
  doc.setLineWidth(1);
  doc.rect(x, y, width, height);

  // Divider line
  doc.setLineWidth(0.5);
  doc.line(x, y + height / 2, x + width, y + height / 2);

  // Match number (larger, bolder, more readable)
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text(`Match #${match.matchNumber}`, x + 3, y + 10);

  // Ring assignment if present
  if (match.ringNumber !== null && match.ringNumber !== undefined) {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text(`Ring ${match.ringNumber}`, x + width - 25, y + 8);
  }
  
  doc.setTextColor(0);

  // Competitor names (slightly larger for readability)
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  const c1Name = match.competitor1?.name || '________';
  const c2Name = match.competitor2?.name || '________';

  // Truncate long names but leave more room
  const maxLen = 18;
  const name1 = c1Name.length > maxLen ? c1Name.substring(0, maxLen - 2) + '..' : c1Name;
  const name2 = c2Name.length > maxLen ? c2Name.substring(0, maxLen - 2) + '..' : c2Name;

  doc.text(name1, x + 4, y + height / 4 + 5);
  doc.text(name2, x + 4, y + height * 3 / 4 + 5);

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
      doc.text(String(match.score1), x + width - 15, y + height / 4 + 5);
    }
    if (match.score2 !== null && match.score2 !== undefined) {
      doc.text(String(match.score2), x + width - 15, y + height * 3 / 4 + 5);
    }
  } else {
    // Empty score boxes for printing (slightly larger)
    doc.setDrawColor(180);
    doc.rect(x + width - 28, y + 4, 24, height / 2 - 8);
    doc.rect(x + width - 28, y + height / 2 + 4, 24, height / 2 - 8);
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
