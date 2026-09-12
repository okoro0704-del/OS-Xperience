# Review lifecycle

`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → PUBLISHED` is the normal route. Reviewers may request changes; applications can be suspended or revoked under explicit transition rules. `APPROVED` is not `PUBLISHED`—publication is a separate admin action and never follows automatically from approval. Every consequential state action is attributable in the audit log. Capability review (`REQUESTED` → `APPROVED` | `REJECTED` | `REQUIRES_CHANGES`) is a declaration decision only; it does not authorize runtime access.
