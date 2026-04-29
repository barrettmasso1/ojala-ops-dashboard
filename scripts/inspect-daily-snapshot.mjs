import { getDailyOperationsSnapshot, listReadyMadeGelatoWeights } from "../server/db.ts";

const dates = ["2026-04-28", "2026-04-29"];

for (const businessDate of dates) {
  const snapshot = await getDailyOperationsSnapshot(businessDate);
  const weights = await listReadyMadeGelatoWeights(businessDate);

  console.log(`\n=== ${businessDate} ===`);
  console.log(JSON.stringify({
    businessDate: snapshot.businessDate,
    reportCount: snapshot.reportCount,
    openingSubmissionCount: snapshot.openingSubmissionCount,
    closingSubmissionCount: snapshot.closingSubmissionCount,
    sales: snapshot.sales,
    soldVolumeOunces: snapshot.soldVolumeOunces,
    gelato: {
      openingVolumeOunces: snapshot.gelato.openingVolumeOunces,
      closingVolumeOunces: snapshot.gelato.closingVolumeOunces,
      actualDistributedVolumeOunces: snapshot.gelato.actualDistributedVolumeOunces,
      varianceVolumeOunces: snapshot.gelato.varianceVolumeOunces,
      flavors: snapshot.gelato.flavors,
    },
  }, null, 2));

  console.log("weights:", JSON.stringify(weights, null, 2));
}
