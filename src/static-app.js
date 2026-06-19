(function () {
  const data = window.WORLD_CUP_DATA;
  const groups = "ABCDEFGHIJKL".split("");
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

    if (favorite === "draw") {
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
    return `<span class="teamName"><img src="${escapeHtml(team.logo)}" alt=""><span>${escapeHtml(team.shortName)}</span></span>`;
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
    return `<div class="bracketTeam"><span class="slot">${escapeHtml(slot)}</span>${teamName(team)}</div>`;
  }

  function renderKnockout() {
    const { thirdRanked, advancingThirds, rule, slots } = getQualifiers();
    const advancingKeys = new Set(advancingThirds.map((row) => row.group));
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
        <div class="bracketHeader"><h2>Round of 32 projection</h2><span>Completed + live scores, then moneyline favorites</span></div>
        <div class="matchGrid">
          ${roundOf32.map((match) => {
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

  const latest = data.matches
    .filter((match) => match.status.state === "in" || match.status.completed)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  document.getElementById("snapshot").textContent =
    `Latest snapshot: ${new Date(data.generatedAt).toLocaleString()} · Last active match: ${latest?.name ?? "none"}`;
  document.getElementById("finalCount").textContent = data.matches.filter((match) => match.status.completed).length;
  document.getElementById("liveCount").textContent = data.matches.filter((match) => match.status.state === "in").length;
  document.getElementById("projectedCount").textContent = data.matches.filter((match) => !match.status.completed && match.status.state !== "in").length;

  renderGroups();
  renderKnockout();
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
})();
