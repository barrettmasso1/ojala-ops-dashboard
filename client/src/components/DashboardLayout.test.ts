import { describe, expect, it } from "vitest";
import { getVisibleMenuItemsForRole } from "./DashboardLayout";

describe("dashboard layout navigation", () => {
  it("includes dedicated dashboard, inventory, and cookbook entries for admin users", () => {
    const adminItems = getVisibleMenuItemsForRole("admin");

    expect(adminItems.map(item => item.label)).toEqual([
      "Dashboard",
      "Inventory Setup",
      "Cookbook",
      "Employee Portal",
    ]);
    expect(adminItems.find(item => item.label === "Inventory Setup")).toMatchObject({
      path: "/dashboard/inventory",
    });
    expect(adminItems.find(item => item.label === "Cookbook")).toMatchObject({
      path: "/cookbook",
    });
  });

  it("keeps the cookbook entry hidden from employee-only users", () => {
    const employeeItems = getVisibleMenuItemsForRole("user");

    expect(employeeItems.map(item => item.label)).toEqual(["Employee Portal"]);
  });
});
