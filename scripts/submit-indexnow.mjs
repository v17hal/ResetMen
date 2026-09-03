#!/usr/bin/env node
/**
 * Tell the search engines that will listen without an account.
 *
 * IndexNow is a push protocol: instead of waiting to be crawled, a site posts the URLs that
 * changed and the engines fetch them. Bing, Yandex, Seznam and Naver honour it, and one
 * submission is shared between them. DuckDuckGo and several AI search products read Bing's
 * index, so this reaches further than the list of names suggests.
 *
 * Google does not participate. Google is reached by verifying the property in Search
 * Console and submitting the sitemap there, which needs the shop's own Google account and
 * therefore cannot be done from here. This covers everyone else, today, for free.
 *
 * Ownership is proved by hosting the key as a text file at the site root, which is why
 * `apps/web/public/<key>.txt` exists and contains exactly the key and nothing else. If that
 * file stops being served, submissions are rejected — so the check below runs first and the
 * script refuses rather than reporting a success the engines will discard.
 *
 *   node scripts/submit-indexnow.mjs
 */

const KEY = '2d9153fccb3a1376d0b1ba869b30c608';
const HOST = 'resetmen.in';
const ORIGIN = `https://${HOST}`;

/** Read from the live sitemap, so this cannot drift from what the site actually publishes. */
async function urlsFromSitemap() {
  const response = await fetch(`${ORIGIN}/sitemap.xml`);
  if (!response.ok) throw new Error(`sitemap.xml returned ${response.status}`);

  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

async function assertKeyIsServed() {
  const url = `${ORIGIN}/${KEY}.txt`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} — submissions would be rejected`);
  }

  const body = (await response.text()).trim();
  if (body !== KEY) {
    throw new Error(`${url} does not contain the key (got ${body.slice(0, 40)})`);
  }
}

const [, , ...args] = process.argv;

try {
  await assertKeyIsServed();
  console.log(`key file verified at ${ORIGIN}/${KEY}.txt`);

  const urlList = args.length > 0 ? args : await urlsFromSitemap();
  console.log(`submitting ${urlList.length} url(s):`);
  for (const url of urlList) console.log(`  ${url}`);

  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList }),
  });

  // 200 accepted, 202 accepted but the key is still being checked. Both are fine.
  if (response.status === 200 || response.status === 202) {
    console.log(`\nIndexNow accepted the submission (HTTP ${response.status}).`);
  } else {
    console.error(`\nIndexNow returned ${response.status}: ${await response.text()}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
