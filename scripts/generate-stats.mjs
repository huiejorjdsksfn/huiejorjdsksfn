#!/usr/bin/env node
/**
 * Draws the profile cards in ../assets from live GitHub data. No third-party stats service:
 * the SVGs are plain files in this repo, so the profile never shows a broken card.
 *
 *   GH_TOKEN=<token with repo + read:user> node scripts/generate-stats.mjs
 *
 * The token needs "repo" scope to include private work. Only totals are drawn; no private
 * repository name, description or code ever appears in the output.
 * Nothing is written unless every request succeeded, so a failed run cannot blank the cards.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.GH_TOKEN;
const LOGIN = process.env.GH_LOGIN || "huiejorjdsksfn";
if (!TOKEN) {
  console.error("GH_TOKEN is not set");
  process.exit(1);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(OUT, { recursive: true });

const H = { Authorization: `Bearer ${TOKEN}`, "User-Agent": "profile-stats" };
async function rest(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
async function graphql(query) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error("graphql: " + JSON.stringify(j.errors ?? r.status));
  return j.data;
}

// ---- data ---------------------------------------------------------------------------------
const gql = await graphql(`query { user(login: "${LOGIN}") {
  name createdAt
  repositories(ownerAffiliations: OWNER, isFork: false) { totalCount }
  contributionsCollection {
    totalCommitContributions totalPullRequestContributions
    contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
  }
}}`);
const u = gql.user;
const cc = u.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const busiest = days.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), days[0]);
const activeDays = days.filter((d) => d.contributionCount > 0).length;

let repos = [];
for (let page = 1; ; page++) {
  const batch = await rest(`/user/repos?per_page=100&page=${page}&affiliation=owner`);
  repos = repos.concat(batch.filter((r) => r.owner.login === LOGIN && !r.fork));
  if (batch.length < 100) break;
}
const privateCount = repos.filter((r) => r.private).length;
const bytes = {};
for (const r of repos) {
  const l = await rest(`/repos/${r.full_name}/languages`);
  for (const [k, v] of Object.entries(l)) bytes[k] = (bytes[k] ?? 0) + v;
}
const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0);
const langs = Object.entries(bytes)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6);

const PROJECTS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "projects.json"), "utf8"),
);
for (const p of PROJECTS.projects) {
  const d = await graphql(`query { repository(owner: "${LOGIN}", name: "${p.repo}") {
    createdAt
    defaultBranchRef { target { ... on Commit { history { totalCount } } } }
  }}`);
  p.commits = d.repository.defaultBranchRef.target.history.totalCount;
  p.created = d.repository.createdAt.slice(0, 10);
}

// ---- consistency numbers from the same contribution calendar ----------------------------------
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const byWeekday = Array(7).fill(0);
const byMonth = {};
for (const d of days) {
  const dt = new Date(d.date + "T00:00:00Z");
  byWeekday[dt.getUTCDay()] += d.contributionCount;
  const key = d.date.slice(0, 7);
  byMonth[key] = (byMonth[key] ?? 0) + d.contributionCount;
}
let longest = 0, run = 0;
for (const d of days) {
  run = d.contributionCount > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
}
// A streak that ends yesterday is still alive: today may simply not have happened yet.
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue;
  else break;
}
const bestMonthKey = Object.keys(byMonth).reduce((a, b) => (byMonth[b] > byMonth[a] ? b : a));
const bestMonth = new Date(bestMonthKey + "-01T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const busiestWeekday = byWeekday.indexOf(Math.max(...byWeekday));

const since = new Date(u.createdAt).getUTCFullYear();
const nf = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#111a33"/>
  </linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#f59e0b"/>
  </linearGradient>
</defs>`;
const card = (w, h, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
${defs}
<rect width="${w}" height="${h}" rx="16" fill="url(#bg)"/>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="15.5" fill="none" stroke="#27324d"/>
${body}
</svg>
`;
const write = (name, svg) => {
  const tmp = join(OUT, `.${name}.tmp`);
  writeFileSync(tmp, svg);
  renameSync(tmp, join(OUT, name));
  console.log("wrote", name);
};

// ---- banner -------------------------------------------------------------------------------
{
  const dots = [];
  for (let x = 0; x < 24; x++)
    for (let y = 0; y < 6; y++) {
      const base = 0.08 + ((x + y) % 5) * 0.045;
      const r = 1 + ((x * 7 + y * 3) % 3) * 0.6;
      const twinkle =
        (x * 5 + y * 3) % 4 === 0
          ? `<animate attributeName="opacity" values="${base};${Math.min(0.75, base + 0.45).toFixed(2)};${base}" dur="${3 + ((x + y) % 4)}s" begin="${((x * 3 + y) % 7) * 0.4}s" repeatCount="indefinite"/>`
          : "";
      dots.push(`<circle cx="${700 + x * 20}" cy="${40 + y * 36}" r="${r}" fill="#2dd4bf" opacity="${base}">${twinkle}</circle>`);
    }
  const body = `
${dots.join("\n")}
<circle cx="1080" cy="130" r="190" fill="#2dd4bf" opacity="0.05"><animate attributeName="r" values="190;205;190" dur="7s" repeatCount="indefinite"/></circle>
<circle cx="1140" cy="60" r="110" fill="#f59e0b" opacity="0.06"/>
<rect x="64" y="52" width="72" height="5" rx="2.5" fill="url(#accent)"><animate attributeName="width" values="72;168;72" dur="5s" repeatCount="indefinite"/></rect>
<text x="64" y="128" font-family="${FONT}" font-size="58" font-weight="700" fill="#f8fafc">${esc((u.name || LOGIN).replace(/^./, (c) => c.toUpperCase()))}</text>
<text x="64" y="170" font-family="${FONT}" font-size="24" fill="#2dd4bf" font-weight="600">Full-stack developer · ERP systems for Kenyan institutions</text>
<text x="64" y="206" font-family="${FONT}" font-size="17" fill="#94a3b8">ICT Support Technician · Othaya, Nyeri County, Kenya</text>
<text x="64" y="232" font-family="${MONO}" font-size="14" fill="#64748b">React · TypeScript · Supabase · PostgreSQL · .NET · CI/CD</text>`;
  write("banner.svg", card(1200, 260, body, "Banner: full-stack developer building ERP systems for Kenyan institutions"));
}

// ---- stats --------------------------------------------------------------------------------
{
  const tiles = [
    [nf(cc.contributionCalendar.totalContributions), "contributions", "last 12 months"],
    [nf(cc.totalCommitContributions), "commits", "last 12 months"],
    [nf(cc.totalPullRequestContributions), "pull requests", "last 12 months"],
    [nf(u.repositories.totalCount), "repositories", `${privateCount} private · ${repos.length - privateCount} public`],
    [nf(activeDays), "active days", `of the last ${days.length}`],
    [nf(busiest.contributionCount), "busiest day", busiest.date],
  ];
  const cells = tiles
    .map(([big, label, sub], i) => {
      const x = 32 + (i % 3) * 316;
      const y = 76 + Math.floor(i / 3) * 112;
      return `<rect x="${x}" y="${y}" width="304" height="96" rx="12" fill="#0f1830" stroke="#27324d"/>
<text x="${x + 22}" y="${y + 46}" font-family="${FONT}" font-size="36" font-weight="700" fill="#f8fafc">${esc(big)}</text>
<text x="${x + 22}" y="${y + 68}" font-family="${FONT}" font-size="15" font-weight="600" fill="#2dd4bf">${esc(label)}</text>
<text x="${x + 22}" y="${y + 86}" font-family="${FONT}" font-size="12" fill="#94a3b8">${esc(sub)}</text>`;
    })
    .join("\n");
  const body = `<text x="32" y="46" font-family="${FONT}" font-size="20" font-weight="700" fill="#f8fafc">Developer stats</text>
<text x="968" y="46" text-anchor="end" font-family="${FONT}" font-size="13" fill="#94a3b8">on GitHub since ${since}</text>
${cells}`;
  write("stats.svg", card(1000, 308, body, "GitHub statistics"));
}

// ---- languages ----------------------------------------------------------------------------
{
  const COLORS = ["#2dd4bf", "#f59e0b", "#818cf8", "#f472b6", "#38bdf8", "#a3e635"];
  const rows = langs
    .map(([name, v], i) => {
      const pct = (100 * v) / totalBytes;
      const y = 78 + i * 36;
      return `<text x="32" y="${y + 13}" font-family="${FONT}" font-size="15" font-weight="600" fill="#e2e8f0">${esc(name)}</text>
<rect x="190" y="${y}" width="640" height="16" rx="8" fill="#0f1830" stroke="#27324d"/>
<rect x="190" y="${y}" width="${Math.max(10, 6.4 * pct)}" height="16" rx="8" fill="${COLORS[i]}"/>
<text x="968" y="${y + 13}" text-anchor="end" font-family="${MONO}" font-size="14" fill="#94a3b8">${pct.toFixed(1)}%</text>`;
    })
    .join("\n");
  const body = `<text x="32" y="46" font-family="${FONT}" font-size="20" font-weight="700" fill="#f8fafc">Languages</text>
<text x="968" y="46" text-anchor="end" font-family="${FONT}" font-size="13" fill="#94a3b8">share of code across ${repos.length} repositories, as counted by GitHub</text>
${rows}`;
  write("languages.svg", card(1000, 78 + langs.length * 36 + 22, body, "Language breakdown"));
}

// ---- contribution heatmap -----------------------------------------------------------------
{
  const weeks = cc.contributionCalendar.weeks;
  const level = (n) => (n === 0 ? 0 : n < 4 ? 1 : n < 10 ? 2 : n < 20 ? 3 : 4);
  const SCALE = ["#131c33", "#0f766e", "#14b8a6", "#5eead4", "#f59e0b"];
  const S = 13, G = 3, X0 = 32, Y0 = 84;
  const cells = [];
  weeks.forEach((w, wi) =>
    w.contributionDays.forEach((d, di) =>
      cells.push(
        `<rect x="${X0 + wi * (S + G)}" y="${Y0 + di * (S + G)}" width="${S}" height="${S}" rx="3" fill="${SCALE[level(d.contributionCount)]}"><title>${esc(d.date)}: ${d.contributionCount}</title></rect>`,
      ),
    ),
  );
  const W = X0 * 2 + weeks.length * (S + G) - G;
  const months = [];
  let last = "";
  weeks.forEach((w, wi) => {
    const m = new Date(w.contributionDays[0].date + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    if (m !== last && wi < weeks.length - 2) {
      months.push(`<text x="${X0 + wi * (S + G)}" y="72" font-family="${FONT}" font-size="12" fill="#94a3b8">${m}</text>`);
      last = m;
    }
  });
  const LY = Y0 + 7 * (S + G) + 12;
  const moreX = W - 32; // right edge of the legend
  const boxesEnd = moreX - 40;
  const boxesStart = boxesEnd - (SCALE.length * 17 - 4);
  const legend = SCALE.map((c, i) => `<rect x="${boxesStart + i * 17}" y="${LY}" width="13" height="13" rx="3" fill="${c}"/>`).join("");
  const body = `<text x="32" y="46" font-family="${FONT}" font-size="20" font-weight="700" fill="#f8fafc">Activity</text>
<text x="${W - 32}" y="46" text-anchor="end" font-family="${FONT}" font-size="13" fill="#94a3b8">${nf(cc.contributionCalendar.totalContributions)} contributions in the last year</text>
${months.join("\n")}
${cells.join("\n")}
<text x="${boxesStart - 8}" y="${LY + 11}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#94a3b8">Less</text>
${legend}
<text x="${moreX}" y="${LY + 11}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#94a3b8">More</text>`;
  write("activity.svg", card(W, Y0 + 7 * (S + G) + 44, body, "Contribution activity over the last year"));
}

// ---- consistency: streaks, best month, weekly rhythm --------------------------------------------
{
  const tiles = [
    [`${current}`, current === 1 ? "day" : "days", "current streak"],
    [`${longest}`, longest === 1 ? "day" : "days", "longest streak"],
    [WEEKDAYS[busiestWeekday], `${nf(byWeekday[busiestWeekday])} contributions`, "most active weekday"],
    [bestMonth.split(" ")[0], `${nf(byMonth[bestMonthKey])} in ${bestMonth.split(" ")[1]}`, "best month"],
  ];
  const cells = tiles
    .map(([big, unit, label], i) => {
      const x = 32 + (i % 2) * 252;
      const y = 76 + Math.floor(i / 2) * 76;
      return `<rect x="${x}" y="${y}" width="236" height="64" rx="12" fill="#0f1830" stroke="#27324d"/>
<text x="${x + 18}" y="${y + 30}" font-family="${FONT}"><tspan font-size="26" font-weight="700" fill="#f8fafc">${esc(big)}</tspan><tspan dx="8" font-size="13" fill="#94a3b8">${esc(unit)}</tspan></text>
<text x="${x + 18}" y="${y + 50}" font-family="${FONT}" font-size="12" font-weight="600" fill="#2dd4bf">${esc(label)}</text>`;
    })
    .join("\n");
  const max = Math.max(...byWeekday, 1);
  const BX = 592, BW = 34, GAP = 16, BASE = 196, MAXH = 104;
  const bars = byWeekday
    .map((v, i) => {
      const h = Math.max(4, (MAXH * v) / max);
      const x = BX + i * (BW + GAP);
      const hot = i === busiestWeekday;
      return `<rect x="${x}" y="${BASE - MAXH}" width="${BW}" height="${MAXH}" rx="8" fill="#0f1830"/>
<rect x="${x}" y="${BASE - h}" width="${BW}" height="${h}" rx="8" fill="${hot ? "#f59e0b" : "#14b8a6"}"><title>${WEEKDAYS[i]}: ${nf(v)}</title></rect>
<text x="${x + BW / 2}" y="${BASE + 22}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${hot ? "#f59e0b" : "#94a3b8"}">${WEEKDAYS[i]}</text>`;
    })
    .join("\n");
  const body = `<text x="32" y="46" font-family="${FONT}" font-size="20" font-weight="700" fill="#f8fafc">Consistency</text>
<text x="968" y="46" text-anchor="end" font-family="${FONT}" font-size="13" fill="#94a3b8">last 12 months</text>
<text x="${BX}" y="76" font-family="${FONT}" font-size="13" font-weight="600" fill="#e2e8f0">Weekly rhythm</text>
${cells}
${bars}`;
  write("consistency.svg", card(1000, 240, body, "Streaks and weekly activity rhythm"));
}

// ---- featured system cards ----------------------------------------------------------------------
for (const p of PROJECTS.projects) {
  const metrics = [{ value: nf(p.commits), label: "commits" }, ...p.metrics.slice(0, 3)];
  const cells = metrics
    .map((m, i) => {
      const x = 28 + (i % 2) * 218;
      const y = 92 + Math.floor(i / 2) * 64;
      return `<rect x="${x}" y="${y}" width="206" height="54" rx="10" fill="#0f1830" stroke="#27324d"/>
<text x="${x + 16}" y="${y + 28}" font-family="${FONT}" font-size="22" font-weight="700" fill="#f8fafc">${esc(m.value)}</text>
<text x="${x + 16}" y="${y + 44}" font-family="${FONT}" font-size="11.5" fill="#94a3b8">${esc(m.label)}</text>`;
    })
    .join("\n");
  let cx = 28;
  const chips = p.chips
    .map((c) => {
      const w = 22 + c.length * 7.2;
      if (cx + w > 452) return ""; // never draw a chip that would run off the card
      const out = `<rect x="${cx}" y="236" width="${w}" height="24" rx="12" fill="#0f1830" stroke="#2dd4bf" stroke-opacity="0.5"/>
<text x="${cx + w / 2}" y="252" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="600" fill="#5eead4">${esc(c)}</text>`;
      cx += w + 8;
      return out;
    })
    .join("\n");
  const pillW = p.visibility.length * 8 + 22;
  const body = `<rect x="0" y="22" width="5" height="232" rx="2.5" fill="url(#accent)"/>
<text x="28" y="44" font-family="${FONT}" font-size="22" font-weight="700" fill="#f8fafc">${esc(p.title)}</text>
<text x="28" y="68" font-family="${FONT}" font-size="13" fill="#94a3b8">${esc(p.subtitle)}</text>
<rect x="${464 - pillW}" y="26" width="${pillW}" height="22" rx="11" fill="${p.visibility === "Public" ? "#0f766e" : "#1e293b"}"/>
<text x="${464 - pillW / 2}" y="41" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="600" fill="#e2e8f0">${esc(p.visibility)}</text>
${cells}
${chips}`;
  write(p.file, card(480, 276, body, `${p.title}: ${p.subtitle}`));
}

// ---- divider ------------------------------------------------------------------------------------
write(
  "divider.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="12" viewBox="0 0 1000 12" role="presentation">
<defs><linearGradient id="d" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#2dd4bf" stop-opacity="0"/><stop offset="0.3" stop-color="#2dd4bf"/>
<stop offset="0.7" stop-color="#f59e0b"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/>
</linearGradient></defs>
<rect x="0" y="5" width="1000" height="2" rx="1" fill="url(#d)"/>
</svg>
`,
);
