import { describe, expect, it } from "vitest";

import { getOpeningNapkinsQuestion, groupOpeningQuestionsForPortal } from "./openingSetup";

const openingQuestions = [
  { id: 1, sectionTitle: "Equipment", prompt: "Freezers ON and cold" },
  { id: 2, sectionTitle: "Setup", prompt: "Cups stocked" },
  { id: 3, sectionTitle: "Setup", prompt: "Lids stocked" },
  { id: 4, sectionTitle: "Setup", prompt: "Spoons stocked" },
  { id: 5, sectionTitle: "Setup", prompt: "Napkins stocked" },
  { id: 6, sectionTitle: "Setup", prompt: "Toppings filled" },
] as const;

describe("opening Setup grouping", () => {
  it("finds the napkins Setup question for the counted stock card", () => {
    expect(getOpeningNapkinsQuestion([...openingQuestions])).toEqual(openingQuestions[4]);
  });

  it("keeps a Setup section available while filtering duplicate Setup prompts", () => {
    const grouped = groupOpeningQuestionsForPortal([...openingQuestions], 5);

    expect(grouped.Setup).toEqual([]);
    expect(grouped.Equipment).toEqual([openingQuestions[0]]);
  });

  it("still returns an empty Setup section when the API sends no Setup prompts", () => {
    const grouped = groupOpeningQuestionsForPortal([
      { id: 1, sectionTitle: "Equipment", prompt: "Freezers ON and cold" },
    ]);

    expect(grouped.Setup).toEqual([]);
    expect(grouped.Equipment).toEqual([{ id: 1, sectionTitle: "Equipment", prompt: "Freezers ON and cold" }]);
  });
});
