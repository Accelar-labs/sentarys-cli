# sentarys

The [Sentarys](https://sentarys.com) command line: clip podcasts and links into Shorts, follow the analysis, download 1080p clips and publish or schedule them to your connected social accounts. It uses the Sentarys REST API with your API key, so it works in scripts, CI and AI agents.

```bash
npx sentarys login
npx sentarys import "https://www.youtube.com/watch?v=..." --template podcast --wait
npx sentarys download <projectId> --all --out ./clips
```

Requires Node.js 18.17 or newer.

## Log in

Create an API key at [sentarys.com/settings/api](https://sentarys.com/settings/api) (it starts with `snt_live_`), then:

```bash
npx sentarys login                 # paste the key; it is not echoed
npx sentarys login --key snt_live_...
```

The key is saved to `~/.config/sentarys/config.json` (or `$XDG_CONFIG_HOME/sentarys`), readable only by you. `SENTARYS_API_KEY` in the environment takes precedence, which is handy in CI. `sentarys logout` removes the saved key.

## Commands

| Command | What it does |
|---|---|
| `sentarys credits` | Plan and credit balance |
| `sentarys import <url> [-t template] [--start s --end s] [-w]` | Clip a YouTube, TikTok or Instagram link. Import and analysis start on their own |
| `sentarys upload <file> [-t template] [--no-start] [-w]` | Upload an MP4, MOV or WEBM (up to 512 MB) in 8 MB parts and start clipping |
| `sentarys projects [-n 20]` | Your projects, newest first |
| `sentarys clips [projectId] [-w]` | Status and clips of a project (the latest one when no id is given); `-w` waits until it is ready |
| `sentarys download <projectId> [clipId...] [--all] [-o dir]` | Exports clips in 1080p when needed (free) and saves the MP4 files |
| `sentarys accounts` | Social accounts connected in the app |
| `sentarys post <projectId> <clipId> --to tiktok,youtube -c "caption" [--at ISO]` | Publish now or schedule up to 60 days ahead |
| `sentarys post-status <postId>` | Status and public link of a post |
| `sentarys cancel-post <postId>` | Cancel a scheduled post that has not started |

Add `--json` to any command for machine readable output, and `--help` for its options.

Templates include `podcast`, `viral`, `tiktok`, `reels`, `gameplay`, `webinar`, `highlights`, `memes` and `motivation`.

### Posting

Accounts are connected once in the app ([Settings, Social accounts](https://sentarys.com/settings/social)). `--to` takes network names (`tiktok`, `youtube`, `instagram`, `x`, `linkedin`) or account ids from `sentarys accounts`. TikTok needs `--tiktok-privacy` (`PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR` or `SELF_ONLY`); YouTube takes `--youtube-privacy` and `--title`. Each post gets a request id; pass the same `--request-id` on a retry and Sentarys returns the existing posts instead of posting twice.

## Credits

Clips cost 200 credits per source minute (minimum 1,000), charged when the analysis starts. Edits, exports, downloads and posting are free, and failed jobs are refunded. Pro is US$10 a month with 30,000 credits. Full price list: [sentarys-skills/references/pricing.md](https://github.com/Accelar-labs/sentarys-skills/blob/main/skills/sentarys/references/pricing.md).

## Exit codes

`0` success, `1` error, `2` invalid arguments, `3` not enough credits (nothing charged).

## For AI agents

Agents with MCP support get more tools (editing, dubbing, faceless videos, long edits) through the Sentarys MCP server. Setup for Claude Code, Codex, Cursor, Claude.ai and ChatGPT: [sentarys.com/docs/agents](https://sentarys.com/docs/agents) and [Accelar-labs/sentarys-skills](https://github.com/Accelar-labs/sentarys-skills).

## Development

```bash
npm install
npm test
node dist/src/cli.js --help
```

MIT licensed. Questions: contact@sentarys.com.
