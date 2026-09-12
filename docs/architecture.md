# OS Xperience architecture

OS Xperience is a participation and review layer. It records developer submissions, evidence, declared capabilities, review decisions, publication status, and audit history. It does not execute applications or become their backend.

OS Shell remains the operating and mediation layer: it determines which application handles a human intent. Xperience determines whether an existing application is prepared and allowed to participate. The `ShellRegistryPort` is an integration boundary, not a copied application registry.

LifeOS and mybrandOS remain their own product domains. Trust ID may provide a future safe identity assertion; it does not replace application accounts or supply biometrics. ElfCom remains messaging infrastructure; FundzMan remains financial infrastructure; Sovereign Drive remains storage infrastructure. Xperience declares participation only.

The monorepo additions are `apps/xperience-console`, `api`, `packages/xperience-contract`, and `packages/xperience-sdk`. Domain logic lives in the API, transport-neutral wire contracts in the shared package, and the console is a separate React/Vite surface.

## Persistence and identity

`api/prisma/schema.prisma` and its initial SQL migration define PostgreSQL durable records. `ApplicationRepository` is the persistence seam: `PrismaApplicationRepository` is for configured production infrastructure, while the memory implementation is an **explicit** test/dev adapter (`XPERIENCE_REPOSITORY=memory`) and is forbidden in production. Route handlers never call Prisma directly. The API fails closed when persistence is required but `DATABASE_URL` is missing.

Developer and admin consoles are API-backed: they read and mutate server state through the shared contract/SDK. Review transitions and audit events are authoritative on the server. `APPROVED` does not auto-publish; capability approval is not runtime authorization.

Authentication is a provider boundary. Production resolves through the Trust ID-compatible provider and fails closed until that provider is connected. The development adapter is available only with both `NODE_ENV=development` and `XPERIENCE_DEV_AUTH=true`; it is not an identity system and never proves application control.
