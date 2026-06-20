(function () {
  const CACHE_KEY = "worldCupLiveData:v1";
  const ACTIVE_REFRESH_MS = 30 * 1000;
  const PRE_MATCH_REFRESH_MS = 5 * 60 * 1000;
  const IDLE_REFRESH_MS = 30 * 60 * 1000;
  const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
  const THIRD_PLACE_TEMPLATE =
    "https://en.wikipedia.org/w/api.php?origin=*&action=parse&page=Template:2026_FIFA_World_Cup_third-place_table&prop=wikitext&format=json&formatversion=2";
  const groupStart = new Date("2026-06-11T00:00:00Z");
  const groupEnd = new Date("2026-06-27T00:00:00Z");
  const roundOf32Start = new Date("2026-06-28T00:00:00Z");
  const roundOf32End = new Date("2026-07-04T00:00:00Z");
  const groups = "ABCDEFGHIJKL".split("");
  let refreshTimer = null;
  let data = loadCachedData() || {
    generatedAt: null,
    sources: {
      scores: ESPN_SCOREBOARD,
      thirdPlaceRules: THIRD_PLACE_TEMPLATE,
    },
    matches: [],
    roundOf32Schedule: [],
    thirdPlaceRules: [],
  };
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
  const roundOf32SlotMap = {
    "2A-2B": 73,
    "1E-3RD": 74,
    "1F-2C": 75,
    "1C-2F": 76,
    "1I-3RD": 77,
    "2E-2I": 78,
    "MEX-3RD": 79,
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

  function loadCachedData() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!cached?.matches?.length || !cached?.thirdPlaceRules?.length) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function saveCachedData(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Cache is a convenience only. Private browsing/storage quota should not break the app.
    }
  }

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

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { accept: "application/json,text/plain,*/*" } });
    if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
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

  async function fetchFreshMatches() {
    const events = await fetchScoreboardRange(groupStart, groupEnd);
    const byId = new Map();
    for (const event of events) {
      const normalized = normalizeEvent(event);
      if (normalized) byId.set(normalized.id, normalized);
    }
    return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  async function fetchScoreboardRange(start, end) {
    const byId = new Map();
    for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const scoreboard = await fetchJson(`${ESPN_SCOREBOARD}?limit=100&dates=${ymd(cursor)}`);
      for (const event of scoreboard.events ?? []) {
        byId.set(event.id, event);
      }
    }
    return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  async function fetchRoundOf32Schedule() {
    return (await fetchScoreboardRange(roundOf32Start, roundOf32End))
      .filter((event) => event.season?.slug === "round-of-32")
      .map((event) => {
        const competition = event.competitions?.[0];
        const slots = (competition?.competitors || [])
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((competitor) => competitor.team?.abbreviation);
        const key = slots.join("-");
        const matchNumber = roundOf32SlotMap[key];
        if (!matchNumber) return null;

        return {
          matchNumber,
          id: event.id,
          date: event.date,
          venue: competition?.venue?.fullName || event.venue?.displayName || "",
          city: competition?.venue?.address?.city || "",
          sourceUrl: event.links?.find((link) => link.rel?.includes("summary"))?.href || "",
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

        const ruleGroups = cells
          .slice(0, 12)
          .map((cell) => cell.match(/'''([A-L])'''/)?.[1])
          .filter(Boolean);

        const assignedGroups = cells
          .slice(12)
          .map((cell) => cell.match(/3([A-L])/)?.[1])
          .filter(Boolean);

        if (ruleGroups.length !== 8 || assignedGroups.length !== 8) {
          throw new Error(`Could not parse third-place option ${option}`);
        }

        return {
          option,
          groups: ruleGroups,
          key: ruleGroups.join(""),
          assignments: Object.fromEntries(columns.map((column, index) => [column, `3${assignedGroups[index]}`])),
        };
      });
  }

  async function fetchThirdPlaceRules() {
    const payload = await fetchJson(THIRD_PLACE_TEMPLATE);
    return parseThirdPlaceRows(payload.parse.wikitext);
  }

  async function fetchFreshData() {
    const [matches, roundOf32Schedule, thirdPlaceRules] = await Promise.all([
      fetchFreshMatches(),
      fetchRoundOf32Schedule(),
      fetchThirdPlaceRules(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      sources: {
        scores: ESPN_SCOREBOARD,
        thirdPlaceRules: THIRD_PLACE_TEMPLATE,
      },
      matches,
      roundOf32Schedule,
      thirdPlaceRules,
    };
  }

  async function refreshFromLiveSources() {
    const freshData = await fetchFreshData();
    data = freshData;
    saveCachedData(freshData);
    renderAll("Live data");
    scheduleNextRefresh();
  }

  function nextRefreshDelay() {
    if (data.matches.some((match) => match.status.state === "in")) return ACTIVE_REFRESH_MS;

    const now = Date.now();
    const nextKickoff = data.matches
      .filter((match) => !match.status.completed && new Date(match.date).getTime() >= now - 30 * 60 * 1000)
      .map((match) => new Date(match.date).getTime())
      .sort((a, b) => a - b)[0];

    if (nextKickoff && nextKickoff - now <= 60 * 60 * 1000) return PRE_MATCH_REFRESH_MS;
    return IDLE_REFRESH_MS;
  }

  function scheduleNextRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshFromLiveSources().catch((error) => {
        console.warn("Live data refresh failed", error);
        scheduleNextRefresh();
      });
    }, nextRefreshDelay());
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[char]);
  }

  function pointsFor(gf, ga) {
    if (gf > ga) return 3;
    if (gf === ga) return 1;
    return 0;
  }

  function normalizedImpliedProbabilities(odds) {
    const entries = Object.entries(odds?.implied || {}).filter(([, value]) => typeof value === "number");
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return {};
    return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
  }

  function shouldProjectDraw(match) {
    const probabilities = normalizedImpliedProbabilities(match.odds);
    const draw = probabilities.draw || 0;
    const favoriteSide = (probabilities.home || 0) >= (probabilities.away || 0) ? "home" : "away";
    const favorite = probabilities[favoriteSide] || 0;
    const spread = Math.abs(Number(match.odds?.spread?.home || 0));

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
    const winGoals = spread >= 2.5 ? 3 : spread >= 1.5 ? 2 : 1;
    const loseGoals = total >= 3.5 && winGoals >= 2 ? 1 : 0;

    if (favorite === "draw" || shouldProjectDraw(match)) {
      const goals = total >= 3.5 ? 2 : total <= 2 ? 0 : 1;
      return { home: goals, away: goals, source: "projected", label: "ML draw" };
    }

    if (favorite === "away") {
      return { home: loseGoals, away: winGoals, source: "projected", label: `${away.abbreviation} ML` };
    }

    return { home: winGoals, away: loseGoals, source: "projected", label: `${home.abbreviation} ML` };
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

  function headToHeadStats(teamId, tiedIds, matches, mode) {
    const stats = { points: 0, gd: 0, gf: 0 };
    matches.forEach((match) => {
      const [home, away] = match.competitors;
      if (!tiedIds.includes(home.id) || !tiedIds.includes(away.id)) return;
      const score = mode === "projected" ? projectedScore(match) : currentScore(match);
      if (!score) return;
      const isHome = home.id === teamId;
      const gf = isHome ? score.home : score.away;
      const ga = isHome ? score.away : score.home;
      stats.points += pointsFor(gf, ga);
      stats.gd += gf - ga;
      stats.gf += gf;
    });
    return stats;
  }

  function tableForGroup(group, mode) {
    const matches = data.matches.filter((match) => match.group === group);
    const teams = new Map();
    matches.forEach((match) => {
      match.competitors.forEach((team) => {
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
      });
    });

    matches.forEach((match) => {
      const score = mode === "projected" ? projectedScore(match) : currentScore(match);
      if (!score) return;
      const [home, away] = match.competitors;
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
      apply(teams.get(home.id), score.home, score.away);
      apply(teams.get(away.id), score.away, score.home);
    });

    const rows = [...teams.values()];
    const tiedByPoints = new Map();
    rows.forEach((row) => tiedByPoints.set(row.points, [...(tiedByPoints.get(row.points) || []), row.id]));

    return rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const tiedIds = tiedByPoints.get(a.points) || [];
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

  function teamName(team) {
    if (!team) return `<span class="teamName"><span>TBD</span></span>`;
    return `<span class="teamName"><img src="${escapeHtml(team.logo)}" alt=""><span>${escapeHtml(team.shortName)}</span></span>`;
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

  function renderGroups() {
    document.getElementById("groupsView").innerHTML = groups.map((group) => {
      const rows = tableForGroup(group, "current");
      const matches = data.matches.filter((match) => match.group === group);
      return `
        <section class="groupCard">
          <div class="groupHeader">
            <h2>Group ${group}</h2>
            <span>${matches.filter((match) => match.status.completed).length}/6 final</span>
          </div>
          <table class="standings">
            <thead><tr><th>Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
            <tbody>
              ${rows.map((team, index) => `
                <tr>
                  <td><span class="rank">${index + 1}</span>${teamName(team)}</td>
                  <td>${team.played}</td>
                  <td>${team.gd > 0 ? `+${team.gd}` : team.gd}</td>
                  <td class="pts">${team.points}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <div class="scores">
            ${matches.map((match) => {
              const score = currentScore(match) || projectedScore(match);
              const [home, away] = match.competitors;
              return `
                <a class="scoreRow ${score.source}" href="${escapeHtml(match.sourceUrl)}" target="_blank" rel="noreferrer">
                  <span class="date">${formatTime(match.date)}</span>
                  <span class="scoreTeams"><span>${home.abbreviation}</span><strong>${score.home}-${score.away}</strong><span>${away.abbreviation}</span></span>
                  <span class="scoreStatus">${escapeHtml(score.source === "projected" ? "Projected" : score.label)}</span>
                </a>
              `;
            }).join("")}
          </div>
        </section>
      `;
    }).join("");
  }

  function getQualifiers() {
    const standings = Object.fromEntries(groups.map((group) => [group, tableForGroup(group, "projected")]));
    const thirdRanked = groups.map((group) => ({ group, team: standings[group][2] })).sort((a, b) => {
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
    groups.forEach((group) => {
      slots[`1${group}`] = standings[group][0];
      slots[`2${group}`] = standings[group][1];
      slots[`3${group}`] = standings[group][2];
    });
    return { thirdRanked, advancingThirds, rule, slots };
  }

  function bracketTeam(slot, team) {
    return `
      <div class="bracketTeam">
        <span class="slot">${escapeHtml(slot)}</span>
        <span class="bracketTeamText">
          ${teamName(team)}
          <small>${escapeHtml(slotDescription(slot))}</small>
        </span>
      </div>
    `;
  }

  function renderKnockout() {
    const { thirdRanked, advancingThirds, rule, slots } = getQualifiers();
    const advancingKeys = new Set(advancingThirds.map((row) => row.group));
    const matchesById = Object.fromEntries(roundOf32.map((match) => [match.id, match]));
    document.getElementById("knockoutView").innerHTML = `
      <aside class="thirdPanel">
        <div class="panelTitle"><h2>Third-place cut</h2><span>Top 8 projected</span></div>
        <ol class="thirdList">
          ${thirdRanked.map(({ group, team }, index) => `
            <li class="${advancingKeys.has(group) ? "advancing" : ""}">
              <span>${index + 1}</span>${teamName(team)}<strong>${team.points} pts</strong><small>G${group}</small>
            </li>
          `).join("")}
        </ol>
        <div class="ruleNote"><strong>Annex C option ${rule ? rule.option : "n/a"}</strong><span>${advancingThirds.map((row) => row.group).join(", ")} advance.</span></div>
      </aside>
      <section class="bracketCanvas">
        <div class="bracketHeader"><h2>Round of 32 projection</h2><span>Grouped in FIFA bracket order</span></div>
        <div class="pathGrid">
          ${bracketPaths.map((path) => `
            <section class="pathGroup">
              <div class="pathHeader"><span>${path.label}</span><small>${path.next}</small></div>
              ${path.matches.map((matchId) => {
                const match = matchesById[matchId];
                const thirdSlot = thirdPlaceMatchOrder[match.id];
                const rightSlot = thirdSlot ? rule?.assignments?.[thirdSlot] : match.right;
                const schedule = data.roundOf32Schedule?.find((item) => item.matchNumber === match.id);
                return `
                  <article class="bracketMatch">
                    <div class="matchNo">Match ${match.id}</div>
                    ${bracketTeam(match.left, slots[match.left])}
                    ${bracketTeam(rightSlot, slots[rightSlot])}
                    ${schedule ? `
                      <div class="matchMeta">
                        <span>${formatBracketDate(schedule.date)}</span>
                        <span>${escapeHtml(schedule.venue)}${schedule.city ? ` · ${escapeHtml(schedule.city)}` : ""}</span>
                      </div>
                    ` : ""}
                    <div class="ruleTag">${thirdSlot ? `Winner Group ${thirdSlot.slice(1)} gets ${rightSlot} by option ${rule.option}` : "Fixed runner-up pairing"}</div>
                  </article>
                `;
              }).join("")}
            </section>
          `).join("")}
        </div>
      </section>
    `;
  }

  function setView(view) {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    document.getElementById("groupsView").classList.toggle("hidden", view !== "groups");
    document.getElementById("knockoutView").classList.toggle("hidden", view !== "knockout");
  }

  function renderAll(sourceLabel = "Snapshot") {
    if (!data.matches.length || !data.thirdPlaceRules.length) {
      document.getElementById("snapshot").textContent = "Loading live World Cup data...";
      document.getElementById("finalCount").textContent = "0";
      document.getElementById("liveCount").textContent = "0";
      document.getElementById("projectedCount").textContent = "0";
      document.getElementById("groupsView").innerHTML = `<section class="groupCard"><div class="groupHeader"><h2>Loading live data</h2><span>ESPN + FIFA rules</span></div></section>`;
      document.getElementById("knockoutView").innerHTML = `<section class="bracketCanvas"><div class="bracketHeader"><h2>Loading live data</h2><span>Bracket will render shortly</span></div></section>`;
      return;
    }

    const latest = data.matches
      .filter((match) => match.status.state === "in" || match.status.completed)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    document.getElementById("snapshot").textContent =
      `${sourceLabel}: ${new Date(data.generatedAt).toLocaleString()} · Last active match: ${latest?.name ?? "none"} · Next refresh: ${Math.round(nextRefreshDelay() / 60000)} min`;
    document.getElementById("finalCount").textContent = data.matches.filter((match) => match.status.completed).length;
    document.getElementById("liveCount").textContent = data.matches.filter((match) => match.status.state === "in").length;
    document.getElementById("projectedCount").textContent = data.matches.filter((match) => !match.status.completed && match.status.state !== "in").length;
    renderGroups();
    renderKnockout();
  }

  renderAll(data.matches.length ? "Cached data" : "Loading");
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  refreshFromLiveSources().catch((error) => {
    console.warn("Initial live data refresh failed", error);
    scheduleNextRefresh();
  });
})();
