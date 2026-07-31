import { prisma } from "../config/db";

export async function refreshCityListingCount(cityId: number | null) {
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
  } catch (error) {
    console.error("Error refreshing city listing counts:", error);
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
  } catch (error) {
    console.error("Error syncing all city listing counts:", error);
  }
}
