# FILLCO Production Planner — Backend

This is the self-hosted backend for the FILLCO Production Planner. It
replaces the old version of the app (which only ran as a Claude.ai
"Artifact" page) with something that runs on your own Windows server, so
everyone on the shop floor and in the office can reach it from their own
computer or phone over your local network — no internet, no Claude account,
needed to use it day to day.

The actual screens (Dashboard, Log Production, Schedule, Loading, Orders,
etc.) live in `public/index.html` — a straight port of the old Artifact
app's UI and business logic onto this server's own REST API and a real
login (see the API section below). Opening the server's address in a
browser shows the sign-in screen; log in with an account created below.

## 1. What you need first

- **A Windows PC or server** that stays on and connected to your office
  network — this is where the planner lives. Everyone else's device just
  connects to it over the network; nothing is installed on their side.
- **Node.js**, version 22.5 or newer (the "Current"/latest version from
  [nodejs.org](https://nodejs.org) is always fine — it's always far newer
  than this minimum). Download it and run the installer — just click
  through with the defaults. No Python, no "Visual Studio Build Tools", and
  no other prerequisite is needed: this app's database is Node's own
  built-in SQLite support, not a separate native module, so there's nothing
  else to install or configure for `npm install` to succeed.
- This project's files, copied onto that PC (e.g. in `C:\Fillco`).

To check Node installed correctly, open **Command Prompt** and type:

```
node --version
```

It should print something like `v22.14.0` (anything 22.5 or higher is
fine). If it says "not recognized", Node isn't installed yet (or you need
to close and reopen Command Prompt after installing it).

## 2. Install

Open Command Prompt, go to the project folder, and run:

```
cd C:\Fillco
npm install
```

This downloads the small number of libraries the server needs. It only
needs to be done once (and again later if you copy in an updated version of
the project).

## 3. Create the first login (admin account)

There's no sign-up page — the very first account has to be created from
the server itself, once, using this command:

```
npm run create-admin
```

It will ask you for:

- **Display name** — e.g. your name, shown in the app.
- **Username** — what you'll type to log in (not your email, just a short
  name like `mahmoud` or `admin`).
- **Password** — type it twice to confirm. It won't show on screen as you
  type, that's normal.

This account is an **admin**: later, from inside the app, an admin can
create accounts for the rest of the team (supervisors, planners, etc.) —
everyone else gets a regular "member" account. Only admins can manage
other users and can change company-wide Settings (rates, lines, and who
can't see customer names); everyone else can still use the rest of the
app normally.

You can run `npm run create-admin` again later to make another admin
account if you ever need one (e.g. a second manager).

## 4. Start the server

```
npm start
```

You should see:

```
FILLCO Production Planner backend listening on http://0.0.0.0:3000
Database file: C:\Fillco\data\fillco.db
```

Leave this window open — closing it stops the server. To check it's
working, open a browser on the *same* PC and go to
`http://localhost:3000` — you should see a small "Backend running" page.

The server listens on **port 3000** by default. All of the app's data
(orders, schedule, production logs, delivery slips, settings, user
accounts) lives in one file: `data\fillco.db`. Back that file up
regularly (just copy it somewhere safe, e.g. a USB drive or a shared
drive, while the server isn't actively being hammered with changes) —
losing it means losing all the planner's data.

### Running it automatically / in the background

For day-to-day use you'll want this running all the time without someone
having to leave a black Command Prompt window open forever. The simplest
options, in order of how much setup they need:

- Use a small tool like [NSSM](https://nssm.cc/) or Windows' own **Task
  Scheduler** to run `npm start` automatically whenever the server PC
  starts up, so it comes back on its own after a reboot or power cut.
- Alternatively, a tool like [PM2](https://pm2.keymetrics.io/) can keep it
  running and restart it automatically if it ever crashes.

Either of these is optional — plain `npm start` in a window is perfectly
fine to begin with.

## 5. Let other computers and phones on the network reach it

By default, Windows blocks other computers on your network from reaching
anything running on your PC — this is **Windows Firewall**, and it's a
good thing, but it means that by default only the server PC itself can
open the app. You need to tell Windows to allow other devices in on this
one specific port (3000):

1. Open **Windows Defender Firewall with Advanced Security** (search for
   it in the Start menu).
2. Click **Inbound Rules** → **New Rule…** (top-right).
3. Choose **Port** → Next.
4. Choose **TCP**, and type `3000` under "Specific local ports" → Next.
5. Choose **Allow the connection** → Next.
6. Tick all three (Domain/Private/Public, or at least **Private** if this
   is an office network) → Next.
7. Give it a name like "FILLCO Production Planner" → Finish.

After that, find the server PC's network address (open Command Prompt on
it and type `ipconfig`, look for "IPv4 Address", something like
`192.168.1.50`). Anyone else on the same network can now reach the app at
`http://192.168.1.50:3000` from their own PC's browser, or from a phone's
browser on the same Wi-Fi. (Once the Windows desktop app and Android app
exist, they'll point at this same address.)

## Bringing over data from the old version

If you were using the old Claude.ai Artifact version of the planner, its
data (orders, schedule, past production logs, delivery slips, settings)
can be brought into this one. Once you have an export file from that app
(a `.json` file), run:

```
npm run import -- path\to\export.json
```

This is safe to run more than once on the same (or an updated) export
file — it won't create duplicate rows for anything it already imported.

## Configuration

Two settings — which port the server listens on, and where the database
file lives — are in `config.json` at the top of this folder:

```json
{
  "port": 3000,
  "dbPath": "./data/fillco.db"
}
```

Change either value and restart the server to apply it. If you'd rather
set these through environment variables instead (e.g. for a service
manager), `PORT` and `DB_PATH` override `config.json`.

The server also generates a random secret on its first run, used to sign
login sessions, and saves it to `data/session-secret.key`. Don't delete or
share that file — deleting it logs everyone out; sharing it would let
someone forge a login. It's created automatically; you don't need to do
anything with it.

---

## For developers: API surface

`public/index.html` (the ported frontend) calls this API instead of
Claude's Artifact platform. Everything requires a valid session cookie
(set by `POST /api/login`) except login itself.

- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET/POST /api/orders`, `GET/PUT/DELETE /api/orders/:id`
- `GET/POST /api/schedule`, `GET/PUT/DELETE /api/schedule/:id`
- `GET/POST /api/logs`, `GET/PUT/DELETE /api/logs/:id`,
  `PATCH /api/logs/:logId/rolls/:rollId`
- `GET/POST /api/delivery-slips`, `GET/PUT/DELETE /api/delivery-slips/:id`,
  `POST /api/delivery-slips/claim-slip-number`
- `GET/PUT /api/settings` (PUT is admin-only)
- `GET/POST /api/users`, `PATCH /api/users/:id` (admin-only)

`GET /api/orders` supports `status`, `so`, `dueFrom`, `dueTo`, `limit`.
`GET /api/schedule` supports `date`, `dateFrom`, `dateTo`, `line`, `shift`,
`so`, `status`, `limit`. `GET /api/logs` supports `date`, `dateFrom`,
`dateTo`, `line`, `shift`, `so`, `scheduleId`, `limit`. `GET
/api/delivery-slips` supports `so`, `date`, `checked`, `limit`.

See `src/db.js` for the full SQLite schema and `src/serialize.js` for the
exact JSON shape each endpoint returns (deliberately kept close to the
original Artifact app's `orders`/`schedule`/`logs`/`deliverySlips` data, so
porting the frontend is mostly a `fetch()` swap, not a redesign).
