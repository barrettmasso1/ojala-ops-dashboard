import { describe, expect, it } from "vitest";
import { calculateAttendanceHours, getEffectiveAttendanceClockOutAt, getPacificBusinessDateAutoClockOutAt } from "./db";

describe("attendance auto clock-out safeguards", () => {
  it("caps open shifts at 10 PM Pacific for the recorded business date", () => {
    const businessDate = "2026-05-06";
    const clockInAt = Date.parse("2026-05-06T19:00:00.000Z");
    const referenceTime = Date.parse("2026-05-07T07:30:00.000Z");

    const forcedClockOutAt = getEffectiveAttendanceClockOutAt(
      {
        businessDate,
        clockInAt,
        clockOutAt: null,
      },
      referenceTime,
    );

    expect(forcedClockOutAt).toBe(getPacificBusinessDateAutoClockOutAt(businessDate));
    expect(calculateAttendanceHours({ businessDate, clockInAt, clockOutAt: null }, referenceTime)).toBe(10);
  });

  it("keeps an in-progress shift open before the 10 PM Pacific cutoff", () => {
    const businessDate = "2026-05-06";
    const clockInAt = Date.parse("2026-05-06T19:00:00.000Z");
    const referenceTime = Date.parse("2026-05-07T01:30:00.000Z");

    expect(
      getEffectiveAttendanceClockOutAt(
        {
          businessDate,
          clockInAt,
          clockOutAt: null,
        },
        referenceTime,
      ),
    ).toBeNull();
    expect(calculateAttendanceHours({ businessDate, clockInAt, clockOutAt: null }, referenceTime)).toBe(6.5);
  });

  it("preserves explicit clock-out times when a shift is closed normally before 10 PM", () => {
    const businessDate = "2026-05-06";
    const clockInAt = Date.parse("2026-05-06T19:00:00.000Z");
    const clockOutAt = Date.parse("2026-05-07T01:15:00.000Z");

    expect(
      getEffectiveAttendanceClockOutAt({
        businessDate,
        clockInAt,
        clockOutAt,
      }),
    ).toBe(clockOutAt);
    expect(calculateAttendanceHours({ businessDate, clockInAt, clockOutAt })).toBe(6.25);
  });
});
