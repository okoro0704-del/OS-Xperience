# OS Xperience architecture

OS Xperience is a participation and review layer. It records developer submissions, evidence, declared capabilities, review decisions, publication status, and audit history. It does not execute applications or become their backend.

OS Shell remains the operating and mediation layer: it determines which application handles a human intent. Xperience determines whether an existing application is prepared and allowed to participate. The `ShellRegistryPort` is an integration boundary, not a copied application registry.

LifeOS and mybrandOS remain their own product domains. Trust ID may provide a future safe identity assertion; it does not replace application accounts or supply biometrics. ElfCom remains messaging infrastructure; FundzMan remains financial infrastructure; Sovereign Drive remains storage infrastructure. Xperience declares participation only.

The monorepo additions are `apps/xperience-console`, `api`, `packages/xperience-contract`, and `packages/xperience-sdk`. Domain logic lives in the API, transport-neutral wire contracts in the shared package, and the console is a separate React/Vite surface.
