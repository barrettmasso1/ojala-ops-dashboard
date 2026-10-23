# Real closed-tab test follow-up

The initial automatic-tab recovery unit tests did not model Firefox having a closed
current browsing context. A real test closing ONLY our dedicated relay tab found
that WebDriver rejected creating a new tab until a surviving tab was selected.
The fix switches to an existing window before creating a dedicated replacement,
without closing or navigating that user window. Empty browser handle lists remain
an explicit hold. Cookies and session tokens are never exported. Health now marks
browser/receipt issues attention_required rather than reporting checked alone.

34 Python relay tests pass, including two new closed-context boundary tests.
No camera, model, threshold, production database, physical-count or login changes.
