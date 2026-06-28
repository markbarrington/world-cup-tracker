import { mkdir, writeFile } from "node:fs/promises";

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const THIRD_PLACE_TEMPLATE =
  "https://en.wikipedia.org/w/api.php?action=parse&page=Template:2026_FIFA_World_Cup_third-place_table&prop=wikitext&format=json&formatversion=2";

const groupStart = new Date("2026-06-11T00:00:00Z");
const groupEnd = new Date("2026-06-27T00:00:00Z");
const roundOf32Start = new Date("2026-06-28T00:00:00Z");
const roundOf32End = new Date("2026-07-04T00:00:00Z");

const roundOf32SlotMap = {
  "2A-2B": 73,
  "1E-3RD": 74,
  "1F-2C": 75,
  "1C-2F": 76,
  "1I-3RD": 77,
  "2E-2I": 78,
  "1A-3RD": 79,
  "1L-3RD": 80,
  "1D-3RD": 81,
  "1G-3RD": 82,
  "2K-2L": 83,
  "1H-2J": 84,
  "1B-3RD": 85,
  "1J-2H": 86,
  "1K-3RD": 87,
  "2D-2G": 88,
};

function ymd(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function parseAmericanOdds(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const normalized = Number(value.replace(/[^\d+-]/g, ""));
  return Number.isFinite(normalized) ? normalized : null;
}

function americanToProbability(value) {
  const odds = parseAmericanOdds(value);
  if (odds === null) return null;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function cleanOdds(odds) {
  const raw = odds?.moneyline;
  if (!raw) return null;

  const moneyline = {
    home: raw.home?.close?.odds ?? raw.home?.open?.odds ?? null,
    draw: raw.draw?.close?.odds ?? raw.draw?.open?.odds ?? null,
    away: raw.away?.close?.odds ?? raw.away?.open?.odds ?? null,
  };

  const implied = Object.fromEntries(
    Object.entries(moneyline).map(([key, value]) => [key, americanToProbability(value)]),
  );

  const favorite = Object.entries(implied)
    .filter(([, value]) => value !== null)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    provider: odds.provider?.name ?? "Odds",
    moneyline,
    implied,
    favorite,
    overUnder: odds.overUnder ?? null,
    spread: {
      home: odds.pointSpread?.home?.close?.line ?? odds.pointSpread?.home?.open?.line ?? null,
      away: odds.pointSpread?.away?.close?.line ?? odds.pointSpread?.away?.open?.line ?? null,
    },
  };
}

function pointsFor(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) return 3;
  if (goalsFor === goalsAgainst) return 1;
  return 0;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "world-cup-tracker/0.1",
      accept: "application/json,text/plain,*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${url}`);
  }
  return response.json();
}

function normalizeEvent(event) {
  const competition = event.competitions?.[0];
  const group = competition?.altGameNote?.match(/Group ([A-L])/)?.[1];
  if (!group || event.season?.slug !== "group-stage") return null;

  return {
    id: event.id,
    date: event.date,
    group,
    name: event.name,
    venue: competition?.venue?.fullName ?? event.venue?.displayName ?? "",
    status: {
      state: competition?.status?.type?.state ?? event.status?.type?.state ?? "pre",
      description: competition?.status?.type?.description ?? event.status?.type?.description ?? "",
      detail: competition?.status?.type?.shortDetail ?? competition?.status?.displayClock ?? "",
      completed: Boolean(competition?.status?.type?.completed),
    },
    competitors: competition.competitors.map((competitor) => ({
      id: competitor.team.id,
      name: competitor.team.displayName,
      shortName: competitor.team.shortDisplayName,
      abbreviation: competitor.team.abbreviation,
      logo: competitor.team.logo,
      color: competitor.team.color ? `#${competitor.team.color}` : "#111827",
      homeAway: competitor.homeAway,
      score: Number(competitor.score ?? 0),
      winner: competitor.winner ?? false,
    })),
    odds: cleanOdds(competition.odds?.find(Boolean)),
    sourceUrl: event.links?.find((link) => link.rel?.includes("summary"))?.href ?? "",
  };
}

async function fetchScoreboardRange(start, end) {
  const events = [];
  const byId = new Map();
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = ymd(cursor);
    const data = await fetchJson(`${ESPN_SCOREBOARD}?limit=100&dates=${date}`);
    for (const event of data.events ?? []) {
      byId.set(event.id, event);
    }
  }
  events.push(...byId.values());
  return events.sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function fetchMatches() {
  const byId = new Map();
  for (const event of await fetchScoreboardRange(groupStart, groupEnd)) {
    const normalized = normalizeEvent(event);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function teamGroupsFromMatches(matches) {
  const teamGroups = new Map();
  matches.forEach((match) => {
    match.competitors.forEach((team) => {
      if (team.abbreviation) teamGroups.set(team.abbreviation, match.group);
    });
  });
  return teamGroups;
}

function headToHeadStats(teamId, tiedIds, matches) {
  const stats = { points: 0, gd: 0, gf: 0 };
  for (const match of matches) {
    const [home, away] = match.competitors;
    if (!tiedIds.includes(home.id) || !tiedIds.includes(away.id)) continue;
    const isHome = home.id === teamId;
    const gf = isHome ? home.score : away.score;
    const ga = isHome ? away.score : home.score;
    stats.points += pointsFor(gf, ga);
    stats.gd += gf - ga;
    stats.gf += gf;
  }
  return stats;
}

function tableForFinalGroup(matches, group) {
  const groupMatches = matches.filter((match) => match.group === group);
  const teams = new Map();

  for (const match of groupMatches) {
    for (const team of match.competitors) {
      teams.set(team.id, {
        ...team,
        played: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0,
      });
    }
  }

  for (const match of groupMatches) {
    const [home, away] = match.competitors;
    const apply = (row, gf, ga) => {
      row.played += 1;
      row.gf += gf;
      row.ga += ga;
      row.gd = row.gf - row.ga;
      row.points += pointsFor(gf, ga);
    };
    apply(teams.get(home.id), home.score, away.score);
    apply(teams.get(away.id), away.score, home.score);
  }

  const rows = [...teams.values()];
  const tiedByPoints = new Map();
  for (const row of rows) {
    tiedByPoints.set(row.points, [...(tiedByPoints.get(row.points) ?? []), row.id]);
  }

  return rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const tiedIds = tiedByPoints.get(a.points) ?? [];
    if (tiedIds.length > 1) {
      const ah = headToHeadStats(a.id, tiedIds, groupMatches);
      const bh = headToHeadStats(b.id, tiedIds, groupMatches);
      if (bh.points !== ah.points) return bh.points - ah.points;
      if (bh.gd !== ah.gd) return bh.gd - ah.gd;
      if (bh.gf !== ah.gf) return bh.gf - ah.gf;
    }
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });
}

function teamSlotsFromFinalStandings(matches) {
  const groups = "ABCDEFGHIJKL".split("");
  const allGroupsFinal = groups.every((group) => {
    const groupMatches = matches.filter((match) => match.group === group);
    return groupMatches.length === 6 && groupMatches.every((match) => match.status.completed);
  });

  if (!allGroupsFinal) return new Map();

  const slots = new Map();
  for (const group of groups) {
    tableForFinalGroup(matches, group).forEach((team, index) => {
      slots.set(team.abbreviation, `${index + 1}${group}`);
    });
  }
  return slots;
}

function roundOf32KeySlot(slot) {
  return /^3[A-L]$/.test(slot) ? "3RD" : slot;
}

function slotCandidatesForTeam(abbreviation, teamGroups, teamSlots) {
  if (!abbreviation) return [];
  if (/^[12][A-L]$/.test(abbreviation) || abbreviation === "3RD") return [abbreviation];

  const finalSlot = teamSlots.get(abbreviation);
  if (finalSlot) return [roundOf32KeySlot(finalSlot)];

  const group = teamGroups.get(abbreviation);
  if (!group) return [abbreviation];

  return [`1${group}`, `2${group}`, "3RD"];
}

function candidateRoundOf32Keys(candidateSlots, index = 0, current = [], keys = []) {
  if (index >= candidateSlots.length) {
    keys.push(current.join("-"));
    return keys;
  }

  candidateSlots[index].forEach((slot) => {
    current.push(slot);
    candidateRoundOf32Keys(candidateSlots, index + 1, current, keys);
    current.pop();
  });

  return keys;
}

function roundOf32MatchNumberForEvent(event, teamGroups, teamSlots) {
  const competition = event.competitions?.[0];
  const candidateSlots = (competition?.competitors ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((competitor) => slotCandidatesForTeam(competitor.team?.abbreviation, teamGroups, teamSlots));
  const matchNumbers = new Set(
    candidateRoundOf32Keys(candidateSlots)
      .map((key) => roundOf32SlotMap[key])
      .filter(Boolean),
  );

  return matchNumbers.size === 1 ? [...matchNumbers][0] : null;
}

async function fetchRoundOf32Schedule(matches) {
  const teamGroups = teamGroupsFromMatches(matches);
  const teamSlots = teamSlotsFromFinalStandings(matches);
  return (await fetchScoreboardRange(roundOf32Start, roundOf32End))
    .filter((event) => event.season?.slug === "round-of-32")
    .map((event) => {
      const competition = event.competitions?.[0];
      const matchNumber = roundOf32MatchNumberForEvent(event, teamGroups, teamSlots);
      if (!matchNumber) return null;

      return {
        matchNumber,
        id: event.id,
        date: event.date,
        venue: competition?.venue?.fullName ?? event.venue?.displayName ?? "",
        city: competition?.venue?.address?.city ?? "",
        sourceUrl: event.links?.find((link) => link.rel?.includes("summary"))?.href ?? "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.matchNumber - b.matchNumber);
}

function parseThirdPlaceRows(wikitext) {
  const columns = ["1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L"];
  return wikitext
    .split(/\n\|-\n/)
    .filter((block) => /! scope="row" \|\s*\d+/.test(block))
    .map((block) => {
      const option = Number(block.match(/! scope="row" \|\s*(\d+)/)?.[1]);
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("|") && !line.startsWith("|-") && !line.includes("rowspan"));
      const cells = lines.flatMap((line) => line.replace(/^\|\s*/, "").split(/\s*\|\|\s*/));

      const groups = cells
        .slice(0, 12)
        .map((cell) => cell.match(/'''([A-L])'''/)?.[1])
        .filter(Boolean);

      const assignedGroups = cells
        .slice(12)
        .map((cell) => cell.match(/3([A-L])/)?.[1])
        .filter(Boolean);

      if (groups.length !== 8 || assignedGroups.length !== 8) {
        throw new Error(`Could not parse third-place option ${option}`);
      }

      return {
        option,
        groups,
        key: groups.join(""),
        assignments: Object.fromEntries(
          columns.map((column, index) => [column, `3${assignedGroups[index]}`]),
        ),
      };
    });
}

async function fetchThirdPlaceRules() {
  const data = await fetchJson(THIRD_PLACE_TEMPLATE);
  return parseThirdPlaceRows(data.parse.wikitext);
}

const matches = await fetchMatches();

const payload = {
  generatedAt: new Date().toISOString(),
  sources: {
    scores: ESPN_SCOREBOARD,
    thirdPlaceRules:
      "https://en.wikipedia.org/wiki/Template:2026_FIFA_World_Cup_third-place_table",
    fifaFormat:
      "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/groups-how-teams-qualify-tie-breakers",
  },
  matches,
  roundOf32Schedule: await fetchRoundOf32Schedule(matches),
  thirdPlaceRules: await fetchThirdPlaceRules(),
};

await mkdir("src/data", { recursive: true });
await writeFile(
  "src/data/worldcup-data.json",
  `${JSON.stringify(payload, null, 2)}\n`,
);
await writeFile(
  "src/data/worldcup-data.js",
  `window.WORLD_CUP_DATA = ${JSON.stringify(payload, null, 2)};\n`,
);

console.log(`Wrote ${payload.matches.length} group matches, ${payload.roundOf32Schedule.length} Round of 32 games, and ${payload.thirdPlaceRules.length} third-place rules.`);
