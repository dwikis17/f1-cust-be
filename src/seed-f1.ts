import "dotenv/config";
import { prisma } from "./db-node.js";

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

async function main() {
  for (const team of teams) {
    const savedTeam = await prisma.team.upsert({
      where: { slug: team.slug },
      create: { name: team.name, slug: team.slug, logoUrl: logoUrl(team.asset) },
      update: { name: team.name, logoUrl: logoUrl(team.asset) },
    });
    for (const [name, slug, racingNumber, asset] of team.drivers) {
      await prisma.driver.upsert({
        where: { slug },
        create: { name, slug, racingNumber, photoUrl: photoUrl(team.asset, asset), teamId: savedTeam.id },
        update: { name, racingNumber, photoUrl: photoUrl(team.asset, asset), teamId: savedTeam.id },
      });
    }
  }
  console.log(`Seeded ${teams.length} teams and ${teams.reduce((total, team) => total + team.drivers.length, 0)} drivers`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
