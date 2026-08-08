import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import type { Prisma } from "./generated/prisma/client.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const CLAIM_STALE_MS = 10 * 60 * 1_000;
const RETRY_BATCH_SIZE = 50;

const telegramResponseSchema = z.object({
  ok: z.boolean(),
  error_code: z.number().int().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().int().positive().optional() }).optional(),
}).passthrough();

type TelegramOrder = Prisma.OrderGetPayload<{ include: { items: true } }>;

class TelegramDeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "TelegramDeliveryError";
  }
}

const paymentMethods: Record<string, string> = {
  bank_transfer: "Transfer bank",
  bca_klikpay: "BCA KlikPay",
  cstore: "Convenience store",
  credit_card: "Kartu kredit",
  echannel: "E-channel",
  gopay: "GoPay",
  kredivo: "Kredivo",
  qris: "QRIS",
  shopeepay: "ShopeePay",
};

export function telegramConfigured() {
  return Boolean(config.telegramBotToken && config.telegramChatId);
}

function requireTelegramConfig() {
  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new TelegramDeliveryError("Telegram notification is not configured", false);
  }
  return { token: config.telegramBotToken, chatId: config.telegramChatId };
}

function singleLine(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function idr(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function itemLabel(item: TelegramOrder["items"][number]) {
  const options = [item.color, item.size].filter((value): value is string => Boolean(value));
  const name = singleLine(item.productName);
  return `${name}${options.length ? ` (${options.map(singleLine).join(" / ")})` : ""} x${item.quantity}`;
}

function statusLine(order: TelegramOrder) {
  const statuses: string[] = [];
  if (order.lifecycleStatus === "CANCELLED") {
    statuses.push(order.stockReleasedAt ? "order dibatalkan / stok tidak tersedia" : "order dibatalkan");
  }
  if (order.paymentStatus === "REFUNDED" || order.externalRefundedAt) {
    statuses.push("pembayaran kemudian direfund");
  }
  return statuses.length ? `⚠️ Status: ${statuses.join("; ")}` : null;
}

function detailUrl(order: TelegramOrder) {
  return config.adminDashboardUrl ? `${config.adminDashboardUrl}/dashboard/orders/${order.id}` : null;
}

export function buildTelegramMessage(order: TelegramOrder) {
  const customer = `${singleLine(order.firstName)} ${singleLine(order.lastName)}`.trim();
  const paymentMethod = order.midtransPaymentType
    ? paymentMethods[order.midtransPaymentType] ?? singleLine(order.midtransPaymentType)
    : "Tidak tersedia";
  const status = statusLine(order);
  const link = detailUrl(order);
  const lines = [
    "✅ Pembayaran berhasil",
    `Order: ${order.orderNumber}`,
    `Pelanggan: ${customer} · ${singleLine(order.phone)}`,
    `Item: ${order.items.map(itemLabel).join("; ")}`,
    `Total: ${idr(order.totalIdr)} · Metode: ${paymentMethod}`,
    `Kirim ke: ${singleLine(order.city)}, ${singleLine(order.province)}`,
    status,
    link ? `Detail: ${link}` : null,
  ].filter((line): line is string => Boolean(line));
  const message = lines.join("\n");
  if (message.length <= TELEGRAM_MESSAGE_LIMIT) return message;

  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return [
    "✅ Pembayaran berhasil",
    `Order: ${order.orderNumber}`,
    `Pelanggan: ${customer} · ${singleLine(order.phone)}`,
    `Item: ${itemCount} item`,
    `Total: ${idr(order.totalIdr)} · Metode: ${paymentMethod}`,
    `Kirim ke: ${singleLine(order.city)}, ${singleLine(order.province)}`,
    status,
    link ? `Detail: ${link}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

async function sendTelegramMessage(text: string) {
  const { token, chatId } = requireTelegramConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new TelegramDeliveryError(
      error instanceof Error ? error.message : "Telegram request failed",
      true,
    );
  }

  const body: unknown = await response.json().catch(() => undefined);
  const parsed = telegramResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new TelegramDeliveryError("Telegram returned an invalid response", response.status >= 500 || response.status === 429);
  }
  if (!response.ok || !parsed.data.ok) {
    const message = parsed.data.description ?? `Telegram returned HTTP ${response.status}`;
    const errorCode = parsed.data.error_code ?? response.status;
    throw new TelegramDeliveryError(message, errorCode === 429 || errorCode >= 500 || response.status >= 500);
  }
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export async function sendTelegramPaymentNotification(orderId: string, options: { force?: boolean } = {}) {
  if (!telegramConfigured()) return false;

  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - CLAIM_STALE_MS);
  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      telegramNotificationQueuedAt: { not: null },
      telegramNotificationSentAt: null,
      ...(options.force
        ? { telegramNotificationFailedAt: { not: null } }
        : { telegramNotificationFailedAt: null }),
      OR: [
        { telegramNotificationSendingAt: null },
        { telegramNotificationSendingAt: { lt: staleBefore } },
      ],
    },
    data: {
      telegramNotificationSendingAt: claimedAt,
      telegramNotificationAttempts: { increment: 1 },
      ...(options.force ? { telegramNotificationFailedAt: null, telegramNotificationLastError: null } : {}),
    },
  });
  if (!claimed.count) return false;

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new TelegramDeliveryError("Order disappeared before Telegram delivery", false);
    await sendTelegramMessage(buildTelegramMessage(order));
    await prisma.order.updateMany({
      where: { id: orderId, telegramNotificationSendingAt: claimedAt },
      data: {
        telegramNotificationSendingAt: null,
        telegramNotificationSentAt: new Date(),
        telegramNotificationFailedAt: null,
        telegramNotificationLastError: null,
      },
    });
    return true;
  } catch (error) {
    const retryable = error instanceof TelegramDeliveryError ? error.retryable : true;
    const message = errorMessage(error);
    await prisma.order.updateMany({
      where: { id: orderId, telegramNotificationSendingAt: claimedAt },
      data: {
        telegramNotificationSendingAt: null,
        telegramNotificationLastError: message,
        ...(retryable ? {} : { telegramNotificationFailedAt: new Date() }),
      },
    });
    console.error(`Telegram payment notification failed for order ${orderId}`, { retryable, message });
    return false;
  }
}

export async function reconcilePendingTelegramNotifications() {
  if (!telegramConfigured()) return { checked: 0, sent: 0 };
  const orders = await prisma.order.findMany({
    where: {
      telegramNotificationQueuedAt: { not: null },
      telegramNotificationSentAt: null,
      telegramNotificationFailedAt: null,
    },
    orderBy: { telegramNotificationQueuedAt: "asc" },
    take: RETRY_BATCH_SIZE,
    select: { id: true },
  });
  let sent = 0;
  for (const order of orders) {
    if (await sendTelegramPaymentNotification(order.id)) sent += 1;
  }
  return { checked: orders.length, sent };
}
