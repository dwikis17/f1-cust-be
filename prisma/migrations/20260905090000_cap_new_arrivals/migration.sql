WITH ranked_new_arrivals AS (
  SELECT
    product_tag."productId",
    product_tag."tagId",
    ROW_NUMBER() OVER (ORDER BY product."createdAt" DESC, product.id ASC) AS position
  FROM "ProductTag" AS product_tag
  JOIN "Tag" AS tag ON tag.id = product_tag."tagId"
  JOIN "Product" AS product ON product.id = product_tag."productId"
  WHERE tag.slug = 'new-arrival' AND product.status = 'ACTIVE'
)
DELETE FROM "ProductTag" AS product_tag
USING ranked_new_arrivals AS ranked
WHERE product_tag."productId" = ranked."productId"
  AND product_tag."tagId" = ranked."tagId"
  AND ranked.position > 25;
