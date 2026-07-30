import { prisma } from "../config/db";

export async function refreshCityListingCount(cityId: number | null, subCityId: number | null) {
  try {
    if (cityId) {
      const count = await prisma.listing.count({
        where: {
          cityId,
          status: "ACTIVE",
        },
      });
      await prisma.city.update({
        where: { id: cityId },
        data: { activeListingsCount: count },
      });
    }
    if (subCityId) {
      const count = await prisma.listing.count({
        where: {
          subCityId,
          status: "ACTIVE",
        },
      });
      await prisma.subCity.update({
        where: { id: subCityId },
        data: { activeListingsCount: count },
      });
    }
  } catch (error) {
    console.error("Error refreshing city/sub-city listing counts:", error);
  }
}

export async function syncAllCityListingCounts() {
  try {
    const cities = await prisma.city.findMany();
    for (const city of cities) {
      const count = await prisma.listing.count({
        where: {
          cityId: city.id,
          status: "ACTIVE",
        },
      });
      await prisma.city.update({
        where: { id: city.id },
        data: { activeListingsCount: count },
      });
    }

    const subCities = await prisma.subCity.findMany();
    for (const subCity of subCities) {
      const count = await prisma.listing.count({
        where: {
          subCityId: subCity.id,
          status: "ACTIVE",
        },
      });
      await prisma.subCity.update({
        where: { id: subCity.id },
        data: { activeListingsCount: count },
      });
    }
  } catch (error) {
    console.error("Error syncing all city/sub-city listing counts:", error);
  }
}
