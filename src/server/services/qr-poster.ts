/**
 * QR Code Poster Generator
 * 
 * Generates printable PDF posters with QR codes for:
 * - Public registration
 * - Public scoreboard
 * 
 * Intended for venue signage (print on 8.5"x11" or A4).
 */

import jsPDF from 'jspdf';
import QRCode from 'qrcode';

interface PosterOptions {
  tournamentName: string;
  tournamentDate: string;
  location?: string | null;
  registrationUrl: string;
  scoreboardUrl: string;
  brandName?: string | null;
  brandPrimaryColor?: string;
}

/**
 * Generate a QR code poster PDF with registration and scoreboard links.
 * Returns a Buffer containing the PDF document.
 */
export async function generateQRPoster(options: PosterOptions): Promise<Buffer> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: 'letter',
  });

  const primaryColor = options.brandPrimaryColor || '#DC2626';
  const displayName = options.brandName || options.tournamentName;

  // Helper to convert hex to RGB
  const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
      : [220, 38, 38]; // Fallback red
  };

  // Title section
  doc.setFillColor(...hexToRgb(primaryColor));
  doc.rect(0, 0, 8.5, 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(255, 255, 255);
  doc.text(displayName, 4.25, 0.75, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.text(new Date(options.tournamentDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }), 4.25, 1.1, { align: 'center' });

  if (options.location) {
    doc.setFontSize(12);
    doc.text(options.location, 4.25, 1.35, { align: 'center' });
  }

  // Reset text color
  doc.setTextColor(0, 0, 0);

  // Registration section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('Register Now', 4.25, 2.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text('Scan to register for this tournament', 4.25, 2.9, { align: 'center' });

  // Generate registration QR code
  const registrationQR = await QRCode.toDataURL(options.registrationUrl, {
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  // Add registration QR code
  doc.addImage(registrationQR, 'PNG', 2.25, 3.2, 4, 4);

  // Registration URL text (smaller, below QR)
  doc.setFontSize(8);
  doc.text(options.registrationUrl, 4.25, 7.5, { align: 'center', maxWidth: 7.5 });

  // Divider line
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.01);
  doc.line(0.75, 8, 7.75, 8);

  // Scoreboard section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('Live Scoreboard', 4.25, 8.75, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text('Scan to view live match results', 4.25, 9.15, { align: 'center' });

  // Generate scoreboard QR code
  const scoreboardQR = await QRCode.toDataURL(options.scoreboardUrl, {
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  // Add scoreboard QR code
  doc.addImage(scoreboardQR, 'PNG', 2.25, 9.45, 4, 4);

  // Scoreboard URL text (smaller, below QR)
  doc.setFontSize(8);
  doc.text(options.scoreboardUrl, 4.25, 13.75, { align: 'center', maxWidth: 7.5 });

  // Return PDF as buffer
  return Buffer.from(doc.output('arraybuffer'));
}
