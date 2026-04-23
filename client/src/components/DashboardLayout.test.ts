import { describe, expect, it } from "vitest";
import { getVisibleMenuItemsForRole } from "./DashboardLayout";

describe("dashboard layout navigation", () => {
  it("includes a dedicated cookbook entry for admin users", () => {
    const adminItems = getVisibleMenuItemsForRole("admin");

    expect(adminItems.map(item => item.label)).toEqual([
      "Dashboard",
      "Cookbook",
      "Employee Portal",
    ]);
    expect(adminItems.find(item => item.label === "Cookbook")).toMatchObject({
      path: "/cookbook",
    });
  });

  it("keeps the cookbook entry hidden from employee-only users", () => {
    const employeeItems = getVisibleMenuItemsForRole("user");

    expect(employeeItems.map(item => item.label)).toEqual(["Employee Portal"]);
  });
});
