import {
  ELIGIBILITY_LABELS,
  verdictLabel,
  type MatchResult,
} from '@trialmatch/shared';
import PDFDocument from 'pdfkit';
import type { Referral } from './matching.service';

const MARGIN = 50;
const MUTED = '#475569';
const INK = '#0f172a';

/**
 * The referral summary a coordinator sends to a study team: who the patient is
 * (pseudonym only), and for each shortlisted trial the decision, the
 * coordinator's note and every criterion with its verdict and reason.
 */
export function renderReferralPdf(
  { patient, run, trials }: Referral,
  now = new Date(),
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `Referral summary: ${patient.pseudonym}`,
      Author: 'TrialMatch',
      Subject: 'Clinical trial referral (decision support only)',
    },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - MARGIN * 2;
  const write = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: string; gap?: number } = {},
  ) => {
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.size ?? 10)
      .fillColor(opts.color ?? INK)
      .text(pdfText(text), { width });
    if (opts.gap) doc.moveDown(opts.gap);
  };

  write('Clinical trial referral summary', { size: 18, bold: true });
  write(
    `Prepared ${now.toISOString().slice(0, 10)} · ${trials.length} shortlisted ${trials.length === 1 ? 'trial' : 'trials'} · ` +
      `${run.engine === 'claude' ? 'assessed by Claude' : 'rule-based assessment'} on ${(run.finishedAt ?? run.createdAt).slice(0, 10)}`,
    { color: MUTED, gap: 1 },
  );

  write('Patient', { size: 13, bold: true });
  write(
    `${patient.pseudonym} · ${patient.age} years · ${patient.sex === 'female' ? 'Female' : 'Male'}`,
  );
  write(`Conditions: ${patient.conditions.join(', ') || 'none recorded'}`);
  write(`Medications: ${patient.medications.join(', ') || 'none recorded'}`);
  if (patient.notes) write(`Notes: ${patient.notes}`);
  doc.moveDown(1);

  trials.forEach((t, i) => trial(t, i + 1));

  // Footer on every page: the disclaimer and page numbers. It sits in the bottom
  // margin, so the margin is lifted while it is drawn (or PDFKit adds a page).
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Decision support only: the study team confirms eligibility. Page ${p + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - MARGIN + 15,
        { width, align: 'center', lineBreak: false },
      );
  }
  doc.end();
  return done;

  function trial(t: MatchResult, n: number) {
    if (doc.y > doc.page.height - 200) doc.addPage();
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + width, doc.y)
      .strokeColor('#cbd5e1')
      .stroke();
    doc.moveDown(0.5);
    write(`${n}. ${t.title}`, { size: 12, bold: true });
    write(
      [
        t.nctId ? `${t.nctId} (clinicaltrials.gov/study/${t.nctId})` : null,
        t.condition,
        ELIGIBILITY_LABELS[t.eligibility],
      ]
        .filter(Boolean)
        .join(' · '),
      { color: MUTED },
    );
    write(t.summary, { gap: 0.3 });
    if (t.note) write(`Coordinator note: ${t.note}`, { bold: true, gap: 0.3 });
    for (const a of t.assessments) {
      write(`${a.code}  ${verdictLabel(a)}: ${a.text}`, { bold: true });
      write(a.reason + (a.evidence ? ` ("${a.evidence}")` : ''), {
        color: MUTED,
        gap: 0.2,
      });
    }
    doc.moveDown(0.8);
  }
}

/**
 * The built-in PDF fonts cover Windows-1252 only. Common symbols in criteria
 * text are spelled out; anything else that cannot be drawn becomes "?".
 */
export function pdfText(s: string): string {
  return [...s.replace(/[≥≤≠→]/g, (c) => SPELLED[c])]
    .map((c) => (c.charCodeAt(0) <= 0xff || WIN_ANSI.has(c) ? c : '?'))
    .join('');
}

const SPELLED: Record<string, string> = {
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '→': '->',
};
const WIN_ANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
