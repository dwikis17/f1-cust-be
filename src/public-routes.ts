import { Router } from "express";
import { PublicCatalogController } from "./controllers/public/catalog-controller.js";
import { PublicProductController } from "./controllers/public/product-controller.js";
import { PublicShippingController } from "./controllers/public/shipping-controller.js";
import { PublicCheckoutController } from "./controllers/public/checkout-controller.js";
import { BiteshipWebhookController } from "./controllers/public/biteship-webhook-controller.js";
import { PromoCodeController } from "./controllers/promo-code-controller.js";
import { FaqController } from "./controllers/faq-controller.js";
import { HomeController } from "./controllers/home-controller.js";

const router = Router();

router.get("/categories", PublicCatalogController.listCategories);
router.get("/tags", PublicCatalogController.listTags);
router.get("/teams", PublicCatalogController.listTeams);
router.get("/drivers", PublicCatalogController.listDrivers);
router.get("/collections", PublicCatalogController.listCollections);
router.get("/collections/:slug/products", PublicProductController.listCollectionProducts);
router.get("/collections/:slug", PublicCatalogController.findCollection);
router.get("/products", PublicProductController.listProducts);
router.post("/products/cart-items", PublicProductController.cartItems);
router.get("/products/:slug", PublicProductController.findProduct);
router.get("/faqs", FaqController.listPublic);
router.get("/home", HomeController.listPublic);
router.get("/home/collection-blocks", HomeController.listPublicCollectionBlocks);
router.post("/shipping/rates", PublicShippingController.rates);
router.post("/promo-codes/preview", PromoCodeController.preview);
router.post("/checkout", PublicCheckoutController.create);
router.post("/orders/track", PublicCheckoutController.track);
router.get("/orders/:id", PublicCheckoutController.find);
router.post("/payments/midtrans/notification", PublicCheckoutController.midtransNotification);
router.post("/webhooks/biteship", BiteshipWebhookController.status);

export default router;
