import { ExportOptions } from '../components/reports/ExportOptionsModal';

/**
 * Generates and downloads a PDF report
 * Uses html2pdf.js library for client-side PDF generation
 */
export async function generatePDF(
  elementId: string,
  filename: string,
  options: ExportOptions
): Promise<void> {
  // Dynamically import html2pdf to avoid SSR issues
  const html2pdf = (await import('html2pdf.js')).default;

  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error('Report element not found');
  }

  // Clone the element to avoid modifying the original
  const clonedElement = element.cloneNode(true) as HTMLElement;

  // Apply watermark if specified
  if (options.watermark) {
    applyWatermark(clonedElement, options.watermark);
  }

  // Apply grayscale if specified
  if (options.colorMode === 'grayscale') {
    applyGrayscale(clonedElement);
  }

  // Configure PDF options
  const opt = {
    margin: options.pageSize === 'letter' ? [0.5, 0.5] : [1.27, 1.27], // cm
    filename: `${filename}.${options.format}`,
    image: { 
      type: 'jpeg', 
      quality: options.quality === 'print' ? 0.98 : options.quality === 'screen' ? 0.85 : 0.70 
    },
    html2canvas: { 
      scale: options.quality === 'print' ? 3 : options.quality === 'screen' ? 2 : 1,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    },
    jsPDF: { 
      unit: 'cm', 
      format: options.pageSize, 
      orientation: options.orientation,
      compress: true
    },
    pagebreak: { 
      mode: ['avoid-all', 'css', 'legacy'],
      before: '.page-break-before',
      after: '.page-break-after',
      avoid: '.avoid-page-break'
    }
  };

  try {
    // Generate PDF
    const pdf = await html2pdf().set(opt).from(clonedElement).toPdf().get('pdf');

    // Add password protection if specified
    if (options.password && options.password.length > 0) {
      // Note: html2pdf.js doesn't support password protection natively
      // In production, this would be handled server-side
      console.warn('Password protection requires server-side processing');
    }

    // Save the PDF
    if (options.format === 'pdf') {
      pdf.save();
    } else {
      // For other formats, show a message
      console.log(`Export to ${options.format} would be handled server-side in production`);
      
      // For now, save as PDF
      pdf.save();
    }

    return Promise.resolve();
  } catch (error) {
    console.error('PDF generation failed:', error);
    throw new Error('Failed to generate PDF. Please try again.');
  }
}

/**
 * Applies a watermark to the report
 */
function applyWatermark(element: HTMLElement, text: string): void {
  const watermark = document.createElement('div');
  watermark.style.position = 'fixed';
  watermark.style.top = '50%';
  watermark.style.left = '50%';
  watermark.style.transform = 'translate(-50%, -50%) rotate(-45deg)';
  watermark.style.fontSize = '72px';
  watermark.style.fontWeight = 'bold';
  watermark.style.color = 'rgba(0, 0, 0, 0.1)';
  watermark.style.pointerEvents = 'none';
  watermark.style.userSelect = 'none';
  watermark.style.zIndex = '9999';
  watermark.textContent = text;
  
  element.style.position = 'relative';
  element.appendChild(watermark);
}

/**
 * Applies grayscale filter to the report
 */
function applyGrayscale(element: HTMLElement): void {
  element.style.filter = 'grayscale(100%)';
}

/**
 * Generates a shareable link for the report
 */
export async function generateShareableLink(
  reportData: any,
  options: ExportOptions
): Promise<string> {
  // In production, this would upload the report to cloud storage
  // and return a secure, time-limited URL
  
  // For now, generate a mock link
  const linkId = Math.random().toString(36).substring(7);
  const baseUrl = window.location.origin;
  const expiryParam = options.expiringLink ? `&expires=${options.linkExpiryDays}d` : '';
  
  const shareableUrl = `${baseUrl}/shared/report/${linkId}?view=true${expiryParam}`;
  
  // Copy to clipboard
  await navigator.clipboard.writeText(shareableUrl);
  
  return shareableUrl;
}

/**
 * Sends report via email
 */
export async function emailReport(
  reportData: any,
  emailAddress: string,
  options: ExportOptions,
  dealName: string
): Promise<void> {
  // In production, this would call a backend API to send the email
  
  console.log('Email report:', {
    to: emailAddress,
    subject: `Due Diligence Report - ${dealName}`,
    format: options.format,
    hasPassword: !!options.password
  });
  
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return Promise.resolve();
}

/**
 * Saves export to history
 */
export function saveExportHistory(
  dealId: string,
  exportType: 'download' | 'email' | 'link',
  options: ExportOptions
): void {
  const history = JSON.parse(localStorage.getItem('exportHistory') || '[]');
  
  const exportRecord = {
    id: Math.random().toString(36).substring(7),
    dealId,
    exportType,
    format: options.format,
    timestamp: new Date().toISOString(),
    options
  };
  
  history.unshift(exportRecord);
  
  // Keep only last 50 exports
  if (history.length > 50) {
    history.splice(50);
  }
  
  localStorage.setItem('exportHistory', JSON.stringify(history));
}

/**
 * Gets export history for a deal
 */
export function getExportHistory(dealId?: string): any[] {
  const history = JSON.parse(localStorage.getItem('exportHistory') || '[]');
  
  if (dealId) {
    return history.filter((record: any) => record.dealId === dealId);
  }
  
  return history;
}
