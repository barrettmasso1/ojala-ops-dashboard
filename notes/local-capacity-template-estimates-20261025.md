# Local nominal-capacity template estimates (explicitly provisional)

This does NOT certify four-class accuracy. The original detector/model,
validated reference matcher, owner labels, photos and manual/POS counts are
preserved. An opt-in fallback runs only on dates at/after its configured start,
only for proof-bound cup observations the primary matcher leaves unknown, and
never over an owner decision or a primary non-serving-object veto.

A bottom-anchored body descriptor reduces interference from toppings/spoons.
All reference labels are the owner's prior confirmed labels. The model is stored
privately on the external disk and bound to exact image, annotation, geometry,
camera and detector hashes. No reference images/model files are in this repo.

Four nominal labels are representable: chico/mediano/pint/litro, with abstention.
For well-separated calibration examples the unchanged score cap is 0.28 and
margin 0.04. Sparse classes use tighter near-reference radii <=0.12 and explicitly
carry single_reference_only or near_reference_only. These are unvalidated
few-shot estimates, not calibrated probabilities, not physical volume readings,
not sales, and not a unique-delivery counter. The server requires those flags and
the UI labels them provisional. One supporting template is disclosed, not falsely
reported as two independent observations. No same-scene sample counts as an
independent scene. Reference selection diagnostics are calibration data, not a
held-out generalization result. The method was selected using the same small
reference set; additional independent evaluation is still required.

Software regressions cover old payloads, all four label shapes, wrong-image
proof, unknown/negative objects, label/hash/model tampering, historical gates,
owner precedence, baseline precedence, fallback errors and no data mutation.
Class-specific real accuracy remains unverified. No cloud/LLM/browser invocation
exists in the runtime. No approvals are required per image.
