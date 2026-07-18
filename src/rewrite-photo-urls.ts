import "dotenv/config";
import { disconnectLocalPrisma, prisma } from "./db-node.js";
import { normalizePhotoPublicBaseUrl, rewrittenPhotoUrl } from "./photo-storage.js";

const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--apply");
if (unknownArguments.length) throw new Error(`Unknown argument: ${unknownArguments[0]}`);

const targetValue = process.env.PHOTO_PUBLIC_BASE_URL;
if (!targetValue) throw new Error("PHOTO_PUBLIC_BASE_URL is required");
const targetBaseUrl = normalizePhotoPublicBaseUrl(targetValue);
const previousBaseUrl = process.env.PHOTO_PREVIOUS_PUBLIC_BASE_URL
  ? normalizePhotoPublicBaseUrl(process.env.PHOTO_PREVIOUS_PUBLIC_BASE_URL)
  : undefined;
const apply = process.argv.includes("--apply");

try {
  const [teams, drivers, photos] = await Promise.all([
    prisma.team.findMany({ where: { logoUrl: { not: null } }, select: { id: true, logoUrl: true } }),
    prisma.driver.findMany({ where: { photoUrl: { not: null } }, select: { id: true, photoUrl: true } }),
    prisma.productPhoto.findMany({ select: { id: true, path: true } }),
  ]);

  const teamChanges = teams.flatMap(({ id, logoUrl }) => {
    const next = rewrittenPhotoUrl(logoUrl!, targetBaseUrl, previousBaseUrl);
    return next === logoUrl ? [] : [{ id, url: next }];
  });
  const driverChanges = drivers.flatMap(({ id, photoUrl }) => {
    const next = rewrittenPhotoUrl(photoUrl!, targetBaseUrl, previousBaseUrl);
    return next === photoUrl ? [] : [{ id, url: next }];
  });
  const photoChanges = photos.flatMap(({ id, path }) => {
    const next = rewrittenPhotoUrl(path, targetBaseUrl, previousBaseUrl);
    return next === path ? [] : [{ id, url: next }];
  });
  const total = teamChanges.length + driverChanges.length + photoChanges.length;

  console.log({
    mode: apply ? "apply" : "dry-run",
    targetBaseUrl,
    teams: teamChanges.length,
    drivers: driverChanges.length,
    productPhotos: photoChanges.length,
    total,
  });

  if (apply && total > 0) {
    await prisma.$transaction(async (tx) => {
      for (const { id, url } of teamChanges) await tx.team.update({ where: { id }, data: { logoUrl: url } });
      for (const { id, url } of driverChanges) await tx.driver.update({ where: { id }, data: { photoUrl: url } });
      for (const { id, url } of photoChanges) await tx.productPhoto.update({ where: { id }, data: { path: url } });
    });
    console.log("Photo URLs updated");
  }
} finally {
  await disconnectLocalPrisma();
}
