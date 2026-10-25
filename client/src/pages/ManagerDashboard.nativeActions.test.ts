import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nativePhotoEvidenceLabel } from "./ManagerDashboard";

type Status = "pending_review" | "approved_by_ai" | "discarded" | "approved_by_manager" | "discarded_by_manager";

function ReviewCardFixture({ sourceDetail, status, automaticValidation }: {
  sourceDetail: string | null;
  status: Status;
  automaticValidation?: { status?: string } | null;
}) {
  const nativeLabel = nativePhotoEvidenceLabel(sourceDetail, status, automaticValidation);
  const canReview = !nativeLabel && (status === "pending_review" || status === "approved_by_ai" || status === "discarded");
  return React.createElement(
    "article",
    null,
    React.createElement("p", null, nativeLabel?.status ?? "Legacy manual evidence"),
    canReview ? React.createElement(React.Fragment, null, React.createElement("button", null, "Approve evidence"), React.createElement("button", null, "Discard evidence")) : null,
  );
}

describe("native local evidence review actions", () => {
  it("does not request human approval for a verified native local-CV fixture", () => {
    const html = renderToStaticMarkup(React.createElement(ReviewCardFixture, {
      sourceDetail: "native_local_cv_only_v1:fixture-observation",
      status: "approved_by_ai",
      automaticValidation: { status: "verified" },
    }));
    expect(html).toContain("verificada automáticamente por CV local");
    expect(html).toContain("no requiere aprobación humana");
    expect(html).not.toContain("Approve evidence");
    expect(html).not.toContain("Discard evidence");
  });

  it("keeps review controls available for a historical non-native manual fixture", () => {
    const html = renderToStaticMarkup(React.createElement(ReviewCardFixture, {
      sourceDetail: "verified_snapshot",
      status: "pending_review",
      automaticValidation: null,
    }));
    expect(html).toContain("Legacy manual evidence");
    expect(html).toContain("Approve evidence");
    expect(html).toContain("Discard evidence");
  });
});
