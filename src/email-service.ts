import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.js";
import { prisma } from "./db.js";

export type EmailSender = {
  send(message: EmailMessageBuilder): Promise<unknown>;
};

const requestSender = new AsyncLocalStorage<EmailSender>();
let defaultSender: EmailSender | undefined;

export function runWithEmailSender<T>(sender: EmailSender, callback: () => T) {
  return requestSender.run(sender, callback);
}

export function setDefaultEmailSender(sender?: EmailSender) {
  defaultSender = sender;
}

function currentSender() {
  const sender = requestSender.getStore() ?? defaultSender;
  if (!sender) throw new Error("Cloudflare Email Service binding is not configured");
  return sender;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] as string);
}

function idr(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function itemDescription(item: { color: string | null; size: string | null }) {
  return [item.color && `Color: ${item.color}`, item.size && `Size: ${item.size}`].filter(Boolean).join(" / ");
}

type ConfirmationOrder = NonNullable<Awaited<ReturnType<typeof loadConfirmationOrder>>>;

function loadConfirmationOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, promoCode: { select: { code: true } } },
  });
}

export function buildPaymentConfirmationEmail(order: ConfirmationOrder): EmailMessageBuilder {
  if (!config.emailFromAddress || !config.storefrontUrl) {
    throw new Error("EMAIL_FROM_ADDRESS and STOREFRONT_URL are required to send order confirmations");
  }

  const customerName = `${order.firstName} ${order.lastName}`.trim();
  const trackUrl = `${config.storefrontUrl}/track-order`;
  const lineItemsText = order.items.map((item) => {
    const options = itemDescription(item);
    return `- ${item.productName}${options ? ` (${options})` : ""} x${item.quantity}: ${idr(item.unitPriceIdr * item.quantity)}`;
  }).join("\n");
  const lineItemsHtml = order.items.map((item) => {
    const options = itemDescription(item);
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e5e5"><strong>${escapeHtml(item.productName)}</strong>${options ? `<br><span style="color:#666;font-size:13px">${escapeHtml(options)}</span>` : ""}</td><td style="padding:12px;text-align:center;border-bottom:1px solid #e5e5e5">${item.quantity}</td><td style="padding:12px 0;text-align:right;border-bottom:1px solid #e5e5e5">${escapeHtml(idr(item.unitPriceIdr * item.quantity))}</td></tr>`;
  }).join("");
  const deliveryStatus = order.fulfillmentStatus === "BOOKED"
    ? "Your shipment has been booked. You can follow its progress from the tracking page."
    : "We received your payment and are preparing your shipment. Tracking will appear as soon as it is booked.";
  const trackingNumber = order.biteshipWaybillId ? `\nTracking number: ${order.biteshipWaybillId}` : "";
  const promoText = order.promoCode ? `\nPromo code: ${order.promoCode.code}` : "";

  return {
    to: { email: order.email, name: customerName },
    from: { email: config.emailFromAddress, name: config.emailFromName },
    ...(config.emailReplyTo ? { replyTo: config.emailReplyTo } : {}),
    subject: `Payment received — ${order.orderNumber}`,
    text: `Hi ${customerName},

We received your payment for order ${order.orderNumber}.

${lineItemsText}

Subtotal: ${idr(order.subtotalIdr)}
Discount: -${idr(order.discountIdr)}
Shipping: ${idr(order.shippingIdr)}
Total paid: ${idr(order.totalIdr)}${promoText}

Delivery: ${order.courierName} ${order.courierServiceName} (${order.courierDuration})${trackingNumber}
Ship to: ${order.address}, ${order.city}, ${order.province} ${order.postalCode}

${deliveryStatus}
Track your order: ${trackUrl}

Thank you,
${config.emailFromName}`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f4f4;color:#151515;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:auto;background:#fff;border:1px solid #ddd"><tr><td style="padding:30px 32px;background:#151515;color:#fff"><div style="font-size:13px;letter-spacing:2px;text-transform:uppercase">${escapeHtml(config.emailFromName)}</div><h1 style="margin:12px 0 0;font-size:28px">Payment received</h1></td></tr><tr><td style="padding:32px"><p style="margin-top:0">Hi ${escapeHtml(customerName)},</p><p>We received your payment for order <strong>${escapeHtml(order.orderNumber)}</strong>.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0"><thead><tr><th style="padding-bottom:8px;text-align:left">Item</th><th style="padding:0 12px 8px;text-align:center">Qty</th><th style="padding-bottom:8px;text-align:right">Amount</th></tr></thead><tbody>${lineItemsHtml}</tbody></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px"><tr><td style="padding:4px 0;color:#666">Subtotal</td><td style="padding:4px 0;text-align:right">${escapeHtml(idr(order.subtotalIdr))}</td></tr><tr><td style="padding:4px 0;color:#666">Discount</td><td style="padding:4px 0;text-align:right">-${escapeHtml(idr(order.discountIdr))}</td></tr><tr><td style="padding:4px 0;color:#666">Shipping</td><td style="padding:4px 0;text-align:right">${escapeHtml(idr(order.shippingIdr))}</td></tr><tr><td style="padding:12px 0 4px;border-top:2px solid #151515;font-size:18px"><strong>Total paid</strong></td><td style="padding:12px 0 4px;border-top:2px solid #151515;text-align:right;font-size:18px"><strong>${escapeHtml(idr(order.totalIdr))}</strong></td></tr></table><div style="padding:20px;background:#f5f5f5"><strong>Delivery</strong><p style="margin:8px 0 0">${escapeHtml(order.courierName)} ${escapeHtml(order.courierServiceName)} (${escapeHtml(order.courierDuration)})${order.biteshipWaybillId ? `<br>Tracking number: ${escapeHtml(order.biteshipWaybillId)}` : ""}</p><p style="margin:12px 0 0;color:#555">${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.province)} ${escapeHtml(order.postalCode)}</p></div><p style="margin:24px 0">${escapeHtml(deliveryStatus)}</p><a href="${escapeHtml(trackUrl)}" style="display:inline-block;padding:13px 20px;background:#151515;color:#fff;text-decoration:none;font-weight:bold">Track your order</a><p style="margin:28px 0 0;color:#666;font-size:13px">Use order number <strong>${escapeHtml(order.orderNumber)}</strong> and this email address on the tracking page.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendPaymentConfirmationEmail(orderId: string) {
  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - 10 * 60 * 1_000);
  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      paymentStatus: "PAID",
      paymentConfirmationEmailSentAt: null,
      OR: [
        { paymentConfirmationEmailSendingAt: null },
        { paymentConfirmationEmailSendingAt: { lt: staleBefore } },
      ],
    },
    data: { paymentConfirmationEmailSendingAt: claimedAt },
  });
  if (!claimed.count) return false;

  try {
    const order = await loadConfirmationOrder(orderId);
    if (!order) throw new Error("Order disappeared before its confirmation email could be sent");
    await currentSender().send(buildPaymentConfirmationEmail(order));
    await prisma.order.updateMany({
      where: { id: orderId, paymentConfirmationEmailSendingAt: claimedAt },
      data: { paymentConfirmationEmailSendingAt: null, paymentConfirmationEmailSentAt: new Date() },
    });
    return true;
  } catch (error) {
    await prisma.order.updateMany({
      where: { id: orderId, paymentConfirmationEmailSendingAt: claimedAt },
      data: { paymentConfirmationEmailSendingAt: null },
    });
    throw error;
  }
}
