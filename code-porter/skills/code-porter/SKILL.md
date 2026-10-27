---
name: code-porter
description: Safely ports code to another language, framework, library or major version without changing behavior. Use whenever code moves from one technology to another, even if the user doesn't say "port": language rewrites (Java to Kotlin, JS to TS), framework or library swaps (Provider to Riverpod, Jackson to kotlinx.serialization), or major upgrades (Spring Boot 2 to 3, Java 17 to 21). Not for small single-file edits.
---

# Code Porter

The goal is identical behavior. Code that compiles but behaves differently is the main risk.

1. **Plan.** Create `PORT.md` with the source and target, a map from each dependency to its equivalent (ask me about anything with no clean match), the port order (leaf modules first), and a status per module. Wait for my approval.
2. **Capture behavior.** Before rewriting, write tests against the old code that record what it actually does, edge cases included. Prefer tests that can run against both versions, like HTTP or CLI input/output snapshots.
3. **Port one module at a time.** Write idiomatic target code, not a line-by-line translation. Run the tests and update `PORT.md`.
4. **Verify parity.** Run old and new on the same inputs. Fix every difference, or list it in `PORT.md` as intentional for me to confirm.

Watch for: nulls, integer overflow and division, floats and money, dates and time zones, string encoding, map and sort ordering, error handling, async ordering, serialization (field names, nulls, enums), ORM loading and transactions, and changed config defaults.

Rules:
- Don't edit the old code, and don't delete it until I say so.
- Don't fix bugs during the port. Note them in `PORT.md` and keep the behavior.
- Never delete tests to make them pass.
- Ask before choosing between two reasonable target options.

## Works with
- Before the plan, read `reviews/premortem.md` and `reviews/dead-code.md` if present: risks already found go into `PORT.md`, and code that's already dead doesn't need porting (list it, don't port it).
- Before step 1 of a big port, hand the migration to the premortem agent if it's installed and there's no recent `reviews/premortem.md`.
- Once I say the old code can go, the dead-code-hunter agent can check what's left unused. If the port changed user-facing text, i18n-filler can fill the other languages.
- `PORT.md` is read by devlog-writer, project-switcher and premortem, so keep its status per module current.
