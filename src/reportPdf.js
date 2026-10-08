/* ==========================================================================
   Report → PDF renderer (client side, jsPDF + autoTable).
   Takes the JSON returned by GET /api/reports/:type?format=json and lays it
   out as a landscape A4 document: header band, highlight boxes, one table
   per section with totals, and a confidential footer with page numbers.
   Standard PDF fonts have no ₹ glyph, so money is printed as "INR 1,23,456".
   ========================================================================== */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const INK = [19, 33, 59];
const MUTED = [98, 110, 132];
const LINE = [221, 226, 234];
const ZEBRA = [247, 249, 252];
const ACCENTS = { rrd: [35, 40, 107], fractio: [255, 106, 19], varnam: [122, 84, 140], group: [43, 80, 200] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const money = (n) => `INR ${inr(n)}`;
const fmtDate = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (v || '');
};
const cell = (col, v) => {
  if (v === null || v === undefined || v === '') return col.type === 'money' ? '0' : '—';
  if (col.type === 'money') return inr(v);
  if (col.type === 'date') return fmtDate(v);
  return String(v);
};

export function buildReportPdf(report, { brandKey = 'group' } = {}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const accent = ACCENTS[brandKey] || ACCENTS.group;

  // Header band
  doc.setFillColor(...INK);
  doc.rect(0, 0, W, 64, 'F');
  doc.setFillColor(...accent);
  doc.rect(0, 64, W, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(report.title || 'Report', M, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${report.scopeLabel || 'All companies'}  ·  ${report.period || ''}`, M, 48);
  const gen = report.generatedAt ? new Date(report.generatedAt) : new Date();
  doc.setFontSize(9);
  doc.text(`Generated ${fmtDate(gen.toISOString())}, ${gen.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`, W - M, 30, { align: 'right' });
  doc.text('HRMS · Management report', W - M, 48, { align: 'right' });

  // Highlights
  let y = 88;
  const hl = report.highlights || [];
  if (hl.length) {
    const gap = 10;
    const n = Math.min(hl.length, 6);
    const bw = (W - 2 * M - gap * (n - 1)) / n;
    hl.slice(0, 6).forEach((h, i) => {
      const x = M + i * (bw + gap);
      doc.setDrawColor(...LINE);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, bw, 48, 4, 4, 'FD');
      doc.setFillColor(...accent);
      doc.rect(x, y + 8, 2.5, 32, 'F');
      doc.setTextColor(...MUTED);
      doc.setFontSize(8);
      doc.text(String(h.label).toUpperCase(), x + 12, y + 18);
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(h.money ? money(h.value) : String(h.value ?? '—'), x + 12, y + 37);
      doc.setFont('helvetica', 'normal');
    });
    y += 66;
  }

  // Sections
  (report.sections || []).forEach((sec) => {
    if (y > H - 120) { doc.addPage(); y = M; }
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(sec.title || '', M, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`${sec.rows?.length || 0} ${sec.rows?.length === 1 ? 'row' : 'rows'}`, W - M, y + 4, { align: 'right' });

    // A company column adds nothing when the whole report is for one company
    const rowsAll = sec.rows || [];
    const oneCompany = rowsAll.length > 0 && rowsAll.every((r) => r.company === rowsAll[0].company);
    const cols = (sec.columns || []).filter((c) => !(c.key === 'company' && oneCompany));
    const columnStyles = {};
    cols.forEach((c, i) => { if (c.align === 'right' || c.type === 'money') columnStyles[i] = { halign: 'right' }; });
    const body = (sec.rows || []).map((r) => cols.map((c) => cell(c, r[c.key])));
    const foot = sec.totals ? [cols.map((c) => (sec.totals[c.key] === undefined ? '' : cell(c, sec.totals[c.key])))] : undefined;

    autoTable(doc, {
      startY: y + 12,
      margin: { left: M, right: M, bottom: 40 },
      head: [cols.map((c) => c.label)],
      body: body.length ? body : [[{ content: 'No records for this period.', colSpan: Math.max(cols.length, 1), styles: { halign: 'center', textColor: MUTED, fontStyle: 'italic' } }]],
      foot,
      showFoot: 'lastPage',
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.5 }, overflow: 'linebreak' },
      headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, lineWidth: 0 },
      footStyles: { fillColor: [235, 239, 246], textColor: INK, fontStyle: 'bold', lineWidth: 0 },
      alternateRowStyles: { fillColor: ZEBRA },
      columnStyles,
      didParseCell: (d) => {
        if ((d.section === 'head' || d.section === 'foot') && columnStyles[d.column.index]) d.cell.styles.halign = 'right';
      },
    });
    y = doc.lastAutoTable.finalY + 26;
  });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.line(M, H - 28, W - M, H - 28);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Confidential · ${report.title || 'Report'} · ${report.scopeLabel || ''}`, M, H - 16);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 16, { align: 'right' });
  }
  return doc;
}

export function downloadReportPdf(report, opts) {
  const doc = buildReportPdf(report, opts);
  const slug = (report.scopeLabel || 'All Companies').replace(/[^A-Za-z0-9]+/g, '_');
  doc.save(`${report.filename || 'Report'}_${slug}.pdf`);
}
