import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const EXPORT_ROLES = ['ADMIN', 'TEACHER'];

export function canExportReports(role) {
  return EXPORT_ROLES.includes(role);
}

export function exportReportCSV({ fileName, rows }) {
  const headers = Object.keys(rows[0] || {});
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? '')).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function exportReportPDF({ element, fileName }) {
  const canvas = await html2canvas(element, { scale: 2 });
  const imageData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');

  const pageWidth = 210;
  const pageHeight = 297;
  const imgWidth = pageWidth - 20;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let currentY = 10;
  let remaining = imgHeight;

  while (remaining > 0) {
    pdf.addImage(imageData, 'PNG', 10, currentY, imgWidth, imgHeight);
    remaining -= pageHeight - 20;
    if (remaining > 0) {
      pdf.addPage();
      currentY = 10;
    }
  }

  pdf.save(fileName);
}
