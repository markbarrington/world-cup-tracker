# Qualification Locks Algorithm

This document plans the algorithm for showing qualification certainty on the Groups page.

The goal is to identify two kinds of facts from current match results:

- a team is guaranteed to finish first or second in its group, such as `1A` or `2A`;
- a team is guaranteed not to qualify for the Round of 32 at all.

The algorithm must not use the app's odds-based projected scores for these labels. Projections answer "what is likely"; qualification locks answer "what is still mathematically possible."

## Product Output

Each team row can expose one of these statuses:

- `Locked 1st`: every possible remaining result leaves the team first in its group.
- `Locked 2nd`: every possible remaining result leaves the team second in its group.
- `Eliminated`: no possible remaining result puts the team into the Round of 32.
- `Live lock 1st`, `Live lock 2nd`, or `Live eliminated`: the state would be locked if all currently live scores finished as they stand.
- no badge: the team is still in contention and not mathematically locked.

Do not show `Locked 3rd` or a generic `Qualified` badge. If a team is guaranteed to qualify but could still finish in more than one position, show no badge.

Only show a badge when the proof is conservative and certain. If future score-margin tiebreakers make the result ambiguous, do not show a lock.

Live-contingent badges are not final locks. They should use different wording and styling so a user understands the state can disappear when the live score changes.

## Definitions

A team qualifies for the Round of 32 if it finishes:

1. first in its group;
2. second in its group;
3. third in its group and among the best eight third-place teams across the twelve groups.

The only position locks shown by the UI are `1A` through `1L` and `2A` through `2L`.

Third-place qualification is separate from third-place bracket placement. The static FIFA third-place table in `src/data/third-place-rules.js` determines which Round of 32 slot an advancing third-place team enters after the best eight third-place groups are known.

## Core Principle

Build a proof engine that enumerates possible remaining match outcomes, not predicted scores.

For each unplayed or live group match, enumerate the three possible result classes:

- home win;
- draw;
- away win.

Completed matches use their actual score.

Live matches should be treated as not final until ESPN marks them completed. A live score is useful for display, but it is not a mathematical lock unless the match is final.

For live-contingent display, run a separate pass that treats live matches as frozen at their current score and keeps unplayed matches as W/D/L enumerations. That pass answers "what would be locked if the live score held?" without weakening the final-only proof.

## Tiebreaker Conservatism

Future scorelines affect goal difference, goals scored, and some head-to-head tiebreakers. Because the ESPN schedule does not constrain future score margins, the first implementation should be conservative:

1. Use points to prove locks wherever possible.
2. Use head-to-head points when the tied teams' W/D/L outcomes are known from completed matches or from the enumerated remaining-result pattern.
3. If a possible final state depends on future goal difference, future goals scored, fair play, or drawing lots, mark the affected ranks as unresolved.

This means the app may sometimes omit a badge even when a human could infer likely qualification. That is acceptable. A false certainty badge is not acceptable.

## Group Enumeration

For each group:

1. Collect its six matches from `data.matches`.
2. Split them into completed and remaining matches.
3. Enumerate every combination of result classes for the remaining matches.
   - At the start of a group, this is `3^6 = 729` combinations.
   - Across all twelve groups, this is still small if evaluated group-by-group.
4. For each combination, calculate final points for all four teams.
5. Derive possible ranks for each team.

The rank derivation should return a set of possible positions, not a single position.

Example:

```js
{
  teamId: "660",
  possibleGroupRanks: new Set([1]),
  possibleSlots: new Set(["1A"])
}
```

If points alone creates a tied block, use score-independent head-to-head points to split the block when possible. Every unresolved sub-block keeps all ranks inside that sub-block possible.

Example:

```text
Team A: 6 pts
Team B: 4 pts
Team C: 4 pts
Team D: 0 pts
```

Teams B and C both have possible ranks `{2, 3}` until the proof engine can safely resolve their tiebreaker from head-to-head points.

## Group Position Locks

After evaluating every possible final state for a group:

1. Union each team's possible group ranks across all enumerated states.
2. If the union is exactly `{1}`, the team is locked as group winner.
3. If the union is exactly `{2}`, the team is locked as group runner-up.
4. If the union is `{3}`, `{4}`, or contains multiple ranks, no position lock is shown.

This catches cases like a team that must finish top regardless of all remaining results.

Do not add a generic `Qualified` badge for a team whose possible ranks are `{1, 2}`. That team is guaranteed to qualify, but it is not locked into one of the two displayed positions.

## Live-Contingent Locks

Live-contingent locks should be calculated by reusing the same proof engine with one parameter:

```js
analyzeQualificationLocks({ liveMode: "final-only" });
analyzeQualificationLocks({ liveMode: "current-score" });
```

The modes differ only in how they treat live matches:

- `final-only`: live matches are still enumerated as home win, draw, or away win.
- `current-score`: live matches are treated like completed matches using the current ESPN score.

Unplayed matches remain enumerated as home win, draw, or away win in both modes.

The UI should prefer final locks over live-contingent locks:

1. If final-only status is `locked-first`, show `Locked 1st`.
2. If final-only status is `locked-second`, show `Locked 2nd`.
3. If final-only status is `eliminated`, show `Eliminated`.
4. Otherwise, if current-score status is `locked-first`, show `Live lock 1st`.
5. Otherwise, if current-score status is `locked-second`, show `Live lock 2nd`.
6. Otherwise, if current-score status is `eliminated`, show `Live eliminated`.
7. Otherwise, show no badge.

This keeps permanent certainty and live drama visible at the same time without conflating them.

Example:

```text
Team A is not yet locked because a live match is still in progress.
At the current score, Team A would be locked first.
Show: Live lock 1st
```

If the live score changes and Team A is no longer locked in the current-score pass, remove the live badge on the next refresh.

## Elimination From Top Two

A team cannot qualify directly if none of its possible group ranks include `1` or `2`.

This does not automatically mean the team is eliminated, because third-place qualification may still be possible.

## Third-Place Qualification

Third-place qualification requires comparing the final third-place team from each group.

A naive global enumeration of all groups would be too large:

```text
729^12
```

Instead, keep each group independent and compare possible third-place records.

For each group, produce a compact set of possible third-place outcomes:

```js
{
  group: "A",
  teamId: "660",
  points: 4,
  gdStatus: "known" | "unbounded",
  gfStatus: "known" | "unbounded"
}
```

For the conservative first implementation, third-place elimination should rely on points unless score-based tiebreakers are already final and safe.

## Proving Third-Place Elimination

For a target team that can still finish third:

1. List every possible third-place outcome for the target team.
2. For each target outcome, inspect every other group.
3. Mark another group as `forced ahead` only if every possible third-place outcome in that other group ranks ahead of the target outcome under score-independent criteria.
4. If at least eight other groups are forced ahead for every possible target third-place outcome, the target team cannot finish in the best eight third-place teams.
5. If the team also cannot finish first or second, show `Eliminated`.

This avoids global enumeration while still proving impossibility.

Important detail: ties should not count as `forced ahead` unless the tiebreaker is already known from final results. If a tied third-place comparison could depend on future goal difference, future goals scored, fair play, or drawing lots, treat that other group as not forced ahead.

## Suggested Data Structures

Add a qualification-analysis layer near the existing ranking helpers in `src/static-app.js`.

Recommended functions:

```js
function analyzeQualificationLocks() {}
function analyzeGroupPossibilities(group) {}
function enumerateRemainingOutcomes(matches) {}
function applyOutcomePattern(matches, pattern) {}
function possibleRanksFromPointsAndSafeTiebreakers(rows, matches) {}
function compareThirdPlaceCertainty(target, challenger) {}
```

The top-level result should be keyed by team id:

```js
{
  [teamId]: {
    group: "A",
    possibleGroupRanks: [1],
    possibleSlots: ["1A"],
    lockedSlot: "1A",
    directQualification: "locked-first" | "locked-second" | "possible" | "impossible",
    thirdPlaceQualification: "possible" | "impossible",
    finalStatus: "locked-first" | "locked-second" | "eliminated" | "open",
    label: "Locked 1st"
  }
}
```

For live display, keep both analyses available:

```js
{
  final: analyzeQualificationLocks({ liveMode: "final-only" }),
  currentScore: analyzeQualificationLocks({ liveMode: "current-score" }),
  display: {
    [teamId]: {
      finalStatus: "locked-first" | "locked-second" | "eliminated" | "open",
      liveStatus: "locked-first" | "locked-second" | "eliminated" | "open",
      displayStatus: "locked-first" | "locked-second" | "eliminated" | "live-locked-first" | "live-locked-second" | "live-eliminated" | "open",
      label: "Live lock 1st"
    }
  }
}
```

## Integration With Current App

The active app is `src/static-app.js`. The qualification proof should use the same `data.matches` payload as:

- `tableForGroup()`;
- `getQualifiers()`;
- `renderGroups()`;
- `renderKnockout()`.

Do not use `projectedScore()` inside the proof engine. It is for display projections only.

The Groups view can render the status in each standings row:

```html
<span class="qualificationBadge eliminated">Eliminated</span>
```

Suggested badge placement: inside the team cell after `teamName(team)`, because that keeps it visible without adding more numeric columns.

## Groups Page Display

The Groups page should make locked and eliminated states visible without adding another standings column.

Recommended treatment:

- Locked first and locked second rows get a bounded highlight around the team row.
- Eliminated rows are visually muted and grayed out.
- Live-contingent rows get a temporary/pulsing or dashed highlight and a `Live` badge.
- Open rows keep the existing styling.

Suggested markup:

```html
<tr class="qualificationRow locked-first">
  <td>
    <span class="rank">1</span>
    <span class="teamName">...</span>
    <span class="qualificationBadge locked">Locked 1st</span>
  </td>
  <td>...</td>
</tr>

<tr class="qualificationRow eliminated">
  <td>
    <span class="rank">4</span>
    <span class="teamName">...</span>
    <span class="qualificationBadge eliminated">Eliminated</span>
  </td>
  <td>...</td>
</tr>
```

Styling intent:

- `locked-first` and `locked-second`: use a clear outline or inset border around the full row, with a restrained accent color and a small `Locked 1st` or `Locked 2nd` badge.
- `eliminated`: reduce text contrast, desaturate the crest if practical, and use an `Eliminated` badge with a neutral gray treatment.
- `live-locked-first` and `live-locked-second`: use a dashed or subtly animated border, a warmer live accent, and badge text like `Live lock 1st`.
- `live-eliminated`: use muted row styling, but lighter than final elimination, with badge text `Live eliminated`.
- Avoid changing row height significantly. The standings table should not jump when badges appear after refresh.

Table rows can be awkward to outline consistently across browsers. If direct `tr` outlines are unreliable, apply the border treatment to each cell:

```css
.qualificationRow.locked-first td,
.qualificationRow.locked-second td {
  border-block: 1px solid var(--lock-border);
}

.qualificationRow.locked-first td:first-child,
.qualificationRow.locked-second td:first-child {
  border-left: 1px solid var(--lock-border);
  border-radius: 6px 0 0 6px;
}

.qualificationRow.locked-first td:last-child,
.qualificationRow.locked-second td:last-child {
  border-right: 1px solid var(--lock-border);
  border-radius: 0 6px 6px 0;
}
```

## Bracket Page Display

Locked first and second teams should also appear as locked facts on the Knockout page.

The existing bracket can continue to render projected slots for every Round of 32 match. The change is that any team with final or live-contingent first/second status should be styled differently from an odds projection.

Example:

- If a team is locked first in Group A, it owns slot `1A`.
- The `roundOf32` definition already maps slot `1A` to Match 79.
- The bracket card for Match 79 should show that team in the `1A` line with a locked treatment.

For first-place and second-place locks, the slot-to-match mapping is deterministic from `roundOf32`:

```js
const lockedSlotsByName = {
  "1A": { team, status: "locked-first" },
  "2A": { team, status: "locked-second" }
};
```

When rendering a bracket team:

1. Resolve the slot normally.
2. Check whether `final.locksBySlot[slot]` exists.
3. If it exists, render that locked team and add a `lockedSlot` class.
4. Otherwise check whether `currentScore.locksBySlot[slot]` exists.
5. If it exists, render that team and add a `liveLockedSlot` class.
6. If neither exists, render the existing projected team and keep the projected styling.

Suggested bracket markup:

```html
<div class="bracketTeam lockedSlot">
  <span class="slot">1A</span>
  <span class="bracketTeamText">
    <span class="teamName">USA</span>
    <small>Locked Group A winner</small>
  </span>
</div>
```

Suggested live-contingent bracket markup:

```html
<div class="bracketTeam liveLockedSlot">
  <span class="slot">1A</span>
  <span class="bracketTeamText">
    <span class="teamName">USA</span>
    <small>Live: would be Group A winner</small>
  </span>
</div>
```

Third-place slots should remain projected for now. Because the UI does not show `Locked 3rd`, the bracket should not mark any `3A`-style slot as locked.

Eliminated teams should not receive special treatment on the bracket page unless they appear in the odds-based projection due to stale or contradictory data. If that happens, prefer suppressing the eliminated team from projected bracket slots rather than showing a grayed-out eliminated team in a knockout fixture.

## Testing Plan

Add targeted fixture tests before wiring the UI:

1. A group where one team has enough points to be guaranteed first.
2. A group where one team has enough points and tiebreaker certainty to be guaranteed second.
3. A group where a team can finish third but cannot make the best eight third-place teams because eight other groups are forced ahead on points.
4. A tied-points scenario where future goal difference could decide the order; expect no lock.
5. A completed tied-points scenario where final head-to-head results safely resolve the order.
6. A team with possible ranks `{1, 2}`; expect no badge because generic qualification is intentionally not displayed.
7. A locked first-place team appears in the correct Round of 32 bracket slot with locked styling.
8. A locked second-place team appears in the correct Round of 32 bracket slot with locked styling.
9. An eliminated team is grayed out on the Groups page and does not appear as a locked bracket team.
10. A live score creates `Live lock 1st` while the final-only pass remains open.
11. A live score creates `Live eliminated` while the final-only pass remains open.
12. A final lock always overrides a live-contingent lock for the same team and slot.
13. Changing the live score removes stale live-contingent badges on the next refresh.

The tests should verify labels, not just raw rank sets.

## Implementation Order

1. Extract side-effect-free helpers for current group ranking inputs if needed.
2. Add group outcome enumeration and possible-rank calculation.
3. Add exact-position locks for first and second only.
4. Add third-place elimination proof.
5. Render bounded locked rows and grayed eliminated rows in `renderGroups()`.
6. Add locked-slot styling to `renderKnockout()`.
7. Add a current-score live-contingent pass.
8. Render live-contingent row and bracket states with separate labels and styling.
9. Run `npm run prepare:pages` and a browser smoke check against `site/`.

## Non-Goals

- Do not replace the current projected bracket.
- Do not make odds part of qualification certainty.
- Do not call FIFA, Wikipedia, or ESPN more often.
- Do not claim certainty based on fixture simulations with arbitrary scorelines.
- Do not label live-contingent states as final locks.
