# Corrected camera-input diagnosis

The user confirms the SSD replacement part was purchased; installation is not
inferred from that statement. Existing transport receipts remain intact.

Debugging corrected two mistakes in the earlier camera preview test: the API
redacts the RTSP credential, and the installed FFmpeg rejected rw_timeout for
this input. Using the existing private camera configuration (without printing
its credentials) authenticated the two discovered cameras. Their real images
are the terrace and side counter, not the historical front handoff view. The
production camera was not substituted. Temporary diagnostic routes were removed.
The configured handoff source is still unavailable; no recovered live feed is
claimed and no unrelated camera is used to fill the dashboard.

This source change fixes metadata health after restart: the last stored frame
is retained, while a new valid frame from the current session is still required
to claim receiving. History is not live evidence. All 14,256 existing frame rows
were compared and preserved. 32 regression tests passed. No model, threshold,
manual label, camera configuration, sales or photo queue changed.
