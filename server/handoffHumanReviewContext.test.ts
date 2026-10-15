import { describe, expect, it } from "vitest";
import { getHandoffHumanReviewContext, handoffHumanReviewContextCount } from "./handoffHumanReviewContext";

describe("handoffHumanReviewContext", () => {
  it("covers the recovered candidate records without treating them as daily counts", () => {
    expect(handoffHumanReviewContextCount()).toBe(29);
    const context = getHandoffHumanReviewContext({
      businessDate: "2026-10-14",
      cupEventId: "rec-20261014-1792025013.917396-9t059b",
    });

    expect(context).toMatchObject({
      sceneId: "scene-05",
      videoFile: "scene-05.mp4",
      classification: "candidate_positive",
    });
    expect(context?.decisionPrompt).toContain("Do not create a daily cup count");
  });

  it("groups scene 08 and scene 10 repeats as one persistent cup per scene", () => {
    const sceneEightFirst = getHandoffHumanReviewContext({
      businessDate: "2026-10-14",
      cupEventId: "rec-20261014-1792026717.54167-m1etak",
    });
    const sceneEightLast = getHandoffHumanReviewContext({
      businessDate: "2026-10-14",
      cupEventId: "rec-20261014-1792026752.537352-jntcdl",
    });
    const sceneTenFirst = getHandoffHumanReviewContext({
      businessDate: "2026-10-14",
      cupEventId: "rec-20261014-1792027230.238408-n2yl2x",
    });
    const sceneTenLast = getHandoffHumanReviewContext({
      businessDate: "2026-10-14",
      cupEventId: "rec-20261014-1792027256.243379-d613yi",
    });

    expect(sceneEightFirst?.duplicateGroup).toBe("scene-08-one-persistent-cup");
    expect(sceneEightLast?.duplicateGroup).toBe("scene-08-one-persistent-cup");
    expect(sceneTenFirst?.duplicateGroup).toBe("scene-10-one-persistent-cup");
    expect(sceneTenLast?.duplicateGroup).toBe("scene-10-one-persistent-cup");
  });

  it("does not return the date-specific brief for a different day", () => {
    expect(getHandoffHumanReviewContext({
      businessDate: "2026-10-15",
      cupEventId: "rec-20261014-1792025013.917396-9t059b",
    })).toBeNull();
  });
});
