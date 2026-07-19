import { Router } from "express";
import multer from "multer";
import { config } from "./config.js";
import { AuthController } from "./controllers/admin/auth-controller.js";
import { CatalogController } from "./controllers/admin/catalog-controller.js";
import { MediaController } from "./controllers/admin/media-controller.js";
import { OrderController } from "./controllers/admin/order-controller.js";
import { ProductController } from "./controllers/admin/product-controller.js";
import { PromoCodeController } from "./controllers/promo-code-controller.js";
import { FaqController } from "./controllers/faq-controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

router.post("/auth/login", AuthController.login);
router.use(AuthController.requireAdmin);
router.post("/auth/logout", AuthController.logout);
router.get("/auth/me", AuthController.me);

router.get("/orders/:id/payment-events", OrderController.listPaymentEvents);

router.get("/faqs", FaqController.list);
router.post("/faqs", FaqController.create);
router.patch("/faqs/:id", FaqController.update);
router.delete("/faqs/:id", FaqController.remove);

router.get("/promo-codes", PromoCodeController.list);
router.post("/promo-codes", PromoCodeController.create);
router.patch("/promo-codes/:id", PromoCodeController.update);
router.get("/promo-codes/:id/usages", PromoCodeController.usages);

router.get("/categories", CatalogController.listCategories);
router.post("/categories", CatalogController.createCategory);
router.patch("/categories/:id", CatalogController.updateCategory);
router.delete("/categories/:id", CatalogController.deleteCategory);

router.get("/tags", CatalogController.listTags);
router.post("/tags", CatalogController.createTag);
router.patch("/tags/:id", CatalogController.updateTag);
router.delete("/tags/:id", CatalogController.deleteTag);

router.get("/teams", CatalogController.listTeams);
router.post("/teams", CatalogController.createTeam);
router.patch("/teams/:id", CatalogController.updateTeam);
router.delete("/teams/:id", CatalogController.deleteTeam);

router.get("/drivers", CatalogController.listDrivers);
router.post("/drivers", CatalogController.createDriver);
router.patch("/drivers/:id", CatalogController.updateDriver);
router.delete("/drivers/:id", CatalogController.deleteDriver);

router.get("/collections", CatalogController.listCollections);
router.get("/collections/:id", CatalogController.findCollection);
router.post("/collections", CatalogController.createCollection);
router.patch("/collections/:id", CatalogController.updateCollection);
router.put("/collections/:id/products", CatalogController.replaceCollectionProducts);
router.delete("/collections/:id", CatalogController.deleteCollection);

router.get("/products", ProductController.listProducts);
router.get("/products/:id", ProductController.findProduct);
router.post("/products", ProductController.createProduct);
router.patch("/products/:id", ProductController.updateProduct);
router.post("/products/:productId/variants", ProductController.createVariant);
router.patch("/products/:productId/variants/:id", ProductController.updateVariant);
router.delete("/products/:productId/variants/:id", ProductController.deleteVariant);

router.post("/teams/:id/logo", upload.single("image"), MediaController.replaceTeamLogo);
router.delete("/teams/:id/logo", MediaController.deleteTeamLogo);
router.post("/drivers/:id/photo", upload.single("image"), MediaController.replaceDriverPhoto);
router.delete("/drivers/:id/photo", MediaController.deleteDriverPhoto);
router.post("/products/:productId/photos", upload.single("photo"), MediaController.createProductPhoto);
router.patch("/products/:productId/photos/:id", MediaController.updateProductPhoto);
router.delete("/products/:productId/photos/:id", MediaController.deleteProductPhoto);

export default router;
