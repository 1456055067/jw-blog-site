# jw-blog-site

A modern, sleek technical blog. Built with Astro + MDX + Tailwind CSS, deployed to AWS via S3 + CloudFront (managed by AWS CDK).

## Stack

- **[Astro 6](https://astro.build)** — content-first SSG, ships near-zero JS
- **MDX** — write posts with embedded interactive components
- **Tailwind CSS v4** + `@tailwindcss/typography` — sleek styling, beautiful prose
- **Shiki** — syntax-highlighted code blocks (built into Astro)
- **AWS CDK** (TypeScript) — S3 bucket + CloudFront distribution, infra-as-code

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ (LTS)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured with credentials (only needed when deploying)
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/cli.html): `npm i -g aws-cdk`

If you don't have Node yet on Windows: `winget install OpenJS.NodeJS.LTS`

## Local development

```sh
npm install
npm run dev
```

Open http://localhost:4321.

## Writing posts

Drop a new `.mdx` file into `src/content/blog/`. Frontmatter:

```mdx
---
title: "My new post"
description: "One-line summary for previews and SEO."
pubDate: 2026-05-09
tags: ["aws", "astro"]
draft: false
---

Your content here. You can use **markdown** and `<InteractiveComponent />`.
```

Drafts (`draft: true`) are excluded from the production build.

## Project layout

```
src/
  content/blog/        # your .mdx posts
  content.config.ts    # post frontmatter schema
  layouts/             # page templates
  components/          # reusable UI
  pages/               # routes (file-based)
  styles/global.css    # Tailwind + theme tokens
  consts.ts            # site title, URL, author
infra/                 # AWS CDK app
```

## Comments (Giscus)

Comments are powered by [Giscus](https://giscus.app), which stores them as a GitHub Discussion thread per post. Setup:

1. Push this repo to GitHub and make it **public** (Giscus requires it).
2. Enable **Discussions** on the repo (Settings → General → Features).
3. Install the [giscus GitHub App](https://github.com/apps/giscus) and grant it access to the repo.
4. Visit [giscus.app](https://giscus.app), enter the repo, and copy the four config values from the generated `<script>` snippet.
5. Copy `.env.example` to `.env` and fill in `PUBLIC_GISCUS_REPO`, `PUBLIC_GISCUS_REPO_ID`, `PUBLIC_GISCUS_CATEGORY`, `PUBLIC_GISCUS_CATEGORY_ID`.
6. Restart the dev server. The Comments section appears at the bottom of each post.

The component automatically syncs the Giscus theme with your light/dark toggle. If env vars are missing, the section is hidden in production and shows a small dev-only hint locally.

## Deploying to AWS

First-time-only:

```sh
cd infra
npm install
npx cdk bootstrap        # only once per AWS account/region
```

Every deploy:

```sh
npm run deploy           # from project root: builds Astro, then `cdk deploy`
```

The stack creates:

- A private S3 bucket for the static site
- A CloudFront distribution with Origin Access Control
- An automatic upload of `dist/` on each deploy
- Cache invalidation for `/*` so changes go live immediately

To attach a custom domain, set `DOMAIN_NAME` and `HOSTED_ZONE_ID` env vars before `cdk deploy` — see `infra/lib/blog-stack.ts`.
