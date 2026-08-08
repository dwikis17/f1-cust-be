import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTelegramMessage } from "./telegram-service.js";

function orderWithItems(count: number) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    orderNumber: "VLD-ABCD-EFGH-IJKL",
    idempotencyKey: "00000000-0000-0000-0000-000000000002",
    email: "buyer@example.com",
    firstName: "Ayu",
    lastName: "Racer",
    phone: "081234567890",
    address: "Jl. Finish Line 1",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "12240",
    subtotalIdr: 100_000,
    discountIdr: 0,
    shippingIdr: 18_000,
    totalIdr: 118_000,
    promoCodeId: null,
    promoRedeemedAt: null,
    courierCode: "jne",
    courierName: "JNE",
    courierServiceCode: "reg",
    courierServiceName: "Reguler",
    courierDuration: "2 - 3 days",
    paymentStatus: "PAID" as const,
    midtransStatus: "settlement",
    midtransTransactionId: "transaction-1",
    midtransPaymentType: "bank_transfer",
    midtransSnapToken: null,
    paymentConfirmationEmailSendingAt: null,
    paymentConfirmationEmailSentAt: null,
    telegramNotificationQueuedAt: new Date(),
    telegramNotificationSendingAt: null,
    telegramNotificationSentAt: null,
    telegramNotificationFailedAt: null,
    telegramNotificationAttempts: 0,
    telegramNotificationLastError: null,
    shipmentConfirmationEmailSendingAt: null,
    shipmentConfirmationEmailSentAt: null,
    stockReleasedAt: null,
    shipmentBookingStatus: "UNFULFILLED" as const,
    shipmentBookingStartedAt: null,
    lifecycleStatus: "UNFULFILLED" as const,
    cancelledAt: null,
    externalRefundedAt: null,
    externalRefundedByAdminId: null,
    biteshipOrderId: null,
    biteshipTrackingId: null,
    biteshipWaybillId: null,
    biteshipPriceIdr: null,
    biteshipStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`,
      orderId: "00000000-0000-0000-0000-000000000001",
      variantId: null,
      productName: `Product ${index} ${"x".repeat(180)}`,
      sku: `SKU-${index}`,
      color: null,
      size: null,
      unitPriceIdr: 1_000,
      quantity: 1,
      createdAt: new Date(),
    })),
  };
}

test("Telegram messages fall back to a compact summary for oversized orders", () => {
  const message = buildTelegramMessage(orderWithItems(50));
  assert.ok(message.length <= 4096);
  assert.match(message, /Item: 50 item/);
  assert.doesNotMatch(message, /Product 0/);
});

test("Telegram messages label later refunds and cancelled orders", () => {
  const order = orderWithItems(1);
  order.paymentStatus = "REFUNDED";
  order.lifecycleStatus = "CANCELLED";
  order.stockReleasedAt = new Date();
  const message = buildTelegramMessage(order);
  assert.match(message, /order dibatalkan \/ stok tidak tersedia/);
  assert.match(message, /pembayaran kemudian direfund/);
});
