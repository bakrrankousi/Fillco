#!/usr/bin/env node
// Interactive CLI to create the very first admin account. There is no
// public self-signup and no prior identity to bootstrap from (the old
// Artifact app used Claude's org identity for this; the self-hosted
// version has none), so this script is the one-time, run-on-the-server
// way to create that first login. See README.md "First-time setup".
//
// Deliberately doesn't use the `readline` module's question()/line-event
// API: calling it repeatedly against piped/non-interactive stdin can drop
// buffered lines (a well-known readline gotcha — a whole chunk of piped
// input gets split into 'line' events synchronously, before the async
// code awaiting the first question() has even registered a listener for
// the second one). This hand-rolled line reader buffers raw stdin itself,
// so it behaves the same whether it's run at a real terminal or fed answers
// through a pipe (as the test suite below does).
const db = require("../src/db");
const auth = require("../src/auth");

function createPrompter() {
  let buffer = "";
  let waitingResolve = null;
  let masking = false;
  let maskedValue = "";

  function tryResolveBuffered() {
    const idx = buffer.indexOf("\n");
    if (idx === -1 || !waitingResolve) return;
    const line = buffer.slice(0, idx).replace(/\r$/, "");
    buffer = buffer.slice(idx + 1);
    const resolve = waitingResolve;
    waitingResolve = null;
    resolve(line);
  }

  function onData(chunk) {
    const str = chunk.toString("utf8");
    if (masking) {
      for (const ch of str) {
        if (ch === "\n" || ch === "\r") {
          process.stdout.write("\n");
          masking = false;
          const val = maskedValue;
          maskedValue = "";
          if (waitingResolve) {
            const resolve = waitingResolve;
            waitingResolve = null;
            resolve(val);
          }
          return;
        } else if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(1);
        } else if (ch === "\u007f" || ch === "\b") {
          maskedValue = maskedValue.slice(0, -1);
        } else {
          maskedValue += ch;
        }
      }
      return;
    }
    buffer += str;
    tryResolveBuffered();
  }

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  process.stdin.resume();

  function ask(promptText) {
    process.stdout.write(promptText);
    return new Promise((resolve) => {
      const idx = buffer.indexOf("\n");
      if (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        resolve(line.trim());
        return;
      }
      waitingResolve = (line) => resolve(line.trim());
    });
  }

  // Masks input (no echo) when run at a real terminal; falls back to a
  // plain prompt when stdin isn't a TTY (raw mode isn't available there,
  // and there's no terminal to hide anything from anyway).
  function askHidden(promptText) {
    if (!process.stdin.isTTY) return ask(promptText);
    process.stdout.write(promptText);
    return new Promise((resolve) => {
      masking = true;
      maskedValue = "";
      process.stdin.setRawMode(true);
      waitingResolve = (val) => {
        process.stdin.setRawMode(false);
        resolve(val);
      };
    });
  }

  function close() {
    process.stdin.removeListener("data", onData);
    process.stdin.pause();
  }

  return { ask, askHidden, close };
}

async function main() {
  const prompter = createPrompter();
  try {
    console.log("FILLCO Production Planner — create the first admin account\n");

    const existingAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
    if (existingAdmin) {
      console.log("An admin account already exists. Run this again only if you really need another one.\n");
    }

    const displayName = await prompter.ask("Display name (e.g. 'Mahmoud'): ");
    if (!displayName) {
      console.error("Display name is required.");
      process.exitCode = 1;
      return;
    }

    const username = (await prompter.ask("Username (for logging in): ")).toLowerCase();
    if (!username) {
      console.error("Username is required.");
      process.exitCode = 1;
      return;
    }

    const existingUser = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (existingUser) {
      console.error("That username is already taken. Run the script again with a different one.");
      process.exitCode = 1;
      return;
    }

    const password = await prompter.askHidden("Password: ");
    if (!password || password.length < 6) {
      console.error("Password must be at least 6 characters.");
      process.exitCode = 1;
      return;
    }
    const confirm = await prompter.askHidden("Confirm password: ");
    if (password !== confirm) {
      console.error("Passwords didn't match. Nothing was created — try again.");
      process.exitCode = 1;
      return;
    }

    const passwordHash = await auth.hashPassword(password);
    const info = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, active, created_at) VALUES (?, ?, ?, 'admin', 1, ?)"
      )
      .run(username, passwordHash, displayName, new Date().toISOString());

    console.log(`\nAdmin account created (id ${info.lastInsertRowid}). You can now log in with:`);
    console.log(`  username: ${username}`);
    console.log(`  (the password you just typed)`);
  } finally {
    prompter.close();
  }
}

main().catch((err) => {
  console.error("Failed to create admin account:", err);
  process.exitCode = 1;
});
