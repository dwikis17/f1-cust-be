import type { Request, Response } from "express";
import { parse } from "../../http.js";
import {
  idSchema,
  productPatchSchema,
  productSchema,
  variantPatchSchema,
  variantSchema,
} from "../../schemas.js";
import { ProductService } from "../../services/admin/product-service.js";

export class ProductController {
  static async listProducts(_request: Request, response: Response) {
    response.json(await ProductService.listProducts());
  }
  static async findProduct(request: Request, response: Response) {
    response.json(await ProductService.findProduct(parse(idSchema, request.params.id)));
  }
  static async createProduct(request: Request, response: Response) {
    response.status(201).json(await ProductService.createProduct(parse(productSchema, request.body)));
  }
  static async updateProduct(request: Request, response: Response) {
    response.json(await ProductService.updateProduct(parse(idSchema, request.params.id), parse(productPatchSchema, request.body)));
  }

  static async createVariant(request: Request, response: Response) {
    response.status(201).json(await ProductService.createVariant(
      parse(idSchema, request.params.productId),
      parse(variantSchema, request.body),
    ));
  }
  static async updateVariant(request: Request, response: Response) {
    response.json(await ProductService.updateVariant(
      parse(idSchema, request.params.productId),
      parse(idSchema, request.params.id),
      parse(variantPatchSchema, request.body),
    ));
  }
  static async deleteVariant(request: Request, response: Response) {
    await ProductService.deleteVariant(parse(idSchema, request.params.productId), parse(idSchema, request.params.id));
    response.status(204).send();
  }
}
