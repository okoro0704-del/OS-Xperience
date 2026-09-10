# Verification

Evidence adapters are modeled generically: `DOMAIN`, `WELL_KNOWN_ENDPOINT`, `GITHUB`, `DEPLOYMENT_PROVIDER`, and `XPERIENCE_ENDPOINT`. Evidence is reviewed and attempts are retained. A production verification worker must resolve DNS safely, block private/reserved address space after resolution and redirect, bound redirects/timeouts, and never fetch arbitrary internal endpoints. Evidence proves control, not ownership transfer or internal access.

`VerificationService` currently exposes these adapters as honest `UNAVAILABLE` states until a provider-specific hardened worker is connected. It rejects unsafe URL schemes, credentials, localhost, common private networks, link-local addresses, and `.local` hosts before an adapter is invoked. It is not a generic URL fetcher.
