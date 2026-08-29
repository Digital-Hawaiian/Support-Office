#!/usr/bin/env node
/**
 * sync-coda-to-firebase.js
 *
 * Pulls the "Hawaiian Knowledge Quiz - Question Bank" table from Coda
 * (docs.superhuman.com / Coda are the same backend) and pushes it into
 * your Firebase Realtime Database, under the path  quiz/bank .
 *
 * Run this once right after you set up Firebase (step 6 of the setup
 * guide), and again any time you add/edit/remove questions in Coda.
 * It fully overwrites quiz/bank each time (safe — scores live under
 * quiz/weeks and quiz/alltime and are never touched by this script).
 *
 * Requirements: Node.js 18+ (uses the built-in fetch — no npm install needed).
 *
 * Usage:
 *   CODA_API_TOKEN=xxxxx FIREBASE_URL=https://your-project-default-rtdb.region.firebasedatabase.app node sync-coda-to-firebase.js
 *
 * Getting a Coda API token:
 *   Coda account settings -> API settings -> Generate API token.
 *   (Superhuman Docs runs on the same Coda backend, so a regular Coda API
 *   token from https://coda.io/account works.)
 */

'use strict';

// ─────────────────────────── CONFIG ───────────────────────────
const CODA_API_BASE = process.env.CODA_API_BASE || 'https://coda.io/apis/v1';
const CODA_API_TOKEN = process.env.CODA_API_TOKEN; // required, see usage above
const FIREBASE_URL = process.env.FIREBASE_URL; // required, see usage above

// This doc + table were created for you already — no need to change these.
const DOC_ID = 'ZmfyKsLYyb';
const TABLE_ID = 'grid-Lj37Zm6PdA';

// Column IDs from the table as created (see the Coda table's column
// settings if these ever need re-checking — they don't change even if you
// rename a column).
const COL = {
  id: 'c-g_XszeCYZC',
  category: 'c-9fe_BzHosB',
  question: 'c-D3ue07h4eG',
  optionA: 'c-UO8lfsmEnD',
  optionB: 'c-FkkaDm4qTX',
  optionC: 'c-13XRm7AJEj',
  optionD: 'c-17EE8wbbty',
  correct: 'c-wNjjP470DT',
};
// ────────────────────────────────────────────────────────────

async function fetchAllRows() {
  if (!CODA_API_TOKEN) {
    console.error('Missing CODA_API_TOKEN. Run as:');
    console.error('  CODA_API_TOKEN=xxxxx FIREBASE_URL=https://... node sync-coda-to-firebase.js');
    process.exit(1);
  }
  if (!FIREBASE_URL) {
    console.error('Missing FIREBASE_URL. Run as:');
    console.error('  CODA_API_TOKEN=xxxxx FIREBASE_URL=https://... node sync-coda-to-firebase.js');
    process.exit(1);
  }

  const rows = [];
  let pageToken = null;

  do {
    const url = new URL(`${CODA_API_BASE}/docs/${DOC_ID}/tables/${TABLE_ID}/rows`);
    url.searchParams.set('valueFormat', 'simple');
    url.searchParams.set('limit', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CODA_API_TOKEN}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Coda API request failed (${res.status}): ${body}\n` +
          `Check CODA_API_TOKEN, and CODA_API_BASE if your org uses a different API host.`
      );
    }

    const data = await res.json();
    rows.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return rows;
}

function rowToQuestion(row) {
  const v = row.values || {};
  const id = v[COL.id];
  const cat = v[COL.category];
  const q = v[COL.question];
  const optA = v[COL.optionA];
  const optB = v[COL.optionB];
  const optC = v[COL.optionC];
  const optD = v[COL.optionD];
  const correctLetter = v[COL.correct];

  if (!id || !q || !optA || !optB || !optC || !optD || !correctLetter) {
    console.warn(`Skipping incomplete row ${row.id} (${id || 'no ID'}) — missing a required field.`);
    return null;
  }

  const optionsByLetter = { A: optA, B: optB, C: optC, D: optD };
  const ans = optionsByLetter[correctLetter];
  if (!ans) {
    console.warn(`Skipping row ${id} — "Correct Answer" is "${correctLetter}", expected A/B/C/D.`);
    return null;
  }

  return {
    id,
    cat: cat || 'General Knowledge',
    q,
    opts: [optA, optB, optC, optD],
    ans,
  };
}

async function pushToFirebase(bankById) {
  const res = await fetch(`${FIREBASE_URL}/quiz/bank.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bankById),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase write failed (${res.status}): ${body}`);
  }
}

async function main() {
  console.log('Fetching questions from Coda…');
  const rawRows = await fetchAllRows();
  console.log(`  ${rawRows.length} row(s) found.`);

  const bankById = {};
  let ok = 0;
  for (const row of rawRows) {
    const question = rowToQuestion(row);
    if (question) {
      bankById[question.id] = question;
      ok++;
    }
  }

  console.log(`Pushing ${ok} question(s) to Firebase (quiz/bank)…`);
  await pushToFirebase(bankById);
  console.log('Done. quiz.html will pick this up automatically on the next play.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
