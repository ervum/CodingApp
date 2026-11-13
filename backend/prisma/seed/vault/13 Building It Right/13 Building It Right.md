# 13 Building It Right

## Luau standards
- `--!strict` at the top of every script and module; typed function signatures.
- Use `task.wait`, `task.spawn` and `task.delay`, never `wait`, `spawn` or `delay`.
- Services through `game:GetService()`; modules live in `ReplicatedStorage.Shared` (shared) and `ServerScriptService` (server-only).
- Clean up every connection (store them in a table, disconnect on destroy).

## Server authority
| The client may… | The server must… |
|---|---|
| request a roll | roll, validate cooldown and currency, save |
| play animations and VFX | decide hits and damage |
| show predicted numbers | own the real numbers |

- Every RemoteEvent handler validates types and ranges and rate-limits per player (default 4 calls/s).
- Never pass prices or rewards from the client.

## Data
- ProfileService-style session locking; save on leave and every 120 s; `pcall` with 3 retries.
- Keys: `player_<userId>`, schema version field, migrations are pure functions.

## Hierarchy
```ascii
ReplicatedStorage/Shared/{Config, Types, Util}
ServerScriptService/{Services/*, Raid/*, Data/*}
StarterPlayerScripts/{Controllers/*, UI/*}
Workspace/{Zones/*, Spawns, Portals}
```

## Review gates
Builder records a SAVED build, then 108 Tester Pass A, Playtest, Reviewer, 108 Tester Pass B, and finally human approval of the PUBLISH item.
