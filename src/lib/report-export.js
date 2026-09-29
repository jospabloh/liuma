// Report exports (CSV / PDF) for Reportes.jsx.
//
// jsPDF + html2canvas are ~600 KB and only needed when someone presses "PDF",
// so they are imported on demand inside exportReportPDF instead of statically:
// a static import put them in the Reportes chunk for every visit.

const EXPORT_ROLES = ['ADMIN', 'TEACHER'];

// Excel on Windows (es-MX) opens a BOM-less CSV as ANSI and renders
// "Bitácoras" as "BitÃ¡coras". The UTF-8 byte order mark makes it read UTF-8.
export const UTF8_BOM = '\uFEFF';

export function canExportReports(role) {
  return EXPORT_ROLES.includes(role);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  // RFC 4180: quote every cell and double embedded quotes. (JSON.stringify,
  // used before, escapes with a backslash, which spreadsheets do not undo.)
  return `"${text.replace(/"/g, '""')}"`;
}

/** Build the CSV text (with BOM) for an array of flat row objects. */
export function buildCsv(rows = []) {
  const headers = Object.keys(rows[0] || {});
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(',')),
  ];
  return UTF8_BOM + lines.join('\r\n');
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously right after click() can cancel the download in
  // some browsers (Safari, older Firefox) before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportReportCSV({ fileName, rows }) {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, fileName);
}

export async function exportReportPDF({ element, fileName }) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(element, { scale: 2 });
  const imageData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const printable = pageHeight - margin * 2;

  // One tall image, shifted up by one printable page per PDF page, so each
  // page shows the next slice instead of repeating the first one.
  // The image is not clipped to the printable box, so the strips that spill
  // into the top/bottom margins are painted over: otherwise the last 10 mm of
  // one page would repeat at the top of the next.
  const maskMargins = () => {
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageWidth, margin, 'F');
    pdf.rect(0, pageHeight - margin, pageWidth, margin, 'F');
  };
  let offset = 0;
  pdf.addImage(imageData, 'PNG', margin, margin, imgWidth, imgHeight);
  maskMargins();
  while (imgHeight - offset > printable) {
    offset += printable;
    pdf.addPage();
    pdf.addImage(imageData, 'PNG', margin, margin - offset, imgWidth, imgHeight);
    maskMargins();
  }

  pdf.save(fileName);
}
