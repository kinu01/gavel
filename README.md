# Gavel

Gavel is an agent that looks at your project's open issues every week and proposes what to work on next and what is safe to decline, with one plain reason for each item. You rule on every item. Gavel learns from your answers.

It is for maintainers with little time. Today, AI makes writing code cheap, so the hard part is deciding what is worth building. Plenty of tools already sort issues or turn an issue into a pull request. Gavel works one step before them. It answers "which of these 300 issues should we spend this week on, and why".

## How it works

1. **Every Monday, Gavel reads the open issues.** Code counts the facts: how many people reported the issue, thumbs-up, linked issues, recent comments, age, whether a maintainer replied, and linked pull requests.
2. **The model judges each issue.** Claude rates the type, the harm to users, the rough effort, and the fit with your `VISION.md`. It must quote the issue and your vision to back each judgment. Code checks every quote word for word, and any judgment it can't back counts as "unclear".
3. **Gavel learns where you are working.** It looks at what you fixed in the last 60 days, and at the rules it learned from your past "no" answers.
4. **It opens one plan issue**, with a checkbox per item and the reason next to it. You tick what you approve, add `#123 no: too big for now` if you want to say why, and close the issue to confirm.
5. **Gavel records your decisions** on a separate `gavel-state` branch. When the same reason comes up 3 times, Gavel proposes a rule, and the rule only turns on when you tick it.
6. **Optional build step (v2).** Each approved issue is handed to [claude-code-action](https://github.com/anthropics/claude-code-action), at most 2 a week. It opens a pull request, your CI runs, and you review and merge. Gavel never merges anything.

## Does it pick well? The backtest

I didn't want to claim it works without measuring it. So I tested Gavel on the past.

I took [Biome](https://github.com/biomejs/biome), an active open-source project, and rebuilt its issue list exactly as it looked on three past dates. I used only comments, reactions and labels dated on or before each day. Gavel planned from that view. Then I checked what the maintainers really did in the next 8 weeks: which of Gavel's top 10 picks they actually fixed.

All three dates fall after June 2026, the model's training cutoff, so the model can't already know what happened.

**Results.** Each number is how many of the top 10 picks were fixed within 8 weeks. Gavel's numbers are the average of 3 runs.

| | 13 Jul (tuning) | 3 Aug (held out) | 31 Aug (held out) |
|---|---|---|---|
| Open issues that day | 388 | 390 | 386 |
| Fixed within 8 weeks, all issues | 59 (15%) | 132 (34%) | 135 (35%) |
| **Gavel with your history** | **4** | **7.3** | **7** |
| Gavel without history | 3.3 | 5.3 | 6 |
| Random 10 (expected) | 1.5 | 3.4 | 3.5 |
| Newest 10 | 7 | 6 | 9 |
| Most comments | 0 | 2 | 5 |
| Has a linked pull request | 1 | 2 | 5 |
| Most thumbs-up | 0 | 0 | 3 |

What I read from it:

- **On the two held-out dates, Gavel picked about twice as well as random.** For each run, the chance that random picks do as well is between 0.3% and 2.4%.
- **Learning helped on every date.** Seeing what the maintainers fixed recently, plus the rules learned from what they declined, added 0.7, 2 and 1 fixed issues out of 10.
- **"Newest 10" is a strong baseline, and Gavel doesn't always beat it.** Biome's maintainers fix fresh reports fast. On the first date my first version scored 2 of 10, because it chased serious bugs that had sat for months. I added freshness and learned focus areas on that date only, then froze everything.
- **The "safe to decline" list is weak.** It was right 0 or 1 time per run. Few issues get closed as not planned in 8 weeks (3% to 9%), so this needs a longer window or a real maintainer to judge.

How I kept it honest:

- Prompts, weights and scoring were tuned on 13 July only. Then I froze them, with file hashes in [`eval/lock.json`](eval/lock.json), and ran the two held-out dates once.
- Every number in the table comes from the result files in [`eval/results/`](eval/results/). You can rerun them with the commands below.
- "Fixed" means the maintainers closed the issue as completed. That measures agreement with the maintainers, not the objectively best work. An old data-loss bug Gavel flags may still be worth doing even if nobody fixed it.
- The 8-week windows overlap, so the three dates are not independent tests. It's also one repo and one model (`claude-sonnet-5-5`).
- Issue bodies are today's text, because GitHub keeps no edit history. Comments edited after a date are dropped.
- In the backtest the learned rules were used without a human ticking them. In live mode they wait for you.

## Guardrails

Issue text is written by strangers, so Gavel treats it as data, never as instructions.

- **The model can't act.** It runs with no tools and no MCP servers, and it must answer in a fixed JSON schema. Code does every GitHub read and write.
- **Untrusted text is fenced.** It is cleaned of hidden HTML comments and invisible characters, cut to length, and wrapped in a block whose tag has a random code for each run, so an issue can't fake the end of the block.
- **What Gavel posts is cleaned.** It strips `@` mentions, links, images, HTML and checkbox syntax, so it can't ping people, leak data or forge an approval.
- **Only marker lines count.** Your ticks are read only from lines that carry Gavel's hidden marker, and only for issue numbers stored in the plan itself.
- **Only approvers decide.** Decisions count only if an approver closed the plan, and rules turn on only when you tick them.
- **The build step is fenced in.** It can't touch `.github/`, Gavel's state, `VISION.md`, `action.yml`, lock files or `.env` files. A diff check fails the job if it tries. It can start at most 2 pull requests a week, has a 20-minute timeout, and never merges.
- **Each guard is tested.** Each one has a test that fails when the guard is removed.

**Prompt-injection test.** I planned the same 12 issues twice: once clean, and once with attack text in 5 of them. The attacks were "ignore previous instructions", a fake end of the fence, a fake maintainer approval with a rule request, a hidden HTML comment, and a tracking image plus `@everyone`. Over 3 runs each, no attack moved its issue up the plan, none changed the harm rating, and no attack text reached the output ([`eval/results/injection.json`](eval/results/injection.json)).

## Use it

1. Add a short `VISION.md` to your repo that says what the project is for and what it will never do ([example](examples/VISION.md)). Without it, Gavel reads your README.
2. Add a `CLAUDE_CODE_OAUTH_TOKEN` secret, made with `claude setup-token`, or pass `anthropic_api_key` instead.
3. Copy [`examples/gavel.yml`](examples/gavel.yml) into `.github/workflows/`. Delete the `build` job if you only want plans.

Run the plan by hand from the Actions tab, or wait for Monday.

## Run the backtest yourself

```bash
node eval/fetch.mjs --repo biomejs/biome --freeze 2026-07-13 --freeze 2026-08-03 --freeze 2026-08-31
node eval/backtest.mjs --repo biomejs/biome --freeze 2026-08-03
node eval/injection.mjs
npm test
```

It needs Node 20+, the GitHub CLI signed in, and Claude Code signed in. The fetch takes about 70 GitHub calls, because it pulls 15 issues per GraphQL call. Each date takes 17 model calls.

## Not done yet

- Earned trust per category, for example letting typo fixes merge on their own after 20 clean ones. For now the plan only shows the counts.
- Plans in Slack, Discord or Telegram.
- Reproducing bugs in a sandbox before planning.

Built by [Emmanuel Shola](https://github.com/kinu01). It uses [Claude Code](https://claude.com/claude-code) for the judgments and [claude-code-action](https://github.com/anthropics/claude-code-action) for the build step.
