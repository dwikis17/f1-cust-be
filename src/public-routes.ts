import { Router } from "express";
import { PublicCatalogController } from "./controllers/public/catalog-controller.js";
import { PublicProductController } from "./controllers/public/product-controller.js";
import { PublicShippingController } from "./controllers/public/shipping-controller.js";
import { PublicCheckoutController } from "./controllers/public/checkout-controller.js";
import { PromoCodeController } from "./controllers/promo-code-controller.js";

const router = Router();

router.get("/categories", PublicCatalogController.listCategories);
router.get("/tags", PublicCatalogController.listTags);
router.get("/teams", PublicCatalogController.listTeams);
router.get("/drivers", PublicCatalogController.listDrivers);
router.get("/collections", PublicCatalogController.listCollections);
router.get("/collections/:slug/products", PublicProductController.listCollectionProducts);
router.get("/collections/:slug", PublicCatalogController.findCollection);
router.get("/products", PublicProductController.listProducts);
router.get("/products/:slug", PublicProductController.findProduct);
router.post("/shipping/rates", PublicShippingController.rates);
router.post("/promo-codes/preview", PromoCodeController.preview);
router.post("/checkout", PublicCheckoutController.create);
router.get("/orders/:id", PublicCheckoutController.find);
router.post("/payments/midtrans/notification", PublicCheckoutController.midtransNotification);

export default router;
