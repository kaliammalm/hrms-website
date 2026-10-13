/* ==========================================================================
   Payslip PDF (client side, jsPDF): A4 portrait, one page per payslip.
   Layout follows the common Indian payslip (Zoho / Keka style):
     company header · pay period · employee details · earnings | deductions ·
     net pay with amount in words · year-to-date · employer contributions · footer.
   Standard PDF fonts have no ₹ glyph, so amounts are printed as "Rs. 1,23,456".
   ========================================================================== */
import { jsPDF } from 'jspdf';
import { getCompanyBrand } from '../brand';

const INK = [19, 33, 59];
const MUTED = [98, 110, 132];
const LINE = [221, 226, 234];
const SOFT = [246, 248, 251];
const ACCENTS = { rrd: [35, 40, 107], fractio: [11, 59, 115], varnam: [72, 43, 132], group: [43, 80, 200] };

const amt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (n) => `Rs. ${amt(n)}`;
const fmtDate = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v || '-';
  return `${m[3]}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]}-${m[1]}`;
};

// Company logo as a JPEG data URL on white (JPEG needs no PNG decoder inside jsPDF and keeps the file small)
const logoCache = {};
function logoData(src) {
  if (!src) return Promise.resolve(null);
  if (logoCache[src] !== undefined) return Promise.resolve(logoCache[src]);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const scale = Math.min(1, 600 / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        logoCache[src] = { data: c.toDataURL('image/jpeg', 0.92), w: c.width, h: c.height };
      } catch (e) { logoCache[src] = null; }
      resolve(logoCache[src]);
    };
    img.onerror = () => { logoCache[src] = null; resolve(null); };
    img.src = src;
  });
}

async function drawPayslip(doc, p) {
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  const brand = getCompanyBrand(p.company.id) || getCompanyBrand(p.company.shortName);
  const accent = ACCENTS[brand?.key] || ACCENTS.group;
  let y = M;

  // Header: logo, company, period
  doc.setFillColor(...accent);
  doc.rect(0, 0, W, 6, 'F');
  const logo = await logoData(brand?.logo);
  let textX = M;
  if (logo) {
    const h = 34;
    const w = Math.min(130, (logo.w / logo.h) * h);
    try { doc.addImage(logo.data, 'JPEG', M, y, w, h); textX = M + w + 14; } catch (e) { /* text only */ }
  }
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(p.company.name || '', textX, y + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const addr = doc.splitTextToSize(p.company.address || '', W - textX - M - 150);
  doc.text(addr.slice(0, 2), textX, y + 26);
  doc.setFontSize(8);
  doc.text('PAYSLIP FOR THE MONTH OF', W - M, y + 10, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(p.periodLabel.toUpperCase(), W - M, y + 27, { align: 'right' });
  y += 50;
  doc.setDrawColor(...LINE);
  doc.line(M, y, W - M, y);
  y += 18;

  // Net pay band (summary first, as on Zoho / Keka payslips)
  doc.setFillColor(...SOFT);
  doc.roundedRect(M, y, W - 2 * M, 54, 6, 6, 'F');
  doc.setFillColor(...accent);
  doc.rect(M, y + 10, 3, 34, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('EMPLOYEE NET PAY', M + 16, y + 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(rs(p.net), M + 16, y + 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const dx = W - M - 16;
  doc.text(`Paid days: ${p.days.paid}`, dx, y + 22, { align: 'right' });
  doc.text(`LOP days: ${p.days.lop}`, dx, y + 38, { align: 'right' });
  y += 72;

  // Employee details (two columns of label / value)
  const e = p.employee;
  const left = [['Employee name', e.name], ['Employee ID', e.empCode], ['Designation', e.designation], ['Department', e.department], ['Date of joining', fmtDate(e.joiningDate)]];
  const right = [['PAN', e.pan], ['UAN', e.uan], ['PF number', e.pfNumber], ['ESI number', e.esiNumber], ['Bank account', e.account ? `${e.bankName || ''} ${e.account}`.trim() : null]];
  const colW = (W - 2 * M) / 2;
  doc.setFontSize(9);
  left.forEach(([k, v], i) => {
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.text(k, M, y + i * 16);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(String(v || '-'), M + 92, y + i * 16);
  });
  right.forEach(([k, v], i) => {
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.text(k, M + colW, y + i * 16);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(String(v || '-'), M + colW + 80, y + i * 16);
  });
  y += 5 * 16 + 10;

  // Earnings | Deductions table
  const tableTop = y;
  const half = (W - 2 * M) / 2;
  const headH = 22;
  doc.setFillColor(...INK);
  doc.rect(M, y, W - 2 * M, headH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('EARNINGS', M + 10, y + 14);
  doc.text('AMOUNT', M + half - 10, y + 14, { align: 'right' });
  doc.text('DEDUCTIONS', M + half + 10, y + 14);
  doc.text('AMOUNT', W - M - 10, y + 14, { align: 'right' });
  y += headH;
  const rows = Math.max(p.earnings.length, p.deductions.length, 1);
  const rowH = 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (let i = 0; i < rows; i += 1) {
    if (i % 2 === 1) { doc.setFillColor(...SOFT); doc.rect(M, y, W - 2 * M, rowH, 'F'); }
    const ea = p.earnings[i];
    const de = p.deductions[i];
    doc.setTextColor(...INK);
    if (ea) {
      doc.text(ea.label, M + 10, y + 12);
      doc.text(amt(ea.amount), M + half - 10, y + 12, { align: 'right' });
    }
    if (de) {
      doc.text(de.label, M + half + 10, y + 12);
      doc.text(amt(de.amount), W - M - 10, y + 12, { align: 'right' });
    }
    y += rowH;
  }
  doc.setDrawColor(...LINE);
  doc.line(M, y, W - M, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Gross Earnings', M + 10, y + 14);
  doc.text(amt(p.gross), M + half - 10, y + 14, { align: 'right' });
  doc.text('Total Deductions', M + half + 10, y + 14);
  doc.text(amt(p.totalDeductions), W - M - 10, y + 14, { align: 'right' });
  y += 22;
  doc.setDrawColor(...LINE);
  doc.rect(M, tableTop, W - 2 * M, y - tableTop);
  doc.line(M + half, tableTop, M + half, y);
  y += 16;

  // Net pay in words
  doc.setFillColor(...SOFT);
  doc.rect(M, y, W - 2 * M, 40, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text('NET PAY (Gross Earnings - Total Deductions)', M + 10, y + 16);
  doc.text(rs(p.net), W - M - 10, y + 16, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`Amount in words: ${p.netInWords}`, M + 10, y + 31);
  y += 58;

  // Year to date + employer contributions
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text('YEAR TO DATE (this financial year)', M, y);
  doc.text('EMPLOYER CONTRIBUTIONS (not deducted from pay)', M + half + 10, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  const ytd = [['Gross earnings', p.ytd.gross], ['Provident fund', p.ytd.pf], ['ESI', p.ytd.esi], ['Professional tax', p.ytd.pt], ['Income tax (TDS)', p.ytd.tds]];
  const er = [['Pension (EPS)', p.employer.eps], ['Provident fund (EPF)', p.employer.epf], ['EDLI', p.employer.edli], ['PF admin charges', p.employer.pf_admin], ['ESI (employer)', p.employer.esi]];
  ytd.forEach(([k, v], i) => { doc.text(k, M, y + i * 13); doc.text(amt(v), M + half - 10, y + i * 13, { align: 'right' }); });
  er.forEach(([k, v], i) => { doc.text(k, M + half + 10, y + i * 13); doc.text(amt(v), W - M - 10, y + i * 13, { align: 'right' }); });
  y += 5 * 13 + 18;

  // Footer
  const H = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...LINE);
  doc.line(M, H - 56, W - M, H - 56);
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const reg = [p.company.pan && `PAN ${p.company.pan}`, p.company.tan && `TAN ${p.company.tan}`, p.company.pfCode && `PF ${p.company.pfCode}`, p.company.esiCode && `ESI ${p.company.esiCode}`].filter(Boolean).join('  ·  ');
  if (reg) doc.text(reg, M, H - 42);
  doc.text(p.company.note || 'This is a computer-generated payslip and does not require a signature.', M, H - 30);
  doc.text(`${p.status === 'PAID' && p.paidAt ? `Paid on ${fmtDate(p.paidAt)}` : 'Approved'} · Ref ${p.runId}-${p.id}`, W - M, H - 30, { align: 'right' });
}

export async function buildPayslipsPdf(payslips) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  for (let i = 0; i < payslips.length; i += 1) {
    if (i) doc.addPage();
    // eslint-disable-next-line no-await-in-loop
    await drawPayslip(doc, payslips[i]);
  }
  return doc;
}

export const payslipFileName = (p) => `Payslip_${(p.employee.empCode || p.employee.name || 'employee').replace(/[^A-Za-z0-9-]+/g, '_')}_${p.period}.pdf`;
