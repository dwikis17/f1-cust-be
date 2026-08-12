import type { NextFunction, Request, Response } from "express";
import { parse } from "../../http.js";
import {
  idSchema,
  productPatchSchema,
  productSchema,
  variantPatchSchema,
  variantSchema,
} from "../../schemas.js";
import { ProductService } from "../../services/admin/product-service.js";
import { revalidateStorefrontNow } from "../../storefront-revalidation.js";

export class ProductController {
  static async listProducts(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await ProductService.listProducts());
    } catch (error) {
      next(error);
    }
  }
  static async findProduct(request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await ProductService.findProduct(parse(idSchema, request.params.id)));
    } catch (error) {
      next(error);
    }
  }
  static async createProduct(request: Request, response: Response, next: NextFunction) {
    try {
      const product = await ProductService.createProduct(parse(productSchema, request.body));
      await revalidateStorefrontNow(["catalog:products", `catalog:product:${product.slug}`]);
      response.status(201).json(product);
    } catch (error) {
      next(error);
    }
  }
  static async updateProduct(request: Request, response: Response, next: NextFunction) {
    try {
      const id = parse(idSchema, request.params.id);
      const previous = await ProductService.findProduct(id);
      const product = await ProductService.updateProduct(id, parse(productPatchSchema, request.body));
      await revalidateStorefrontNow(["catalog:products", `catalog:product:${previous.slug}`, `catalog:product:${product.slug}`]);
      response.json(product);
    } catch (error) {
      next(error);
    }
  }

  static async createVariant(request: Request, response: Response, next: NextFunction) {
    try {
      const productId = parse(idSchema, request.params.productId);
      const variant = await ProductService.createVariant(
        productId,
        parse(variantSchema, request.body),
      );
      const product = await ProductService.findProduct(productId);
      await revalidateStorefrontNow(["catalog:products", `catalog:product:${product.slug}`]);
      response.status(201).json(variant);
    } catch (error) {
      next(error);
    }
  }
  static async updateVariant(request: Request, response: Response, next: NextFunction) {
    try {
      const productId = parse(idSchema, request.params.productId);
      const variant = await ProductService.updateVariant(
        productId,
        parse(idSchema, request.params.id),
        parse(variantPatchSchema, request.body),
      );
      const product = await ProductService.findProduct(productId);
      await revalidateStorefrontNow(["catalog:products", `catalog:product:${product.slug}`]);
      response.json(variant);
    } catch (error) {
      next(error);
    }
  }
  static async deleteVariant(request: Request, response: Response, next: NextFunction) {
    try {
      const productId = parse(idSchema, request.params.productId);
      const product = await ProductService.findProduct(productId);
      await ProductService.deleteVariant(productId, parse(idSchema, request.params.id));
      await revalidateStorefrontNow(["catalog:products", `catalog:product:${product.slug}`]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
