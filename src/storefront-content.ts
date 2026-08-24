import { z } from "zod";

const entryIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const shortTextSchema = z.string().trim().min(1).max(240);
const bodyTextSchema = z.string().trim().min(1).max(5_000);

export const localizedTextSchema = z.object({
  en: shortTextSchema,
  id: shortTextSchema,
}).strict();

const localizedBodySchema = z.object({
  en: bodyTextSchema,
  id: bodyTextSchema,
}).strict();

const shippingFactSchema = z.object({
  id: entryIdSchema,
  label: localizedTextSchema,
  value: localizedTextSchema,
}).strict();

const shippingItemSchema = z.object({
  id: entryIdSchema,
  text: localizedTextSchema,
}).strict();

const shippingSectionSchema = z.object({
  id: entryIdSchema,
  title: localizedTextSchema,
  body: localizedBodySchema,
  items: z.array(shippingItemSchema).max(20),
}).strict();

export const shippingReturnsDocumentSchema = z.object({
  title: localizedTextSchema,
  intro: localizedBodySchema,
  facts: z.array(shippingFactSchema).min(1).max(12),
  sections: z.array(shippingSectionSchema).min(1).max(20),
}).strict().superRefine((document, context) => {
  const ids = [
    ...document.facts.map(({ id }) => id),
    ...document.sections.flatMap(({ id, items }) => [id, ...items.map((item) => item.id)]),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      context.addIssue({ code: "custom", message: "Entry IDs must be unique", path: ["sections"] });
      return;
    }
    seen.add(id);
  }
});

export const storefrontContentSchema = z.object({
  support: z.object({
    email: z.email().max(320),
    whatsappNumber: z.string().regex(/^\d{8,15}$/),
    whatsappDisplay: shortTextSchema,
  }).strict(),
  shippingReturns: shippingReturnsDocumentSchema,
}).strict();

export type StorefrontContentInput = z.infer<typeof storefrontContentSchema>;
export type ShippingReturnsDocument = z.infer<typeof shippingReturnsDocumentSchema>;

export const storefrontContentSeed = {
  support: {
    email: "support@valydejersey.com",
    whatsappNumber: "6285121565774",
    whatsappDisplay: "+62 851-2156-5774",
  },
  shippingReturns: {
    title: { en: "Shipping & returns", id: "Pengiriman & pengembalian" },
    intro: {
      en: "How Valyde Jersey processes orders, delivers across Indonesia, and handles returns or exchanges.",
      id: "Cara Valyde Jersey memproses pesanan, mengirim ke seluruh Indonesia, dan menangani pengembalian atau penukaran.",
    },
    facts: [
      {
        id: "delivery",
        label: { en: "Delivery", id: "Pengiriman" },
        value: { en: "Tracked rates at checkout", id: "Tarif terlacak di checkout" },
      },
      {
        id: "return-window",
        label: { en: "Return window", id: "Batas pengembalian" },
        value: { en: "3 calendar days", id: "3 hari kalender" },
      },
      {
        id: "condition",
        label: { en: "Condition", id: "Kondisi" },
        value: {
          en: "Unused, tagged, with unboxing video",
          id: "Belum digunakan, tag terpasang, dengan video unboxing",
        },
      },
    ],
    sections: [
      {
        id: "products-prices",
        title: { en: "Products and prices", id: "Produk dan harga" },
        body: {
          en: "We aim to show products accurately, including photos, size, colour, materials, and other details. Colour on screen can still differ slightly from the item because of lighting, device, or display settings. Prices, stock, promotions, and discounts may change at any time.",
          id: "Valyde Jersey berusaha menampilkan informasi produk secara akurat, termasuk foto, ukuran, warna, bahan, dan detail lainnya. Warna pada foto tetap dapat sedikit berbeda dari barang aslinya karena pencahayaan, perangkat, atau pengaturan layar. Harga, stok, promosi, dan diskon dapat berubah sewaktu-waktu.",
        },
        items: [],
      },
      {
        id: "orders-payment",
        title: { en: "Orders and payment", id: "Pemesanan dan pembayaran" },
        body: {
          en: "An order is processed after checkout is completed and payment is received in full. Available methods may include bank transfer, e-wallet, card, or other options shown at checkout. Valyde Jersey may cancel an order if payment is not completed within the stated time.",
          id: "Pesanan diproses setelah checkout selesai dan pembayaran diterima secara penuh. Metode yang tersedia dapat berupa transfer bank, e-wallet, kartu, atau opsi lain yang tampil di halaman checkout. Valyde Jersey berhak membatalkan pesanan jika pembayaran tidak diselesaikan dalam batas waktu yang ditentukan.",
        },
        items: [],
      },
      {
        id: "shipping",
        title: { en: "Shipping", id: "Pengiriman" },
        body: {
          en: "Orders are sent with the courier or logistics partner available at checkout. Delivery estimates vary by destination, service, and the courier’s operating conditions. Live tracked rates are calculated from your Indonesian delivery address; the amount shown at checkout is the shipping fee you pay.",
          id: "Pesanan dikirim melalui ekspedisi atau mitra logistik yang tersedia saat pemesanan. Estimasi tiba dapat berbeda tergantung lokasi tujuan, layanan yang dipilih, dan kondisi operasional ekspedisi. Tarif terlacak dihitung dari alamat pengiriman di Indonesia; jumlah yang tampil di checkout adalah biaya kirim yang Anda bayar.",
        },
        items: [],
      },
      {
        id: "after-dispatch",
        title: { en: "After dispatch", id: "Setelah paket dikirim" },
        body: {
          en: "Once the parcel is handed to the courier, the shipment is the courier’s responsibility. After it is marked delivered to the address you provided, later loss or damage is your responsibility, unless the courier’s policy or applicable law says otherwise. Tracking details are sent to your checkout email, and you can also follow the shipment from Track your order.",
          id: "Setelah paket diserahkan kepada ekspedisi, proses pengiriman menjadi tanggung jawab pihak ekspedisi. Jika paket telah dinyatakan terkirim ke alamat yang Anda berikan, risiko kehilangan atau kerusakan setelah itu menjadi tanggung jawab pelanggan, kecuali ditentukan lain oleh kebijakan ekspedisi atau hukum yang berlaku. Detail pelacakan dikirim ke email checkout, dan kiriman juga dapat diikuti di Lacak pesanan.",
        },
        items: [],
      },
      {
        id: "returns-exchanges",
        title: { en: "Returns and exchanges", id: "Pengembalian dan penukaran" },
        body: {
          en: "A return or exchange request must be submitted within 3 calendar days of delivery. The item must meet all of the following:",
          id: "Permintaan pengembalian atau penukaran dapat diajukan paling lambat 3 hari kalender setelah produk diterima. Produk harus memenuhi seluruh ketentuan berikut:",
        },
        items: [
          {
            id: "not-washed-or-worn",
            text: { en: "It has not been washed or worn.", id: "Belum dicuci atau digunakan." },
          },
          {
            id: "same-condition",
            text: {
              en: "It is in the same condition as when it arrived.",
              id: "Kondisinya sama seperti saat diterima.",
            },
          },
          {
            id: "tags-attached",
            text: {
              en: "Original labels or tags are still attached.",
              id: "Label atau tag asli masih terpasang.",
            },
          },
          {
            id: "unboxing-video",
            text: {
              en: "You include an unboxing video from when the parcel was first opened.",
              id: "Anda menyertakan video unboxing saat paket pertama kali dibuka.",
            },
          },
        ],
      },
      {
        id: "return-shipping",
        title: { en: "Return shipping", id: "Biaya pengembalian" },
        body: {
          en: "You cover shipping for a return or exchange, unless Valyde Jersey sent the wrong size, colour, or product, or the item has a defect that is our responsibility. Requests that do not meet these conditions may be declined.",
          id: "Biaya kirim untuk pengembalian atau penukaran ditanggung pelanggan, kecuali kesalahan ada di pihak Valyde Jersey, seperti salah ukuran, warna, atau produk, atau terdapat cacat yang menjadi tanggung jawab kami. Pengajuan yang tidak memenuhi ketentuan ini dapat ditolak.",
        },
        items: [],
      },
      {
        id: "how-to-request",
        title: { en: "How to request", id: "Cara mengajukan" },
        body: {
          en: "Contact us on WhatsApp or email before sending anything back. Include your order ID, checkout email, the item, and your unboxing video so we can confirm the next step.",
          id: "Hubungi kami melalui WhatsApp atau email sebelum mengirim barang kembali. Sertakan ID pesanan, email checkout, barang yang diajukan, dan video unboxing agar kami dapat mengonfirmasi langkah berikutnya.",
        },
        items: [],
      },
    ],
  },
} satisfies StorefrontContentInput;
