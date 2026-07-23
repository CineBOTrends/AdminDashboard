# CineBOTrends — Admin Dashboard

Admin panel for posting **Box Office Updates**, **Movie News**, and **Movie Reviews** to
the live site. Deploys as-is on Cloudflare Pages.

## Setup

**Login:**
1. Run `node scripts/hash-password.mjs` locally and follow the prompts.
2. Add the 5 printed values as **Production** secrets in Cloudflare Pages →
   Settings → Environment variables, then redeploy.

**GitHub access** (for posting content):
1. Create a fine-grained GitHub personal access token for `CineBOTrends/datacollector`
   only, with **Contents: Read and write** (and **Actions: Read and write** if you want
   the Publish now button), with an expiration date.
2. Paste it into the connect screen after logging in.

## Using it

Posts don't go live instantly — they show up after the next scrape, or immediately if
you click **Publish now**.

Fields (* required), empty ones are just left out:
- **Box Office Updates**: title*, movie, report type, date*, image URL, slug, body
- **Movie News**: title*, date*, image URL, summary, slug, body
- **Movie Reviews**: movie*, rating (0–5), date*, poster URL, summary, slug, body

Slug becomes the post's filename and URL — keep it stable once live. Body: separate
paragraphs with a blank line.

## Notes

- The GitHub token is stored only in your browser's `localStorage`; the login session is
  a signed HttpOnly cookie. Neither is sent anywhere but this site and `api.github.com`.
- To change the admin password later, re-run `scripts/hash-password.mjs` and update the
  Cloudflare secrets.
