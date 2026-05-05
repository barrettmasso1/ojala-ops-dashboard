import { describe, expect, it } from "vitest";
import { getVisibleMenuItemsForRole } from "./DashboardLayout";

describe("dashboard layout navigation", () => {
  it("includes dedicated dashboard, time book, setup, cookbook, and history entries for admin users", () => {
    const adminItems = getVisibleMenuItemsForRole("admin");

    expect(adminItems.map(item => item.label)).toEqual([
      "Dashboard",
      "Time Book",
      "Inventory Setup",
      "Cookbook",
      "Form Setup",
      "History",
      "Employee Portal",
    ]);
    expect(adminItems.find(item => item.label === "Time Book")).toMatchObject({
      path: "/dashboard/time-book",
    });
    expect(adminItems.find(item => item.label === "Inventory Setup")).toMatchObject({
      path: "/dashboard/inventory",
    });
    expect(adminItems.find(item => item.label === "Cookbook")).toMatchObject({
      path: "/cookbook",
    });
    expect(adminItems.find(item => item.label === "Form Setup")).toMatchObject({
      path: "/dashboard/forms",
    });
    expect(adminItems.find(item => item.label === "History")).toMatchObject({
      path: "/dashboard/history",
    });
  });

  it("keeps the cookbook entry hidden from employee-only users", () => {
    const employeeItems = getVisibleMenuItemsForRole("user");

    expect(employeeItems.map(item => item.label)).toEqual(["Employee Portal"]);
  });
});
