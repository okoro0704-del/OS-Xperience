# Security controls

The foundation validates input and public HTTPS URLs, performs exact origin matching for the channel, requires server-side developer/admin roles, isolates developers to their own applications, uses capability allowlisting, and emits audit events. API CORS is allowlisted by environment. No secret-bearing fields are accepted in manifests and secrets are never logged.

Use secure HTTP-only sessions, CSRF protection, rate limiting, durable audit storage, encrypted configuration, and a hardened outbound verification worker in the deployment phase. Do not treat this in-memory API service as production persistence.

Development authentication uses only the explicitly enabled `X-Xperience-Dev-Actor` header (`DEVELOPER:id` or `ADMIN:id`) and is refused outside development. This header is not a production credential. Production authentication fails closed pending the Trust ID adapter connection.
