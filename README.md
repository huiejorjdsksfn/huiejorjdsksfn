<div align="center">

<img src="assets/banner.svg" alt="Isaac Njoroge — full-stack developer building ERP systems for Kenyan institutions" width="100%"/>

<br/>

![React](https://img.shields.io/badge/React-0b1220?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-0b1220?style=for-the-badge&logo=typescript&logoColor=3178C6)
![Vite](https://img.shields.io/badge/Vite-0b1220?style=for-the-badge&logo=vite&logoColor=646CFF)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-0b1220?style=for-the-badge&logo=tailwindcss&logoColor=38BDF8)
![Supabase](https://img.shields.io/badge/Supabase-0b1220?style=for-the-badge&logo=supabase&logoColor=3FCF8E)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-0b1220?style=for-the-badge&logo=postgresql&logoColor=4169E1)
![.NET](https://img.shields.io/badge/.NET_WPF-0b1220?style=for-the-badge&logo=dotnet&logoColor=a78bfa)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-0b1220?style=for-the-badge&logo=githubactions&logoColor=2088FF)

<br/>

<img src="assets/terminal.svg" alt="Animated terminal: whoami, systems I have built and my stack" width="100%"/>

</div>

## 👋 About

I build and run **complete management systems for Kenyan institutions**: churches, hospitals and
public-sector offices that need software they can actually operate every day. I design the data model,
write the web and desktop apps, set up the sign-in and permissions, wire in payments and messaging, ship
it through CI/CD, and then support the people who use it.

My day job is **ICT Support** (Tier 1 and 2, HIS/MIS and clinical environments), so I build with the
person at the help desk in mind: clear errors, safe defaults, audit trails, and a way to switch a
feature off when something goes wrong.

📍 Othaya, Nyeri County, Kenya

🔭 **Currently:** building and extending **Kanyange Connect**: the ERP itself, its Windows apps and its operations tooling.

<br/>

<div align="center">

<img src="assets/stats.svg" alt="Developer statistics" width="100%"/>

<br/>

<img src="assets/activity.svg" alt="Contribution activity over the last year" width="100%"/>

<br/>

<img src="assets/consistency.svg" alt="Streaks and weekly rhythm" width="100%"/>

</div>

<div align="center"><img src="assets/divider.svg" alt="" width="100%"/></div>

## 🏗️ Systems I've built

<table>
<tr>
<td width="50%" valign="top">

<img src="assets/project-kanyange.svg" alt="Kanyange Connect: church management ERP" width="100%"/>

</td>
<td width="50%" valign="top">

<a href="https://github.com/huiejorjdsksfn/medi-procure-hub"><img src="assets/project-mediprocure.svg" alt="MediProcure Hub: hospital procurement ERP" width="100%"/></a>

</td>
</tr>
</table>

### ⛪ Kanyange Connect — church management ERP for ACK St. James Kanyange Parish

A full system for a parish: separate sites for the public, members, staff, administrators
and finance, each with its own address and sign-in, all on one shared database.

| | |
| --- | --- |
| **Scale** | 1,000+ commits since August 2026 · ~220,000 lines of TypeScript in 940+ files · 175 route files · 415 components · 220+ database migrations · 130+ test files · 15 CI workflows |
| **Sites** | Public website · member portal · staff portal · admin panel · ERP (finance and records) · apps and departments |
| **Money** | Giving and treasury ledger, bank records, budgets, requisitions, **M-Pesa** and **Equity Jenga** payment callbacks |
| **People** | Member register, sign-up forms with QR codes and Google Forms sync, attendance registers, data-entry desk with an approval queue, certificates |
| **Publishing** | Weekly bulletin studio with a live flip-book and print layout, sermons, events, gallery, blog, prayer requests |
| **Security** | Role-based access (17 staff roles) enforced in the database, authenticator-app (TOTP) second step, audit and sign-in logs with automatic clean-up, bot protection on sign-in |
| **Operations** | Per-page and per-site on/off switches, maintenance mode, live health and job monitors, background job runner |
| **Desktop** | Windows apps for administrators, data entry and reports (.NET / WPF) with an installer, a sync engine and NuGet packages |

### 🏥 MediProcure Hub — hospital procurement ERP · [repository](https://github.com/huiejorjdsksfn/medi-procure-hub)

The whole procurement chain for a hospital: **requisitions → purchase orders → goods received → tenders →
contracts → payment, receipt and journal vouchers**, with a 9-role permission model, a document studio
with signatures and stamps, 3-way invoice matching, WhatsApp notifications through a self-hosted gateway,
a resilient network layer (circuit breaker and priority queue), and an Electron desktop build released for Windows by GitHub Actions.
A permanent CI guard suite catches undefined references and database/schema drift before they ship.

### 🎬 Creative web

Cinematic sites built around motion and storytelling: a 25th-birthday site and a magazine-style montage.

<br/>

<div align="center"><img src="assets/divider.svg" alt="" width="100%"/></div>

## 🧰 What I can do

| Area | Hands-on experience |
| --- | --- |
| **Front end** | React, TypeScript, TanStack Start / Router / Query, Vite, Tailwind CSS 4, shadcn/Radix UI, forms with Zod, charts with Recharts, 3D scenes with three.js, print-ready and PDF layouts |
| **Back end and data** | PostgreSQL design, **row-level security**, SQL functions (RPC), triggers, views, `pg_cron` jobs, Supabase Auth, Storage, Realtime (presence and live feeds) and Edge Functions, server routes and webhooks |
| **Security and access** | Role and permission models, least-privilege grants, authenticator-app 2FA, audit trails, session controls, input validation, bot protection (Turnstile), security reviews of database exposure |
| **Integrations** | M-Pesa, Equity Jenga, transactional email (Resend, SMTP), WhatsApp gateway, Google Forms / Sheets sync, QR codes, ODBC / PostgreSQL migration and sync tooling |
| **Desktop** | .NET / WPF suites with installers and NuGet packaging, Electron apps, printer detection and print-ready receipts |
| **Delivery** | GitHub Actions CI/CD, deploy preflight checks, Docker, Tencent EdgeOne Pages, Cloudflare Pages, Bun and pnpm, patched dependencies, release automation |
| **Quality** | Guard tests that read the real import graph (site isolation), regression tests for every bug fixed, schema-drift and undefined-reference checks, TypeScript in its strictest mode |
| **IT support** | Tier 1/2 support, hospital information systems (HIS/MIS), clinical-environment workflows, user training, documentation, incident handling |

<div align="center">

<img src="assets/languages.svg" alt="Language breakdown" width="100%"/>

</div>

<div align="center"><img src="assets/divider.svg" alt="" width="100%"/></div>

## 💬 Ask me about

- Designing **permissions and roles** for an institution, and enforcing them with Postgres row-level security
- Taking **M-Pesa and Equity Jenga** payments from callback to ledger
- Church and hospital workflows: giving, treasury, procurement, registers and certificates
- Turning a web system into a **Windows desktop suite** with installers and CI releases
- Making a system **safe to operate**: audit trails, off switches, health checks and background jobs

<div align="center"><img src="assets/divider.svg" alt="" width="100%"/></div>

## ⚙️ How I work

- **Make it safe to operate.** Every important feature gets an off switch, a log, and a clear failure message.
- **Enforce rules where the data lives.** Permissions are checked in the database, not just hidden in the UI.
- **Prove it with tests.** When something breaks, I write the test that would have caught it, then fix it.
- **Ship small and verify.** Preflight checks, type-checking and a real build run before anything goes live.
- **Document for the next person.** Sitemaps, runbooks and guides live next to the code.

<br/>

<div align="center">

<img src="assets/footer.svg" alt="Thanks for stopping by" width="100%"/>

<sub>Cards are drawn from my GitHub data by <a href="scripts/generate-stats.mjs"><code>scripts/generate-stats.mjs</code></a> · project figures live in <a href="data/projects.json"><code>data/projects.json</code></a>.</sub>
</div>
