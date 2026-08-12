ALTER TYPE "ProductCondition" RENAME TO "ProductCondition_old";

CREATE TYPE "ProductCondition" AS ENUM ('BNWT', 'BNWOT', 'USED');

ALTER TABLE "Product"
ALTER COLUMN "condition" TYPE "ProductCondition"
USING (
  CASE "condition"::text
    WHEN 'BNIB' THEN 'BNWOT'
    WHEN 'PRE_OWNED' THEN 'USED'
    ELSE "condition"::text
  END
)::"ProductCondition";

DROP TYPE "ProductCondition_old";
