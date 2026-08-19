import path from "node:path";
import { z } from "zod";

const env = z.object({
  DATABASE_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("uploads"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_242_880),
  MAX_PHOTOS_PER_PRODUCT: z.coerce.number().int().positive().default(12),
  APP_ENV: z.enum(["production", "staging"]).default("production"),
  BITESHIP_API_KEY: z.string().trim().optional(),
  BITESHIP_WEBHOOK_SECRET: z.string().trim().min(32).optional(),
  BITESHIP_ORIGIN_POSTAL_CODE: z.string().trim().regex(/^\d{5}$/).optional(),
  BITESHIP_ORIGIN_CONTACT_NAME: z.string().trim().min(1).optional(),
  BITESHIP_ORIGIN_CONTACT_PHONE: z.string().trim().min(6).optional(),
  BITESHIP_ORIGIN_ADDRESS: z.string().trim().min(5).optional(),
  MIDTRANS_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MIDTRANS_MERCHANT_ID: z.string().trim().optional(),
  MIDTRANS_SERVER_KEY: z.string().trim().optional(),
  MIDTRANS_NOTIFICATION_URL: z.string().url().optional(),
  STOREFRONT_URL: z.string().url().optional(),
  ADMIN_DASHBOARD_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().trim().regex(/^-?\d+$/).optional(),
  TURNSTILE_SECRET_KEY: z.string().trim().optional(),
  STOREFRONT_REVALIDATE_SECRET: z.string().trim().min(32).optional(),
  EMAIL_FROM_ADDRESS: z.string().trim().email().optional(),
  EMAIL_FROM_NAME: z.string().trim().min(1).max(100).default("Valyde Jersey"),
  EMAIL_REPLY_TO: z.string().trim().email().optional(),
  EMAIL_DELIVERY_ENABLED: z.enum(["true", "false"]).default("true"),
  INVOICE_SELLER_NAME: z.string().trim().min(1).max(100).default("Valyde Jersey"),
  INVOICE_SELLER_EMAIL: z.string().trim().email().default("support@valydejersey.com"),
  INVOICE_SELLER_PHONE: z.string().trim().min(6).max(30).default("081382854010"),
  INVOICE_SELLER_ADDRESS: z.string().trim().min(5).max(500).default("anggrek lok aaf 1"),
}).parse(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  uploadDir: path.resolve(env.UPLOAD_DIR),
  sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  maxUploadBytes: env.MAX_UPLOAD_BYTES,
  maxPhotosPerProduct: env.MAX_PHOTOS_PER_PRODUCT,
  appEnv: env.APP_ENV,
  biteshipApiKey: env.BITESHIP_API_KEY,
  biteshipWebhookSecret: env.BITESHIP_WEBHOOK_SECRET,
  biteshipOriginPostalCode: env.BITESHIP_ORIGIN_POSTAL_CODE,
  biteshipOriginContactName: env.BITESHIP_ORIGIN_CONTACT_NAME,
  biteshipOriginContactPhone: env.BITESHIP_ORIGIN_CONTACT_PHONE,
  biteshipOriginAddress: env.BITESHIP_ORIGIN_ADDRESS,
  midtransEnv: env.MIDTRANS_ENV,
  midtransMerchantId: env.MIDTRANS_MERCHANT_ID,
  midtransServerKey: env.MIDTRANS_SERVER_KEY,
  midtransNotificationUrl: env.MIDTRANS_NOTIFICATION_URL,
  storefrontUrl: env.STOREFRONT_URL?.replace(/\/$/, ""),
  adminDashboardUrl: env.ADMIN_DASHBOARD_URL?.replace(/\/$/, ""),
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  telegramChatId: env.TELEGRAM_CHAT_ID,
  turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
  storefrontRevalidateSecret: env.STOREFRONT_REVALIDATE_SECRET,
  emailFromAddress: env.EMAIL_FROM_ADDRESS,
  emailFromName: env.EMAIL_FROM_NAME,
  emailReplyTo: env.EMAIL_REPLY_TO,
  emailDeliveryEnabled: env.EMAIL_DELIVERY_ENABLED === "true",
  invoiceSellerName: env.INVOICE_SELLER_NAME,
  invoiceSellerEmail: env.INVOICE_SELLER_EMAIL,
  invoiceSellerPhone: env.INVOICE_SELLER_PHONE,
  invoiceSellerAddress: env.INVOICE_SELLER_ADDRESS,
};

if (env.MIDTRANS_ENV === "production" && (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)) {
  throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required for production payments");
}

export function requireDatabaseUrl() {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required outside the Cloudflare Worker runtime");
  return config.databaseUrl;
}
