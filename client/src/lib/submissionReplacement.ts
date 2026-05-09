export type SubmissionViewKey = "opening" | "closing" | "inventory";

export function getResubmissionReplacementDescription(view: SubmissionViewKey, t: (value: string) => string = value => value) {
  return view === "opening"
    ? t("Submitting again for this business date replaces the previous opening record instead of adding a duplicate.")
    : view === "closing"
      ? t("Submitting again for this business date replaces the previous closing record instead of adding a duplicate.")
      : t("Saving this business-date inventory again replaces the prior inventory review record instead of duplicating it.");
}

export function getReplacementConfirmationMessage(view: SubmissionViewKey, t: (value: string) => string = value => value) {
  const message = view === "opening"
    ? t("An opening submission already exists for this business date. Do you want to replace it with this new opening form?")
    : view === "closing"
      ? t("A closing submission already exists for this business date. Do you want to replace it with this new closing form?")
      : t("An inventory submission already exists for this business date. Do you want to replace it with this new inventory form?");

  return `${t("Replace existing submission?")}\n\n${message}`;
}
