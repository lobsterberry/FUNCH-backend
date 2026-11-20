LOCK TABLE "cars" IN ACCESS EXCLUSIVE MODE;

-- A vehicle photo can be discarded only if the linked model already has it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "cars" c
    LEFT JOIN "car_model_locations" o ON o."id" = c."carModelLocationId"
    LEFT JOIN "car_models" m ON m."id" = o."carModelId"
    WHERE c."imageUrl" IS NOT NULL AND c."imageUrl" IS DISTINCT FROM m."imageUrl"
  ) THEN
    RAISE EXCEPTION 'cars.imageUrl contains photos that are missing from or differ from the linked model';
  END IF;
END $$;

ALTER TABLE "cars" DROP COLUMN "imageUrl";
