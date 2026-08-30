import "dotenv/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./db-node.js";
import { storefrontContentSeed } from "./storefront-content.js";

const logoUrl = (team: string) =>
  `https://media.formula1.com/image/upload/c_fit,w_512,h_256/q_auto/v1740000001/common/f1/2026/${team}/2026${team}logowhite.webp`;
const photoUrl = (team: string, driver: string) =>
  `https://media.formula1.com/image/upload/c_lfill,w_440/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000001/common/f1/2026/${team}/${driver}/2026${team}${driver}right.webp`;

const teams = [
  { name: "Mercedes", slug: "mercedes", asset: "mercedes", drivers: [
    ["George Russell", "george-russell", 63, "georus01"],
    ["Kimi Antonelli", "kimi-antonelli", 12, "andant01"],
  ] },
  { name: "Ferrari", slug: "ferrari", asset: "ferrari", drivers: [
    ["Charles Leclerc", "charles-leclerc", 16, "chalec01"],
    ["Lewis Hamilton", "lewis-hamilton", 44, "lewham01"],
  ] },
  { name: "McLaren", slug: "mclaren", asset: "mclaren", drivers: [
    ["Lando Norris", "lando-norris", 1, "lannor01"],
    ["Oscar Piastri", "oscar-piastri", 81, "oscpia01"],
  ] },
  { name: "Red Bull Racing", slug: "red-bull-racing", asset: "redbullracing", drivers: [
    ["Max Verstappen", "max-verstappen", 3, "maxver01"],
    ["Isack Hadjar", "isack-hadjar", 6, "isahad01"],
  ] },
  { name: "Alpine", slug: "alpine", asset: "alpine", drivers: [
    ["Pierre Gasly", "pierre-gasly", 10, "piegas01"],
    ["Franco Colapinto", "franco-colapinto", 43, "fracol01"],
  ] },
  { name: "Racing Bulls", slug: "racing-bulls", asset: "racingbulls", drivers: [
    ["Liam Lawson", "liam-lawson", 30, "lialaw01"],
    ["Arvid Lindblad", "arvid-lindblad", 41, "arvlin01"],
  ] },
  { name: "Haas F1 Team", slug: "haas", asset: "haasf1team", drivers: [
    ["Esteban Ocon", "esteban-ocon", 31, "estoco01"],
    ["Oliver Bearman", "oliver-bearman", 87, "olibea01"],
  ] },
  { name: "Williams", slug: "williams", asset: "williams", drivers: [
    ["Carlos Sainz", "carlos-sainz", 55, "carsai01"],
    ["Alexander Albon", "alexander-albon", 23, "alealb01"],
  ] },
  { name: "Audi", slug: "audi", asset: "audi", drivers: [
    ["Nico Hulkenberg", "nico-hulkenberg", 27, "nichul01"],
    ["Gabriel Bortoleto", "gabriel-bortoleto", 5, "gabbor01"],
  ] },
  { name: "Aston Martin", slug: "aston-martin", asset: "astonmartin", drivers: [
    ["Fernando Alonso", "fernando-alonso", 14, "feralo01"],
    ["Lance Stroll", "lance-stroll", 18, "lanstr01"],
  ] },
  { name: "Cadillac", slug: "cadillac", asset: "cadillac", drivers: [
    ["Sergio Perez", "sergio-perez", 11, "serper01"],
    ["Valtteri Bottas", "valtteri-bottas", 77, "valbot01"],
  ] },
] as const;

export const teamCopies: Record<string, { description: string; descriptionId: string }> = {
  mercedes: {
    description: "Explore Mercedes-AMG Petronas F1 teamwear, caps, and collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Jelajahi pakaian tim, topi, dan koleksi Mercedes-AMG Petronas F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  ferrari: {
    description: "Shop Ferrari F1 teamwear, racing-inspired apparel, caps, and collectibles at Valyde Jersey in Indonesia.",
    descriptionId: "Belanja pakaian tim Ferrari F1, apparel bernuansa balap, topi, dan koleksi di Valyde Jersey Indonesia.",
  },
  mclaren: {
    description: "Discover McLaren F1 teamwear, driver apparel, caps, and collectibles at Valyde Jersey for Indonesian fans.",
    descriptionId: "Temukan pakaian tim, apparel pembalap, topi, dan koleksi McLaren F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "red-bull-racing": {
    description: "Shop Red Bull Racing F1 teamwear, caps, and fan collectibles at Valyde Jersey, shipped for fans in Indonesia.",
    descriptionId: "Belanja pakaian tim, topi, dan koleksi penggemar Red Bull Racing F1 di Valyde Jersey untuk Indonesia.",
  },
  alpine: {
    description: "Explore Alpine F1 teamwear, apparel, caps, and racing collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Jelajahi pakaian tim, apparel, topi, dan koleksi balap Alpine F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "racing-bulls": {
    description: "Shop Racing Bulls F1 teamwear, caps, and modern racing collectibles at Valyde Jersey in Indonesia.",
    descriptionId: "Belanja pakaian tim, topi, dan koleksi balap modern Racing Bulls F1 di Valyde Jersey Indonesia.",
  },
  haas: {
    description: "Discover Haas F1 Team apparel, teamwear, caps, and collectibles at Valyde Jersey for fans across Indonesia.",
    descriptionId: "Temukan apparel, pakaian tim, topi, dan koleksi Haas F1 Team di Valyde Jersey untuk penggemar Indonesia.",
  },
  williams: {
    description: "Shop Williams Racing F1 teamwear, heritage-inspired apparel, caps, and collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Belanja pakaian tim, apparel bernuansa sejarah, topi, dan koleksi Williams Racing F1 di Valyde Jersey Indonesia.",
  },
  audi: {
    description: "Explore Audi F1 teamwear, performance apparel, caps, and racing collectibles at Valyde Jersey for Indonesia.",
    descriptionId: "Jelajahi pakaian tim, apparel performa, topi, dan koleksi balap Audi F1 di Valyde Jersey untuk Indonesia.",
  },
  "aston-martin": {
    description: "Shop Aston Martin F1 teamwear, premium apparel, caps, and collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Belanja pakaian tim, apparel premium, topi, dan koleksi Aston Martin F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  cadillac: {
    description: "Discover Cadillac F1 teamwear, apparel, caps, and racing collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Temukan pakaian tim, apparel, topi, dan koleksi balap Cadillac F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
};

export const driverCopies: Record<string, { description: string; descriptionId: string }> = {
  "george-russell": {
    description: "Shop George Russell Mercedes F1 apparel, caps, and driver collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap George Russell Mercedes F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "kimi-antonelli": {
    description: "Discover Kimi Antonelli Mercedes F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Temukan apparel, topi, dan koleksi pembalap Kimi Antonelli Mercedes F1 di Valyde Jersey Indonesia.",
  },
  "charles-leclerc": {
    description: "Shop Charles Leclerc Ferrari F1 apparel, caps, and driver collectibles at Valyde Jersey for Indonesian fans.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Charles Leclerc Ferrari F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "lewis-hamilton": {
    description: "Explore Lewis Hamilton Ferrari F1 apparel, caps, and driver collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Jelajahi apparel, topi, dan koleksi pembalap Lewis Hamilton Ferrari F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "lando-norris": {
    description: "Shop Lando Norris McLaren F1 apparel, caps, and driver collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Lando Norris McLaren F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "oscar-piastri": {
    description: "Discover Oscar Piastri McLaren F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Temukan apparel, topi, dan koleksi pembalap Oscar Piastri McLaren F1 di Valyde Jersey Indonesia.",
  },
  "max-verstappen": {
    description: "Shop Max Verstappen Red Bull Racing F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Max Verstappen Red Bull Racing F1 di Valyde Jersey Indonesia.",
  },
  "isack-hadjar": {
    description: "Explore Isack Hadjar Red Bull Racing F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Jelajahi apparel, topi, dan koleksi pembalap Isack Hadjar Red Bull Racing F1 di Valyde Jersey Indonesia.",
  },
  "pierre-gasly": {
    description: "Shop Pierre Gasly Alpine F1 apparel, caps, and driver collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Pierre Gasly Alpine F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "franco-colapinto": {
    description: "Discover Franco Colapinto Alpine F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Temukan apparel, topi, dan koleksi pembalap Franco Colapinto Alpine F1 di Valyde Jersey Indonesia.",
  },
  "liam-lawson": {
    description: "Shop Liam Lawson Racing Bulls F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Liam Lawson Racing Bulls F1 di Valyde Jersey Indonesia.",
  },
  "arvid-lindblad": {
    description: "Explore Arvid Lindblad Racing Bulls F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Jelajahi apparel, topi, dan koleksi pembalap Arvid Lindblad Racing Bulls F1 di Valyde Jersey Indonesia.",
  },
  "esteban-ocon": {
    description: "Shop Esteban Ocon Haas F1 Team apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Esteban Ocon Haas F1 Team di Valyde Jersey Indonesia.",
  },
  "oliver-bearman": {
    description: "Discover Oliver Bearman Haas F1 Team apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Temukan apparel, topi, dan koleksi pembalap Oliver Bearman Haas F1 Team di Valyde Jersey Indonesia.",
  },
  "carlos-sainz": {
    description: "Shop Carlos Sainz Williams F1 apparel, caps, and driver collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Carlos Sainz Williams F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "alexander-albon": {
    description: "Explore Alexander Albon Williams F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Jelajahi apparel, topi, dan koleksi pembalap Alexander Albon Williams F1 di Valyde Jersey Indonesia.",
  },
  "nico-hulkenberg": {
    description: "Shop Nico Hulkenberg Audi F1 apparel, caps, and driver collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Nico Hulkenberg Audi F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "gabriel-bortoleto": {
    description: "Discover Gabriel Bortoleto Audi F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Temukan apparel, topi, dan koleksi pembalap Gabriel Bortoleto Audi F1 di Valyde Jersey Indonesia.",
  },
  "fernando-alonso": {
    description: "Shop Fernando Alonso Aston Martin F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Fernando Alonso Aston Martin F1 di Valyde Jersey Indonesia.",
  },
  "lance-stroll": {
    description: "Explore Lance Stroll Aston Martin F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Jelajahi apparel, topi, dan koleksi pembalap Lance Stroll Aston Martin F1 di Valyde Jersey Indonesia.",
  },
  "sergio-perez": {
    description: "Shop Sergio Perez Cadillac F1 apparel, caps, and driver collectibles at Valyde Jersey for fans in Indonesia.",
    descriptionId: "Belanja apparel, topi, dan koleksi pembalap Sergio Perez Cadillac F1 di Valyde Jersey untuk penggemar Indonesia.",
  },
  "valtteri-bottas": {
    description: "Discover Valtteri Bottas Cadillac F1 apparel, caps, and driver collectibles at Valyde Jersey Indonesia.",
    descriptionId: "Temukan apparel, topi, dan koleksi pembalap Valtteri Bottas Cadillac F1 di Valyde Jersey Indonesia.",
  },
};

export const formulaOneCopy = {
  description:
    "Shop Formula 1 merchandise at Valyde Jersey, including teamwear, driver apparel, caps, and collectibles for F1 fans in Indonesia.",
  descriptionId:
    "Belanja merchandise Formula 1 di Valyde Jersey, termasuk pakaian tim, merchandise pembalap, topi, dan koleksi untuk penggemar F1 Indonesia.",
};

export const driversCopy = {
  description:
    "Shop Formula 1 driver merchandise at Valyde Jersey, including apparel, caps, and collectibles from leading F1 drivers in Indonesia.",
  descriptionId:
    "Belanja merchandise pembalap Formula 1 di Valyde Jersey, termasuk pakaian, topi, dan koleksi pembalap F1 favorit di Indonesia.",
};

async function main() {
  await prisma.storefrontContent.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      supportEmail: storefrontContentSeed.support.email,
      supportWhatsappNumber: storefrontContentSeed.support.whatsappNumber,
      supportWhatsappDisplay: storefrontContentSeed.support.whatsappDisplay,
      shippingReturns: storefrontContentSeed.shippingReturns,
    },
    update: {
      supportEmail: storefrontContentSeed.support.email,
      supportWhatsappNumber: storefrontContentSeed.support.whatsappNumber,
      supportWhatsappDisplay: storefrontContentSeed.support.whatsappDisplay,
      shippingReturns: storefrontContentSeed.shippingReturns,
    },
  });
  const teamIds = new Map<string, string>();
  const driverIds = new Map<string, string>();
  const teamCollectionIds = new Map<string, string>();
  const driverCollectionIds = new Map<string, string>();
  const formulaOne = await prisma.collection.upsert({
    where: { slug: "formula-1" },
    create: { name: "Formula 1", slug: "formula-1", kind: "DOMAIN", position: 0, ...formulaOneCopy },
    update: { name: "Formula 1", kind: "DOMAIN", position: 0, active: true, ...formulaOneCopy },
  });
  const driversCollection = await prisma.collection.upsert({
    where: { slug: "drivers" },
    create: { name: "Drivers", slug: "drivers", kind: "DOMAIN", position: 1, ...driversCopy },
    update: { name: "Drivers", kind: "DOMAIN", position: 1, active: true, ...driversCopy },
  });

  for (const [teamPosition, team] of teams.entries()) {
    const savedTeam = await prisma.team.upsert({
      where: { slug: team.slug },
      create: { name: team.name, slug: team.slug, logoUrl: logoUrl(team.asset) },
      update: { name: team.name, logoUrl: logoUrl(team.asset) },
    });
    teamIds.set(team.slug, savedTeam.id);
    const teamCopy = teamCopies[team.slug];
    const teamCollection = await prisma.collection.upsert({
      where: { slug: team.slug },
      create: {
        name: team.name,
        slug: team.slug,
        kind: "TEAM",
        teamId: savedTeam.id,
        parentId: formulaOne.id,
        imageUrl: logoUrl(team.asset),
        position: teamPosition,
        ...teamCopy,
      },
      update: {
        name: team.name,
        kind: "TEAM",
        teamId: savedTeam.id,
        driverId: null,
        parentId: formulaOne.id,
        imageUrl: logoUrl(team.asset),
        position: teamPosition,
        active: true,
        ...teamCopy,
      },
    });
    teamCollectionIds.set(team.slug, teamCollection.id);
    for (const [driverPosition, [name, slug, racingNumber, asset]] of team.drivers.entries()) {
      const savedDriver = await prisma.driver.upsert({
        where: { slug },
        create: { name, slug, racingNumber, photoUrl: photoUrl(team.asset, asset), teamId: savedTeam.id },
        update: { name, racingNumber, photoUrl: photoUrl(team.asset, asset), teamId: savedTeam.id },
      });
      driverIds.set(slug, savedDriver.id);
      const driverCopy = driverCopies[slug];
      const driverCollection = await prisma.collection.upsert({
        where: { slug },
        create: {
          name,
          slug,
          kind: "DRIVER",
          driverId: savedDriver.id,
          parentId: driversCollection.id,
          imageUrl: photoUrl(team.asset, asset),
          position: teamPosition * 10 + driverPosition,
          ...driverCopy,
        },
        update: {
          name,
          kind: "DRIVER",
          teamId: null,
          driverId: savedDriver.id,
          parentId: driversCollection.id,
          imageUrl: photoUrl(team.asset, asset),
          position: teamPosition * 10 + driverPosition,
          active: true,
          ...driverCopy,
        },
      });
      driverCollectionIds.set(slug, driverCollection.id);
    }
  }

  const headwear = await prisma.category.upsert({
    where: { slug: "headwear" },
    create: { name: "Headwear", slug: "headwear" },
    update: { name: "Headwear" },
  });
  const cap = await prisma.product.upsert({
    where: { slug: "mclaren-shared-driver-cap" },
    create: {
      name: "McLaren Shared Driver Cap",
      slug: "mclaren-shared-driver-cap",
      description: "An optionless cap related to both current McLaren drivers.",
      priceIdr: 949_000,
      status: "ACTIVE",
      condition: "BNWT",
      categoryId: headwear.id,
      teamId: teamIds.get("mclaren"),
      audience: "UNISEX",
    },
    update: {
      name: "McLaren Shared Driver Cap",
      description: "An optionless cap related to both current McLaren drivers.",
      priceIdr: 949_000,
      status: "ACTIVE",
      condition: "BNWT",
      categoryId: headwear.id,
      teamId: teamIds.get("mclaren"),
      audience: "UNISEX",
    },
  });
  await prisma.productVariant.upsert({
    where: { sku: "MCL-SHARED-CAP-DEFAULT" },
    create: {
      productId: cap.id,
      sku: "MCL-SHARED-CAP-DEFAULT",
      stockQuantity: 25,
      packageLengthMm: 250,
      packageWidthMm: 200,
      packageHeightMm: 120,
      packageWeightG: 220,
    },
    update: {
      productId: cap.id,
      size: null,
      color: null,
      stockQuantity: 25,
      packageLengthMm: 250,
      packageWidthMm: 200,
      packageHeightMm: 120,
      packageWeightG: 220,
    },
  });
  const capDriverIds = [driverIds.get("lando-norris"), driverIds.get("oscar-piastri")].filter(
    (id): id is string => Boolean(id),
  );
  const capCollectionIds = [
    formulaOne.id,
    driversCollection.id,
    teamCollectionIds.get("mclaren"),
    driverCollectionIds.get("lando-norris"),
    driverCollectionIds.get("oscar-piastri"),
  ].filter((id): id is string => Boolean(id));
  await prisma.$transaction([
    prisma.productDriver.deleteMany({ where: { productId: cap.id } }),
    prisma.productCollection.deleteMany({ where: { productId: cap.id } }),
    prisma.productDriver.createMany({ data: capDriverIds.map((driverId) => ({ productId: cap.id, driverId })) }),
    prisma.productCollection.createMany({
      data: capCollectionIds.map((collectionId, position) => ({ productId: cap.id, collectionId, position })),
    }),
  ]);
  console.log(
    `Seeded ${teams.length} teams, ${teams.reduce((total, team) => total + team.drivers.length, 0)} drivers, their collections, and a multi-driver optionless product`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}
