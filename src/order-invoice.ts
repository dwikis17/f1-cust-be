import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { config } from "./config.js";

type InvoiceOrder = {
  orderNumber: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  subtotalIdr: number;
  discountIdr: number;
  shippingIdr: number;
  totalIdr: number;
  paymentStatus: string;
  lifecycleStatus: string;
  shipmentBookingStatus: string;
  externalRefundedAt: Date | null;
  courierName: string;
  courierServiceName: string;
  courierDuration: string;
  biteshipWaybillId: string | null;
  createdAt: Date;
  items: Array<{
    productName: string;
    sku: string;
    color: string | null;
    size: string | null;
    unitPriceIdr: number;
    quantity: number;
  }>;
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const DARK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.38, 0.38, 0.38);
const LINE = rgb(0.86, 0.86, 0.86);
const SURFACE = rgb(0.96, 0.96, 0.96);

function pdfText(value: string) {
  return value.replaceAll("\u2013", "-").replaceAll("\u2014", "-").replaceAll("\u00a0", " ")
    .replace(/[^\x20-\x7E]/g, "?");
}

function idr(value: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value)}`;
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en-ID", {
    dateStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(value);
}

function wrap(font: PDFFont, text: string, size: number, width: number) {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawLines(page: PDFPage, font: PDFFont, lines: string[], x: number, y: number, options: {
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
  size?: number;
}) {
  const size = options.size ?? 9;
  const lineHeight = options.lineHeight ?? size + 3;
  lines.forEach((line, index) => page.drawText(line, {
    x,
    y: y - index * lineHeight,
    size,
    font,
    color: options.color ?? DARK,
  }));
  return y - lines.length * lineHeight;
}

function statusLabel(order: InvoiceOrder) {
  if (order.externalRefundedAt) return "EXTERNALLY REFUNDED";
  if (order.lifecycleStatus === "CANCELLED" && order.paymentStatus === "PAID") return "CANCELLED - REFUND REQUIRED";
  return `${order.paymentStatus} / ${order.lifecycleStatus}`;
}

export async function createOrderInvoice(order: InvoiceOrder) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const drawHeader = () => {
    page.drawRectangle({ x: 0, y: A4.height - 120, width: A4.width, height: 120, color: DARK });
    page.drawText(pdfText(config.invoiceSellerName.toUpperCase()), {
      x: MARGIN,
      y: A4.height - 56,
      font: bold,
      size: 11,
      color: rgb(1, 1, 1),
    });
    page.drawText("ORDER INVOICE", {
      x: MARGIN,
      y: A4.height - 87,
      font: bold,
      size: 24,
      color: rgb(1, 1, 1),
    });
    const reference = pdfText(order.orderNumber);
    page.drawText(reference, {
      x: A4.width - MARGIN - bold.widthOfTextAtSize(reference, 11),
      y: A4.height - 58,
      font: bold,
      size: 11,
      color: rgb(1, 1, 1),
    });
    y = A4.height - 154;
  };

  const addPage = () => {
    page = document.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN;
    page.drawText(`ORDER INVOICE - ${pdfText(order.orderNumber)}`, { x: MARGIN, y, font: bold, size: 11, color: DARK });
    y -= 30;
  };

  const requireSpace = (height: number) => {
    if (y - height < 66) addPage();
  };

  drawHeader();
  const leftWidth = 220;
  page.drawText("SELLER", { x: MARGIN, y, font: bold, size: 8, color: MUTED });
  page.drawText("SHIP TO", { x: 314, y, font: bold, size: 8, color: MUTED });
  y -= 18;
  const seller = [
    config.invoiceSellerName,
    config.invoiceSellerEmail,
    config.invoiceSellerPhone,
    config.invoiceSellerAddress,
  ];
  const customer = [
    `${order.firstName} ${order.lastName}`.trim(),
    order.email,
    order.phone,
    `${order.address}, ${order.city}, ${order.province} ${order.postalCode}`,
  ];
  const sellerLines = seller.flatMap((line) => wrap(regular, line, 9, leftWidth));
  const customerLines = customer.flatMap((line) => wrap(regular, line, 9, leftWidth));
  drawLines(page, regular, sellerLines, MARGIN, y, { size: 9 });
  drawLines(page, regular, customerLines, 314, y, { size: 9 });
  y -= Math.max(sellerLines.length, customerLines.length) * 12 + 18;

  page.drawRectangle({ x: MARGIN, y: y - 48, width: A4.width - MARGIN * 2, height: 48, color: SURFACE });
  const meta: Array<[string, string]> = [
    ["ORDER DATE", date(order.createdAt)],
    ["PAYMENT", order.paymentStatus],
    ["STATUS", statusLabel(order)],
  ];
  meta.forEach(([label, value], index) => {
    const x = MARGIN + 16 + index * 166;
    page.drawText(label, { x, y: y - 17, font: bold, size: 7, color: MUTED });
    page.drawText(pdfText(value), { x, y: y - 34, font: bold, size: 9, color: DARK });
  });
  y -= 74;

  const columns = { item: MARGIN, sku: 320, qty: 420, amount: A4.width - MARGIN };
  const drawTableHeader = () => {
    page.drawText("ITEM", { x: columns.item, y, font: bold, size: 8, color: MUTED });
    page.drawText("SKU", { x: columns.sku, y, font: bold, size: 8, color: MUTED });
    page.drawText("QTY", { x: columns.qty, y, font: bold, size: 8, color: MUTED });
    const amount = "AMOUNT";
    page.drawText(amount, {
      x: columns.amount - bold.widthOfTextAtSize(amount, 8),
      y,
      font: bold,
      size: 8,
      color: MUTED,
    });
    y -= 12;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 1, color: LINE });
    y -= 17;
  };
  drawTableHeader();

  for (const item of order.items) {
    const options = [item.color && `Color: ${item.color}`, item.size && `Size: ${item.size}`].filter(Boolean).join(" / ");
    const nameLines = wrap(bold, item.productName, 9, 245);
    const optionLines = options ? wrap(regular, options, 8, 245) : [];
    const rowHeight = Math.max(36, (nameLines.length + optionLines.length) * 11 + 12);
    if (y - rowHeight < 72) {
      addPage();
      drawTableHeader();
    }
    drawLines(page, bold, nameLines, columns.item, y, { size: 9, lineHeight: 11 });
    if (optionLines.length) {
      drawLines(page, regular, optionLines, columns.item, y - nameLines.length * 11, { size: 8, lineHeight: 10, color: MUTED });
    }
    drawLines(page, regular, wrap(regular, item.sku, 8, 86), columns.sku, y, { size: 8, lineHeight: 10 });
    page.drawText(String(item.quantity), { x: columns.qty, y, font: regular, size: 9, color: DARK });
    const amount = idr(item.unitPriceIdr * item.quantity);
    page.drawText(amount, {
      x: columns.amount - regular.widthOfTextAtSize(amount, 9),
      y,
      font: regular,
      size: 9,
      color: DARK,
    });
    y -= rowHeight;
    page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: A4.width - MARGIN, y: y + 8 }, thickness: 0.5, color: LINE });
  }

  requireSpace(170);
  y -= 8;
  const totals: Array<[string, string]> = [
    ["Subtotal", idr(order.subtotalIdr)],
    ["Discount", `-${idr(order.discountIdr)}`],
    ["Shipping", idr(order.shippingIdr)],
  ];
  for (const [label, value] of totals) {
    page.drawText(label, { x: 350, y, font: regular, size: 9, color: MUTED });
    page.drawText(value, {
      x: A4.width - MARGIN - regular.widthOfTextAtSize(value, 9),
      y,
      font: regular,
      size: 9,
      color: DARK,
    });
    y -= 19;
  }
  page.drawLine({ start: { x: 350, y: y + 7 }, end: { x: A4.width - MARGIN, y: y + 7 }, thickness: 1.5, color: DARK });
  page.drawText("TOTAL", { x: 350, y: y - 12, font: bold, size: 11, color: DARK });
  const total = idr(order.totalIdr);
  page.drawText(total, {
    x: A4.width - MARGIN - bold.widthOfTextAtSize(total, 11),
    y: y - 12,
    font: bold,
    size: 11,
    color: DARK,
  });
  y -= 54;

  requireSpace(90);
  page.drawText("DELIVERY", { x: MARGIN, y, font: bold, size: 8, color: MUTED });
  y -= 17;
  const delivery = `${order.courierName} ${order.courierServiceName} (${order.courierDuration})`;
  y = drawLines(page, regular, wrap(regular, delivery, 9, A4.width - MARGIN * 2), MARGIN, y, { size: 9 });
  if (order.biteshipWaybillId) {
    y = drawLines(page, regular, [`Tracking number: ${pdfText(order.biteshipWaybillId)}`], MARGIN, y - 2, { size: 9 });
  }
  drawLines(page, regular, [`Shipment booking: ${order.shipmentBookingStatus}`], MARGIN, y - 2, { size: 9, color: MUTED });

  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: A4.width - MARGIN, y: 42 }, thickness: 0.5, color: LINE });
    current.drawText("Order invoice - not a tax invoice", { x: MARGIN, y: 25, font: regular, size: 7, color: MUTED });
    const pageNumber = `Page ${index + 1} of ${pages.length}`;
    current.drawText(pageNumber, {
      x: A4.width - MARGIN - regular.widthOfTextAtSize(pageNumber, 7),
      y: 25,
      font: regular,
      size: 7,
      color: MUTED,
    });
  });

  document.setTitle(`Order invoice ${order.orderNumber}`);
  document.setAuthor(config.invoiceSellerName);
  document.setCreationDate(new Date());
  return document.save();
}
