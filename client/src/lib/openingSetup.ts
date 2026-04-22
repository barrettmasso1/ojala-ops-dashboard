export type OpeningSetupChecklistQuestion = {
  id: number;
  sectionTitle: string;
  prompt: string;
};

const hiddenSetupPrompts = new Set(["Cups stocked", "Lids stocked", "Spoons stocked", "Toppings filled"]);

export function getOpeningNapkinsQuestion<T extends OpeningSetupChecklistQuestion>(questions: T[]) {
  return questions.find(question => question.sectionTitle === "Setup" && question.prompt === "Napkins stocked");
}

export function groupOpeningQuestionsForPortal<T extends OpeningSetupChecklistQuestion>(
  questions: T[],
  napkinsQuestionId?: number | null,
) {
  const grouped = questions.reduce<Record<string, T[]>>((acc, question) => {
    if (question.id === napkinsQuestionId) {
      return acc;
    }
    if (question.sectionTitle === "Setup" && hiddenSetupPrompts.has(question.prompt)) {
      return acc;
    }
    acc[question.sectionTitle] = [...(acc[question.sectionTitle] ?? []), question];
    return acc;
  }, {});

  grouped.Setup = grouped.Setup ?? [];
  return grouped;
}
