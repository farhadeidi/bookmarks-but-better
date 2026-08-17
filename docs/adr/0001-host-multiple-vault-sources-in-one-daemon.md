---
status: accepted
---

# Host multiple Vault sources in one daemon

One daemon process may host one or more independently identified Vaults through one loopback connection. Each Vault is a top-level Bookmark Source with vault-scoped operations; Vaults are never merged, nested beneath a generic Daemon Source, or switched globally for every connected client.

Vaults are configured at daemon startup, and startup fails atomically if any configured Vault cannot be validated, locked, or opened. Authentication applies to the daemon connection and therefore grants access to every Vault it exposes; finer-grained authorization is deferred until a concrete need exists.

## Considered Options

- One daemon process per Vault was rejected because it multiplies ports, installed services, connection setup, and operational failure points.
- A second Vault selector beneath one Daemon Source was rejected because the Vault is the actual bookmark collection and therefore the source users act on.
- A process-wide active Vault was rejected because one client's selection would affect other clients and create cross-request races.

## Consequences

The daemon interface must identify the target Vault on every vault-specific operation and expose Vault discovery. Legacy unscoped operations remain valid only when exactly one Vault is hosted; multi-Vault clients must select a Vault explicitly.
