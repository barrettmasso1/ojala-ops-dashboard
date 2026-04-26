import { describe, expect, it } from "vitest";
import { getVisibleMenuItemsForRole } from "./DashboardLayout";

describe("dashboard layout navigation", () => {
  it("includes dedicated dashboard, setup, cookbook, and analysis entries for admin users", () => {
    const adminItems = getVisibleMenuItemsForRole("admin");

    expect(adminItems.map(item => item.label)).toEqual([
      "Dashboard",
      "Inventory Setup",
      "Cookbook",
      "Form Setup",
      "History & Notes",
      "Employee Portal",
    ]);
    expect(adminItems.find(item => item.label === "Inventory Setup")).toMatchObject({
      path: "/dashboard/inventory",
    });
    expect(adminItems.find(item => item.label === "Cookbook")).toMatchObject({
      path: "/cookbook",
    });
    expect(adminItems.find(item => item.label === "Form Setup")).toMatchObject({
      path: "/dashboard/forms",
    });
    expect(adminItems.find(item => item.label === "History & Notes")).toMatchObject({
      path: "/dashboard/analysis",
    });
  });

  it("keeps the cookbook entry hidden from employee-only users", () => {
    const employeeItems = getVisibleMenuItemsForRole("user");

    expect(employeeItems.map(item => item.label)).toEqual(["Employee Portal"]);
  });
});
