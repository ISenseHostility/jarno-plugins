---
name: design-debate
description: Runs a debate between two Claudes on a design decision, where a second headless Claude argues the strongest case for the opposite approach. Use this whenever the user faces a real architecture or design choice with more than one reasonable option, such as choosing between libraries, data models, state management, sync strategies, monolith vs split, SQL vs NoSQL, or REST vs WebSockets, or when they ask "should I use X or Y", "what's the best way to structure this", or "debate this". Also use it when you're about to make a hard-to-reverse design decision on your own. Not for small choices that are easy to change later.
---

# Design Debate

Before a hard-to-reverse design choice, have a second Claude argue against your preferred approach, so the user sees both sides at their strongest before deciding.

## Steps

1. **Frame the decision.** Read the relevant code. Write down the question in one sentence, the constraints (stack, scale, team size, deadlines), and the two main options. Say which one you lean toward. That's **Side A**.

2. **Summon the opponent.** Run a second, headless Claude that argues for **Side B**:
   ```
   claude -p "<prompt>" --allowedTools "Read,Grep,Glob" --output-format text < /dev/null
   ```
   The `< /dev/null` stops it from waiting 3 seconds for piped input. Its prompt should include the question, the constraints and both options, and instruct it to:
   - argue the strongest honest case for Side B, specific to this codebase (it may read files)
   - attack the weakest points of Side A
   - name the situations where Side B clearly wins
   - stay under 250 words and not edit anything

3. **Write your own case** for Side A with the same rules and length, without softening it after reading the opponent.

4. **One rebuttal round.** Each side gets 2–3 sentences responding to the other's best point. For the opponent's rebuttal, run `claude -p` again the same way with both cases included.

5. **Show it side by side:**

   | | Side A: <name> | Side B: <name> |
   |---|---|---|
   | Core argument | | |
   | Best for | | |
   | Biggest risk | | |
   | Cost to switch later | | |
   | Rebuttal | | |

   Under the table, add:
   - **Where they agree**: facts both sides accept
   - **The deciding question**: the one thing about the user's situation that should decide this, for example "Will this ever need offline support?"

6. **Stop and let the user decide.** Don't pick for them unless they ask. Don't implement anything until they choose.

## Rules
- Both sides argue in good faith. No strawmen, and no "Side B is fine but…"
- If there are really three options, run the opponent once per extra option.
- If the opponent's arguments are weak or generic, rerun it once with "be more specific to this codebase."
- If `claude -p` fails, say so and argue Side B yourself, clearly labeled as such.
