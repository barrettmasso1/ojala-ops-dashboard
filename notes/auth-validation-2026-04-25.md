# Auth validation notes

## Published staff login route

- URL checked: `https://ojaladarsh-m6piugsr.manus.space/staff-login`
- The published staff login page loaded successfully and showed the shared-password form.
- Visible actions included Back home, Manager login, the shared staff password field, and the opening-form submit button.

## Published manager login flow from staff page

- Clicking **Manager login** opened Manus OAuth.
- The resulting OAuth URL used:
  - `redirectUri=https://ojaladarsh-m6piugsr.manus.space/api/oauth/callback`
  - `state=aHR0cHM6Ly9vamFsYWRhcnNoLW02cGl1Z3NyLm1hbnVzLnNwYWNlL2FwaS9vYXV0aC9jYWxsYmFjaw==`
- That state decodes to the callback URL only, which reflects the old login-state format rather than the new structured origin-plus-return-path payload.
- This indicates the published site was still serving the pre-fix frontend bundle at the time of the browser check.

## Published staff login submission setup

The published staff login form accepted the configured shared password and left the page ready to submit the **Open opening form** action. This confirmed that the password field was functional on the live site before form submission.

## Published staff login result

Submitting the published shared staff password form succeeded and redirected directly to `/portal/opening` on the live domain. The resulting opening-form view also showed the new visible **Sign out** button in the portal header, confirming that staff now have a direct logout path after sign-in.
