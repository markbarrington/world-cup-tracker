import React from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, GitBranch, Table2 } from "lucide-react";
import data from "./data/worldcup-data.json";
import "./styles.css";

const groups = "ABCDEFGHIJKL".split("");
const DEFAULT_VIEW = "knockout";

const thirdPlaceSlots = {
  "1A": "Winner Group A",
  "1B": "Winner Group B",
  "1D": "Winner Group D",
  "1E": "Winner Group E",
  "1G": "Winner Group G",
  "1I": "Winner Group I",
  "1K": "Winner Group K",
  "1L": "Winner Group L",
};

const roundOf32 = [
  { id: 73, left: "2A", right: "2B" },
  { id: 74, left: "1E", right: "3?" },
  { id: 75, left: "1F", right: "2C" },
  { id: 76, left: "1C", right: "2F" },
  { id: 77, left: "1I", right: "3?" },
  { id: 78, left: "2E", right: "2I" },
  { id: 79, left: "1A", right: "3?" },
  { id: 80, left: "1L", right: "3?" },
  { id: 81, left: "1D", right: "3?" },
  { id: 82, left: "1G", right: "3?" },
  { id: 83, left: "2K", right: "2L" },
  { id: 84, left: "1H", right: "2J" },
  { id: 85, left: "1B", right: "3?" },
  { id: 86, left: "1J", right: "2H" },
  { id: 87, left: "1K", right: "3?" },
  { id: 88, left: "2D", right: "2G" },
];

const bracketPaths = [
  { id: 89, label: "Round of 16 M89", next: "W74 vs W77", matches: [74, 77] },
  { id: 90, label: "Round of 16 M90", next: "W73 vs W75", matches: [73, 75] },
  { id: 93, label: "Round of 16 M93", next: "W83 vs W84", matches: [83, 84] },
  { id: 94, label: "Round of 16 M94", next: "W81 vs W82", matches: [81, 82] },
  { id: 91, label: "Round of 16 M91", next: "W76 vs W78", matches: [76, 78] },
  { id: 92, label: "Round of 16 M92", next: "W79 vs W80", matches: [79, 80] },
  { id: 95, label: "Round of 16 M95", next: "W86 vs W88", matches: [86, 88] },
  { id: 96, label: "Round of 16 M96", next: "W85 vs W87", matches: [85, 87] },
];

const thirdPlaceMatchOrder = {
  74: "1E",
  77: "1I",
  79: "1A",
  80: "1L",
  81: "1D",
  82: "1G",
  85: "1B",
  87: "1K",
};

function pointsFor(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) return 3;
  if (goalsFor === goalsAgainst) return 1;
  return 0;
}

function normalizedImpliedProbabilities(odds) {
  const entries = Object.entries(odds?.implied ?? {}).filter(([, value]) => typeof value === "number");
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return {};
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

function shouldProjectDraw(match) {
  const probabilities = normalizedImpliedProbabilities(match.odds);
  const draw = probabilities.draw ?? 0;
  const favoriteSide = (probabilities.home ?? 0) >= (probabilities.away ?? 0) ? "home" : "away";
  const favorite = probabilities[favoriteSide] ?? 0;
  const spread = Math.abs(Number(match.odds?.spread?.home ?? 0));

  return spread <= 0.5 && draw >= 0.28 && favorite - draw <= 0.12;
}

function projectedScore(match) {
  const [home, away] = match.competitors;
  if (match.status.completed || match.status.state === "in") {
    return {
      home: home.score,
      away: away.score,
      source: match.status.completed ? "final" : "live",
      label: match.status.completed ? "FT" : match.status.detail,
    };
  }

  const favorite = match.odds?.favorite;
  const spread = Math.abs(Number(match.odds?.spread?.home ?? 0));
  const total = Number(match.odds?.overUnder ?? 2.5);
  let winGoals = spread >= 2.5 ? 3 : spread >= 1.5 ? 2 : 1;
  let loseGoals = total >= 3.5 && winGoals >= 2 ? 1 : 0;

  if (favorite === "draw" || shouldProjectDraw(match)) {
    const goals = total >= 3.5 ? 2 : total <= 2 ? 0 : 1;
    return { home: goals, away: goals, source: "projected", label: "ML draw" };
  }

  if (favorite === "away") {
    return {
      home: loseGoals,
      away: winGoals,
      source: "projected",
      label: `${away.abbreviation} ML`,
    };
  }

  return {
    home: winGoals,
    away: loseGoals,
    source: "projected",
    label: `${home.abbreviation} ML`,
  };
}

function headToHeadStats(teamId, tiedIds, matches, mode) {
  const stats = { points: 0, gd: 0, gf: 0 };
  for (const match of matches) {
    const [home, away] = match.competitors;
    if (!tiedIds.includes(home.id) || !tiedIds.includes(away.id)) continue;
    const score = mode === "projected" ? projectedScore(match) : currentScore(match);
    if (!score) continue;
    const isHome = home.id === teamId;
    const gf = isHome ? score.home : score.away;
    const ga = isHome ? score.away : score.home;
    stats.points += pointsFor(gf, ga);
    stats.gd += gf - ga;
    stats.gf += gf;
  }
  return stats;
}

function currentScore(match) {
  if (!match.status.completed && match.status.state !== "in") return null;
  const [home, away] = match.competitors;
  return {
    home: home.score,
    away: away.score,
    source: match.status.completed ? "final" : "live",
    label: match.status.completed ? "FT" : match.status.detail,
  };
}

function groupStageComplete() {
  return data.matches.length === 72 && data.matches.every((match) => match.status.completed);
}

function tableForGroup(group, mode = "current") {
  const matches = data.matches.filter((match) => match.group === group);
  const teams = new Map();

  for (const match of matches) {
    for (const team of match.competitors) {
      teams.set(team.id, {
        ...team,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0,
      });
    }
  }

  for (const match of matches) {
    const score = mode === "projected" ? projectedScore(match) : currentScore(match);
    if (!score) continue;
    const [home, away] = match.competitors;
    const homeRow = teams.get(home.id);
    const awayRow = teams.get(away.id);
    const apply = (row, gf, ga) => {
      row.played += 1;
      row.gf += gf;
      row.ga += ga;
      row.gd = row.gf - row.ga;
      row.points += pointsFor(gf, ga);
      if (gf > ga) row.wins += 1;
      else if (gf === ga) row.draws += 1;
      else row.losses += 1;
    };
    apply(homeRow, score.home, score.away);
    apply(awayRow, score.away, score.home);
  }

  const rows = [...teams.values()];
  const tiedByPoints = new Map();
  for (const row of rows) {
    const key = row.points;
    tiedByPoints.set(key, [...(tiedByPoints.get(key) ?? []), row.id]);
  }

  return rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const tiedIds = tiedByPoints.get(a.points) ?? [];
    if (tiedIds.length > 1) {
      const ah = headToHeadStats(a.id, tiedIds, matches, mode);
      const bh = headToHeadStats(b.id, tiedIds, matches, mode);
      if (bh.points !== ah.points) return bh.points - ah.points;
      if (bh.gd !== ah.gd) return bh.gd - ah.gd;
      if (bh.gf !== ah.gf) return bh.gf - ah.gf;
    }
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });
}

function getQualifiers() {
  const standings = Object.fromEntries(groups.map((group) => [group, tableForGroup(group, "projected")]));
  const thirdRows = groups.map((group) => ({ group, team: standings[group][2] }));
  const thirdRanked = thirdRows.sort((a, b) => {
    const x = a.team;
    const y = b.team;
    if (y.points !== x.points) return y.points - x.points;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    return x.name.localeCompare(y.name);
  });
  const advancingThirds = thirdRanked.slice(0, 8).sort((a, b) => a.group.localeCompare(b.group));
  const rule = data.thirdPlaceRules.find((row) => row.key === advancingThirds.map((row) => row.group).join(""));
  const slots = {};

  for (const group of groups) {
    slots[`1${group}`] = { ...standings[group][0], slot: `1${group}`, kind: "projected" };
    slots[`2${group}`] = { ...standings[group][1], slot: `2${group}`, kind: "projected" };
    slots[`3${group}`] = { ...standings[group][2], slot: `3${group}`, kind: "projected-third" };
  }

  return { standings, thirdRanked, advancingThirds, rule, slots };
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatBracketDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

function TeamName({ team }) {
  return (
    <span className="teamName">
      <img src={team.logo} alt="" />
      <span>{team.shortName}</span>
    </span>
  );
}

function slotDescription(slot) {
  if (!slot) return "";
  const position = slot[0];
  const group = slot.slice(1);
  if (position === "1") return `Group ${group} winner`;
  if (position === "2") return `Group ${group} runner-up`;
  if (position === "3") return `Group ${group} third place`;
  return slot;
}

function GroupCard({ group }) {
  const finalGroups = groupStageComplete();
  const rows = tableForGroup(group, "current");
  const matches = data.matches.filter((match) => match.group === group);
  const completedMatches = matches.filter((match) => match.status.completed).length;

  return (
    <section className="groupCard">
      <div className="groupHeader">
        <h2>Group {group}</h2>
        <span>{completedMatches === 6 ? "Final table" : `${completedMatches}/6 final`}</span>
      </div>
      <table className="standings">
        <thead>
          <tr>
            <th>{finalGroups ? "Final position" : "Team"}</th>
            <th>P</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((team, index) => (
            <tr key={team.id}>
              <td>
                <span className="rank">{index + 1}</span>
                <TeamName team={team} />
              </td>
              <td>{team.played}</td>
              <td>{team.gd > 0 ? `+${team.gd}` : team.gd}</td>
              <td className="pts">{team.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="scores">
        {matches.map((match) => {
          const score = currentScore(match) ?? projectedScore(match);
          const [home, away] = match.competitors;
          return (
            <a className={`scoreRow ${score.source}`} href={match.sourceUrl} target="_blank" rel="noreferrer" key={match.id}>
              <span className="date">{formatTime(match.date)}</span>
              <span className="scoreTeams">
                <span>{home.abbreviation}</span>
                <strong>{score.home}-{score.away}</strong>
                <span>{away.abbreviation}</span>
              </span>
              <span className="scoreStatus">{score.source === "projected" ? "Projected" : "Final"}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function BracketTeam({ slot, team }) {
  return (
    <div className="bracketTeam">
      <span className="slot">{slot}</span>
      <span className="bracketTeamText">
        <TeamName team={team} />
        <small>{slotDescription(slot)}</small>
      </span>
    </div>
  );
}

function KnockoutView() {
  const { thirdRanked, advancingThirds, rule, slots } = getQualifiers();
  const finalGroups = groupStageComplete();
  const advancingKeys = new Set(advancingThirds.map((row) => row.group));
  const matchesById = Object.fromEntries(roundOf32.map((match) => [match.id, match]));

  return (
    <div className="knockoutLayout">
      <aside className="thirdPanel">
        <div className="panelTitle">
          <h2>Third-place cut</h2>
          <span>{finalGroups ? "Final top 8" : "Top 8 projected"}</span>
        </div>
        <ol className="thirdList">
          {thirdRanked.map(({ group, team }, index) => (
            <li className={advancingKeys.has(group) ? "advancing" : ""} key={group}>
              <span>{index + 1}</span>
              <TeamName team={team} />
              <strong>{team.points} pts</strong>
              <small>G{group}</small>
            </li>
          ))}
        </ol>
        <div className="ruleNote">
          <strong>Annex C option {rule?.option ?? "n/a"}</strong>
          <span>{advancingThirds.map((row) => row.group).join(", ")} advance.</span>
        </div>
      </aside>

      <section className="bracketCanvas">
        <div className="bracketHeader">
          <h2>{finalGroups ? "Round of 32" : "Round of 32 projection"}</h2>
          <span>{finalGroups ? "Final bracket slots" : "Grouped in FIFA bracket order"}</span>
        </div>
        <div className="pathGrid">
          {bracketPaths.map((path) => (
            <section className="pathGroup" key={path.id}>
              <div className="pathHeader">
                <span>{path.label}</span>
                <small>{path.next}</small>
              </div>
              {path.matches.map((matchId) => {
                const match = matchesById[matchId];
                const thirdSlot = thirdPlaceMatchOrder[match.id];
                const rightSlot = thirdSlot ? rule?.assignments?.[thirdSlot] : match.right;
                const schedule = data.roundOf32Schedule?.find((item) => item.matchNumber === match.id);
                return (
                  <article className="bracketMatch" key={match.id}>
                    <div className="matchNo">Match {match.id}</div>
                    <BracketTeam slot={match.left} team={slots[match.left]} />
                    <BracketTeam slot={rightSlot} team={slots[rightSlot]} />
                    {schedule ? (
                      <div className="matchMeta">
                        <span>{formatBracketDate(schedule.date)}</span>
                        <span>{schedule.venue}{schedule.city ? ` · ${schedule.city}` : ""}</span>
                      </div>
                    ) : null}
                    {thirdSlot ? (
                      <div className="ruleTag">
                        {thirdPlaceSlots[thirdSlot]} gets {rightSlot} by option {rule?.option}
                      </div>
                    ) : (
                      <div className="ruleTag direct">Fixed runner-up pairing</div>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function App() {
  const [view, setView] = React.useState(DEFAULT_VIEW);
  const latest = data.matches
    .filter((match) => match.status.state === "in" || match.status.completed)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const latestLabel = groupStageComplete() ? "Last group match" : "Last active match";

  return (
    <main className="appShell">
      <header className="topbar">
        <div>
          <h1>World Cup Tables</h1>
          <p>
            Latest snapshot: {new Date(data.generatedAt).toLocaleString()} · {latestLabel}: {latest?.name}
          </p>
        </div>
        <div className="actions">
          <div className="tabs" role="tablist" aria-label="Views">
            <button className={view === "groups" ? "active" : ""} onClick={() => setView("groups")} type="button">
              <Table2 size={16} />
              Groups
            </button>
            <button className={view === "knockout" ? "active" : ""} onClick={() => setView("knockout")} type="button">
              <GitBranch size={16} />
              Knockout
            </button>
          </div>
        </div>
      </header>

      <div className="summaryStrip">
        <div>
          <CalendarDays size={16} />
          <strong>{data.matches.filter((match) => match.status.completed).length}</strong>
          finals
        </div>
        <div>
          <strong>{data.matches.filter((match) => match.status.state === "in").length}</strong>
          live
        </div>
        <div>
          <strong>{data.matches.filter((match) => !match.status.completed && match.status.state !== "in").length}</strong>
          unplayed group matches
        </div>
      </div>

      {view === "groups" ? (
        <div className="groupGrid">
          {groups.map((group) => (
            <GroupCard group={group} key={group} />
          ))}
        </div>
      ) : (
        <KnockoutView />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
