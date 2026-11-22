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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
    totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions
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


// ---- activity rank --------------------------------------------------------------------------------
// A weighted score of what a developer actually does on GitHub over the last 12 months, set against
// fixed reference medians (the shape used by the well-known github-readme-stats rank). Stars and
// followers are deliberately left out: most of this work is private institutional software, which
// earns neither. Each measure saturates (it can only approach 1), so no single number dominates.
const expCdf = (x) => 1 - Math.pow(2, -x);
const RANK_INPUTS = [
  { key: "commits", label: "commits", value: cc.totalCommitContributions, median: 250, weight: 2 },
  { key: "prs", label: "pull requests", value: cc.totalPullRequestContributions, median: 50, weight: 3 },
  { key: "issues", label: "issues", value: cc.totalIssueContributions, median: 25, weight: 1 },
  { key: "reviews", label: "reviews", value: cc.totalPullRequestReviewContributions, median: 2, weight: 1 },
];
const weightSum = RANK_INPUTS.reduce((a, r) => a + r.weight, 0);
const rankScore = RANK_INPUTS.reduce((a, r) => a + r.weight * expCdf(r.value / r.median), 0) / weightSum; // 0..1, higher is better
const percentile = (1 - rankScore) * 100; // "top X%": lower is better
const LEVELS = ["S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C"];
const THRESHOLDS = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
const rankLevel = LEVELS[THRESHOLDS.findIndex((t) => percentile <= t)];

// One entry per UTC day. Running twice in a day just refreshes that day's entry.
const HISTORY_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "history.json");
let history = existsSync(HISTORY_FILE) ? JSON.parse(readFileSync(HISTORY_FILE, "utf8")) : [];
const today = new Date().toISOString().slice(0, 10);
const entry = {
  date: today,
  level: rankLevel,
  percentile: Math.round(percentile * 10) / 10,
  score: Math.round(rankScore * 1000) / 10,
  commits: cc.totalCommitContributions,
  prs: cc.totalPullRequestContributions,
  contributions: cc.contributionCalendar.totalContributions,
};
history = history.filter((h) => h.date !== today).concat(entry).sort((a, b) => a.date.localeCompare(b.date)).slice(-400);

const since = new Date(u.createdAt).getUTCFullYear();
const nf = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

// All motion is CSS, and switched off for people who ask their system for reduced motion. Every
// animation only describes where an element starts ("from"), so with motion off the card simply
// shows its finished state.
const STYLE = `
.up{animation:up .9s cubic-bezier(.2,.7,.2,1) both}
@keyframes up{from{opacity:0;transform:translateY(12px)}}
.grow{transform-box:fill-box;transform-origin:left center;animation:grow 1.3s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{transform:scaleX(0)}}
.rise{transform-box:fill-box;transform-origin:center bottom;animation:rise 1.2s cubic-bezier(.2,.7,.2,1) both}
@keyframes rise{from{transform:scaleY(0)}}
.flt{transform-box:fill-box;transform-origin:center;animation:flt var(--d,6s) ease-in-out var(--t,0s) infinite}
@keyframes flt{0%,100%{transform:translate(0,0) rotate(0deg)}33%{transform:translate(6px,-12px) rotate(2.5deg)}66%{transform:translate(-5px,-5px) rotate(-2deg)}}
.drift{transform-box:fill-box;transform-origin:center;animation:drift var(--d,14s) ease-in-out var(--t,0s) infinite}
@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-26px,14px) scale(1.06)}}
.tw{animation:tw var(--d,4s) ease-in-out var(--t,0s) infinite}
@keyframes tw{0%,100%{opacity:var(--b)}50%{opacity:calc(var(--b) + .45)}}
.shim{animation:shim 5s ease-in-out var(--t,0s) infinite}
@keyframes shim{0%,100%{opacity:1}50%{opacity:.45}}
.bar{transform-box:fill-box;transform-origin:left center;animation:bar 5s ease-in-out infinite}
@keyframes bar{0%,100%{transform:scaleX(1)}50%{transform:scaleX(1.9)}}
.sweep{animation:sweep 5s linear infinite}
@keyframes sweep{from{transform:translateX(-260px)}to{transform:translateX(1060px)}}
.ring{animation:ring 1.7s cubic-bezier(.2,.7,.2,1) both}
@keyframes ring{from{stroke-dashoffset:var(--len)}}
.blink{animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.wave{animation:wave var(--d,12s) linear infinite}
@keyframes wave{to{transform:translateX(-1000px)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
`;
const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#111a33"/>
  </linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#f59e0b"/>
  </linearGradient>
</defs>`;
const card = (w, h, body, label, extraCss = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
${defs}
<style>${STYLE}${extraCss}</style>
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
      const live = (x * 5 + y * 3) % 4 === 0;
      dots.push(
        `<circle cx="${700 + x * 20}" cy="${40 + y * 36}" r="${r}" fill="#2dd4bf" opacity="${base}"${live ? ` class="tw" style="--b:${base};--d:${3 + ((x + y) % 4)}s;--t:${(((x * 3 + y) % 7) * 0.4).toFixed(1)}s"` : ""}/>`,
      );
    }
  // Floating tech chips: each drifts on its own loop, so the group never moves in step.
  const CHIPS = [
    ["React", 800, 36, "#2dd4bf"],
    ["TypeScript", 912, 78, "#f59e0b"],
    ["Supabase", 1052, 34, "#2dd4bf"],
    ["PostgreSQL", 836, 140, "#818cf8"],
    ["M-Pesa", 1006, 124, "#f59e0b"],
    [".NET", 1112, 92, "#818cf8"],
    ["CI/CD", 802, 204, "#2dd4bf"],
    ["RLS", 936, 196, "#f472b6"],
    ["</>", 1060, 196, "#f59e0b"],
    ["ERP", 1126, 168, "#2dd4bf"],
  ];
  const chips = CHIPS.map(([label, x, y, c], i) => {
    const w = 26 + label.length * 8.4;
    return `<g class="flt" style="--d:${(5 + (i * 7) % 5).toFixed(0)}s;--t:${(-i * 0.9).toFixed(1)}s">
<rect x="${x}" y="${y}" width="${w}" height="30" rx="15" fill="#0f1830" fill-opacity="0.85" stroke="${c}" stroke-opacity="0.7"/>
<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-family="${MONO}" font-size="14" font-weight="600" fill="${c}">${esc(label)}</text>
</g>`;
  }).join("\n");
  const body = `
${dots.join("\n")}
<circle class="drift" style="--d:16s" cx="1080" cy="130" r="190" fill="#2dd4bf" opacity="0.05"/>
<circle class="drift" style="--d:11s;--t:-4s" cx="1140" cy="60" r="110" fill="#f59e0b" opacity="0.06"/>
<circle class="drift" style="--d:19s;--t:-9s" cx="640" cy="250" r="90" fill="#818cf8" opacity="0.05"/>
${chips}
<rect class="bar" x="64" y="52" width="72" height="5" rx="2.5" fill="url(#accent)"/>
<text class="up" x="64" y="128" font-family="${FONT}" font-size="58" font-weight="700" fill="#f8fafc">${esc((u.name || LOGIN).replace(/^./, (c) => c.toUpperCase()))}</text>
<text class="up" style="animation-delay:.25s" x="64" y="170" font-family="${FONT}" font-size="24" fill="#2dd4bf" font-weight="600">Full-stack developer · ERP systems for Kenyan institutions</text>
<text class="up" style="animation-delay:.45s" x="64" y="206" font-family="${FONT}" font-size="17" fill="#94a3b8">ICT Support Technician · Othaya, Nyeri County, Kenya</text>
<text class="up" style="animation-delay:.65s" x="64" y="232" font-family="${MONO}" font-size="14" fill="#64748b">React · TypeScript · Supabase · PostgreSQL · .NET · CI/CD</text>`;
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
      return `<g class="up" style="animation-delay:${(0.15 + i * 0.12).toFixed(2)}s"><rect x="${x}" y="${y}" width="304" height="96" rx="12" fill="#0f1830" stroke="#27324d"/>
<text x="${x + 22}" y="${y + 46}" font-family="${FONT}" font-size="36" font-weight="700" fill="#f8fafc">${esc(big)}</text>
<text x="${x + 22}" y="${y + 68}" font-family="${FONT}" font-size="15" font-weight="600" fill="#2dd4bf">${esc(label)}</text>
<text x="${x + 22}" y="${y + 86}" font-family="${FONT}" font-size="12" fill="#94a3b8">${esc(sub)}</text></g>`;
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
<rect class="grow" style="animation-delay:${(0.2 + i * 0.15).toFixed(2)}s" x="190" y="${y}" width="${Math.max(10, 6.4 * pct)}" height="16" rx="8" fill="${COLORS[i]}"/>
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
        `<rect${d.contributionCount > 0 ? ` class="shim" style="--t:${(wi * 0.09).toFixed(2)}s"` : ""} x="${X0 + wi * (S + G)}" y="${Y0 + di * (S + G)}" width="${S}" height="${S}" rx="3" fill="${SCALE[level(d.contributionCount)]}"><title>${esc(d.date)}: ${d.contributionCount}</title></rect>`,
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
      return `<g class="up" style="animation-delay:${(0.1 + i * 0.12).toFixed(2)}s"><rect x="${x}" y="${y}" width="236" height="64" rx="12" fill="#0f1830" stroke="#27324d"/>
<text x="${x + 18}" y="${y + 30}" font-family="${FONT}"><tspan font-size="26" font-weight="700" fill="#f8fafc">${esc(big)}</tspan><tspan dx="8" font-size="13" fill="#94a3b8">${esc(unit)}</tspan></text>
<text x="${x + 18}" y="${y + 50}" font-family="${FONT}" font-size="12" font-weight="600" fill="#2dd4bf">${esc(label)}</text></g>`;
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
<rect class="rise" style="animation-delay:${(0.2 + i * 0.1).toFixed(2)}s" x="${x}" y="${BASE - h}" width="${BW}" height="${h}" rx="8" fill="${hot ? "#f59e0b" : "#14b8a6"}"><title>${WEEKDAYS[i]}: ${nf(v)}</title></rect>
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
      return `<g class="up" style="animation-delay:${(0.1 + i * 0.12).toFixed(2)}s"><rect x="${x}" y="${y}" width="206" height="54" rx="10" fill="#0f1830" stroke="#27324d"/>
<text x="${x + 16}" y="${y + 28}" font-family="${FONT}" font-size="22" font-weight="700" fill="#f8fafc">${esc(m.value)}</text>
<text x="${x + 16}" y="${y + 44}" font-family="${FONT}" font-size="11.5" fill="#94a3b8">${esc(m.label)}</text></g>`;
    })
    .join("\n");
  let cx = 28;
  const chips = p.chips
    .map((c, ci) => {
      const w = 22 + c.length * 7.2;
      if (cx + w > 452) return ""; // never draw a chip that would run off the card
      const out = `<g class="flt" style="--d:${4 + (ci % 3)}s;--t:${-ci * 0.7}s"><rect x="${cx}" y="236" width="${w}" height="24" rx="12" fill="#0f1830" stroke="#2dd4bf" stroke-opacity="0.5"/>
<text x="${cx + w / 2}" y="252" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="600" fill="#5eead4">${esc(c)}</text></g>`;
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
<defs>
<linearGradient id="d" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#2dd4bf" stop-opacity="0"/><stop offset="0.3" stop-color="#2dd4bf"/>
<stop offset="0.7" stop-color="#f59e0b"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/>
</linearGradient>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</linearGradient>
</defs>
<style>${STYLE}</style>
<rect x="0" y="5" width="1000" height="2" rx="1" fill="url(#d)"/>
<rect class="sweep" x="0" y="4" width="160" height="4" rx="2" fill="url(#g)"/>
</svg>
`,
);

// ---- typing terminal ----------------------------------------------------------------------------
{
  const T = 18; // seconds per loop
  const X = 64, Y0 = 104, LH = 28, CW = 9.4;
  const lines = [
    { k: "cmd", t: "whoami", s: 0.6, d: 0.8 },
    { k: "out", t: "isaac_njoroge — full-stack developer · Kenya", s: 1.8, d: 1.2, c: "#e2e8f0" },
    { k: "cmd", t: "ls systems/", s: 3.6, d: 0.9 },
    { k: "out", t: "kanyange-connect/    medi-procure-hub/", s: 4.9, d: 1.1, c: "#5eead4" },
    { k: "cmd", t: "cat stack.txt", s: 6.6, d: 1.0 },
    { k: "out", t: "react · typescript · supabase · postgres · .NET · ci/cd", s: 7.9, d: 1.5, c: "#94a3b8" },
    { k: "cmd", t: "", s: 9.8, d: 0.2 },
  ];
  let css = `.cov{transform-box:fill-box;transform-origin:right center;transform:scaleX(0)}
.cyc{animation:cyc ${T}s linear infinite}
@keyframes cyc{0%,92%{opacity:1}96%,99.9%{opacity:0}100%{opacity:1}}`;
  const rows = lines
    .map((l, i) => {
      const y = Y0 + i * LH;
      const chars = (l.k === "cmd" ? 2 : 0) + l.t.length;
      const a = ((l.s / T) * 100).toFixed(2);
      const b = (((l.s + l.d) / T) * 100).toFixed(2);
      css += `\n@keyframes ty${i}{0%,${a}%{transform:scaleX(1)}${b}%,100%{transform:scaleX(0)}}.ty${i}{animation:ty${i} ${T}s steps(${Math.max(1, chars)}) infinite}`;
      const text =
        l.k === "cmd"
          ? `<text x="${X}" y="${y}" font-family="${MONO}" font-size="15"><tspan fill="#f59e0b">$ </tspan><tspan fill="#f8fafc">${esc(l.t)}</tspan></text>`
          : `<text x="${X}" y="${y}" font-family="${MONO}" font-size="15" fill="${l.c}">${esc(l.t)}</text>`;
      const cursor =
        i === lines.length - 1
          ? `<rect class="blink" x="${X + 2 * CW}" y="${y - 13}" width="9" height="17" fill="#2dd4bf"/>`
          : "";
      const w = (chars + 2) * CW + 12;
      return `${text}${cursor}<rect class="cov ty${i}" x="${X - 6}" y="${y - 18}" width="${w}" height="26" fill="#0a0f1c"/>`;
    })
    .join("\n");
  const H = Y0 + lines.length * LH + 20;
  const body = `<rect x="32" y="24" width="936" height="${H - 44}" rx="12" fill="#0a0f1c" stroke="#27324d"/>
<path d="M32 36a12 12 0 0 1 12-12h912a12 12 0 0 1 12 12v22H32z" fill="#111a33"/>
<circle cx="58" cy="41" r="6" fill="#f87171"/><circle cx="80" cy="41" r="6" fill="#fbbf24"/><circle cx="102" cy="41" r="6" fill="#34d399"/>
<text x="500" y="46" text-anchor="middle" font-family="${MONO}" font-size="13" fill="#64748b">isaac@kenya: ~/systems</text>
<g class="cyc">
${rows}
</g>`;
  write("terminal.svg", card(1000, H, body, "Animated terminal: whoami, systems built and tech stack", css));
}

// ---- animated wave footer -----------------------------------------------------------------------
{
  const wave = (amp, phase, base) => {
    // 2000 wide with a 500 period, so sliding it 1000 to the left loops without a seam
    let d = `M0 ${base}`;
    for (let x = 0; x <= 2000; x += 20) d += ` L${x} ${(base + amp * Math.sin(((x + phase) / 500) * 2 * Math.PI)).toFixed(1)}`;
    return d + " L2000 160 L0 160 Z";
  };
  const body = `<g class="wave" style="--d:22s"><path d="${wave(10, 0, 96)}" fill="#818cf8" fill-opacity="0.16"/></g>
<g class="wave" style="--d:15s"><path d="${wave(14, 160, 108)}" fill="#f59e0b" fill-opacity="0.16"/></g>
<g class="wave" style="--d:10s"><path d="${wave(12, 330, 122)}" fill="#2dd4bf" fill-opacity="0.22"/></g>
<text x="500" y="62" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" fill="#f8fafc">Thanks for stopping by</text>
<text x="500" y="88" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#94a3b8">Building practical systems for Kenyan institutions</text>`;
  write("footer.svg", card(1000, 160, body, "Animated footer: thanks for stopping by"));
}

// ---- rank card + daily history ------------------------------------------------------------------
{
  const R = 58, LEN = 2 * Math.PI * R;
  const ringOffset = LEN * (1 - rankScore);
  const trend = history.slice(-30);
  const CX = 520, CW = 448, CY = 74, CH = 100;
  let chart;
  if (trend.length < 2) {
    chart = `<line x1="${CX}" y1="${CY + CH}" x2="${CX + CW}" y2="${CY + CH}" stroke="#27324d" stroke-dasharray="4 6"/>
<text x="${CX + CW / 2}" y="${CY + CH / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#94a3b8">Tracking started ${esc(trend[0]?.date ?? today)}. The trend builds up one point a day.</text>`;
  } else {
    const lo = Math.min(...trend.map((t) => t.score)), hi = Math.max(...trend.map((t) => t.score));
    const pad = Math.max(1, (hi - lo) * 0.25);
    const y = (v) => CY + CH - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * CH;
    const x = (i) => CX + (i / (trend.length - 1)) * CW;
    const pts = trend.map((t, i) => `${x(i).toFixed(1)},${y(t.score).toFixed(1)}`);
    const last = trend[trend.length - 1];
    chart = `<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2dd4bf" stop-opacity="0.35"/><stop offset="1" stop-color="#2dd4bf" stop-opacity="0"/></linearGradient></defs>
<polygon points="${CX},${CY + CH} ${pts.join(" ")} ${CX + CW},${CY + CH}" fill="url(#fill)"/>
<polyline points="${pts.join(" ")}" fill="none" stroke="#2dd4bf" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${x(trend.length - 1)}" cy="${y(last.score).toFixed(1)}" r="5" fill="#f59e0b"/>
<text x="${CX}" y="${CY + CH + 22}" font-family="${FONT}" font-size="12" fill="#94a3b8">${esc(trend[0].date)}</text>
<text x="${CX + CW}" y="${CY + CH + 22}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#94a3b8">${esc(last.date)}</text>`;
  }
  const inputs = RANK_INPUTS.map((r, i) => {
    const px = 232 + (i % 2) * 130, py = 108 + Math.floor(i / 2) * 44;
    return `<g class="up" style="animation-delay:${(0.3 + i * 0.1).toFixed(1)}s"><text x="${px}" y="${py}" font-family="${FONT}" font-size="22" font-weight="700" fill="#f8fafc">${nf(r.value)}</text>
<text x="${px}" y="${py + 17}" font-family="${FONT}" font-size="12" fill="#94a3b8">${esc(r.label)}</text></g>`;
  }).join("\n");
  const body = `<text x="32" y="46" font-family="${FONT}" font-size="20" font-weight="700" fill="#f8fafc">Activity rank</text>
<text x="968" y="46" text-anchor="end" font-family="${FONT}" font-size="13" fill="#94a3b8">recalculated daily · last 12 months</text>
<circle cx="112" cy="136" r="${R}" fill="none" stroke="#0f1830" stroke-width="12"/>
<circle class="ring" style="--len:${LEN.toFixed(1)}" cx="112" cy="136" r="${R}" fill="none" stroke="url(#accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${LEN.toFixed(1)}" stroke-dashoffset="${ringOffset.toFixed(1)}" transform="rotate(-90 112 136)"/>
<text x="112" y="${rankLevel.length > 1 ? 148 : 150}" text-anchor="middle" font-family="${FONT}" font-size="${rankLevel.length > 1 ? 40 : 46}" font-weight="800" fill="#f8fafc">${esc(rankLevel)}</text>
<text x="232" y="74" font-family="${FONT}" font-size="13" font-weight="600" fill="#2dd4bf">Top ${percentile.toFixed(0)}% by activity</text>
${inputs}
<text x="${CX}" y="68" font-family="${FONT}" font-size="13" font-weight="600" fill="#e2e8f0">Daily rank score</text>
<text x="968" y="68" text-anchor="end" font-family="${MONO}" font-size="13" fill="#f59e0b">${(rankScore * 100).toFixed(1)} / 100 today</text>
${chart}
<text x="32" y="232" font-family="${FONT}" font-size="11.5" fill="#64748b">Weighted score of commits, pull requests, issues and reviews against fixed reference medians. Stars and followers are left out on purpose:</text>
<text x="32" y="247" font-family="${FONT}" font-size="11.5" fill="#64748b">most of this work is private institutional software. Higher score is better; the trend line is the saved rank for each day.</text>`;
  write("rank.svg", card(1000, 266, body, `Activity rank ${rankLevel}, top ${percentile.toFixed(0)} percent`));

  // Save the daily history last, so a failed run can never leave a half-written file.
  mkdirSync(dirname(HISTORY_FILE), { recursive: true });
  const tmp = HISTORY_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(history, null, 2) + "\n");
  renameSync(tmp, HISTORY_FILE);
  console.log(`rank ${rankLevel} · top ${percentile.toFixed(1)}% · score ${(rankScore * 100).toFixed(1)} · history ${history.length} day(s)`);
}
