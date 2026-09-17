<!-- snapshot notice: this repository is a filtered copy of anomalyco/opencode -->
> ## این ریپو چیست؟
>
> یک **کپی از پروژه‌ی [opencode](https://github.com/anomalyco/opencode)** است که فقط با
> **حذف READMEهای اضافه و تست‌ها** ساخته شده. بقیه‌ی پروژه دست‌نخورده است و مثل خود
> upstream نصب و اجرا می‌شود.
>
> | مورد | مقدار |
> | --- | --- |
> | مخزن اصلی | https://github.com/anomalyco/opencode |
> | شاخه | `dev` |
> | کامیت | `5a8335857b0ebec44ef6aa1d52b339cf25c329ca` (2026-09-17) |
> | لایسنس | MIT (فایل [`LICENSE`](./LICENSE) دست‌نخورده است) |
>
> **چه چیزی حذف شده:** همه‌ی تست‌ها (`test/`, `e2e/`, `*.test.ts`, `*.spec.ts`, snapshots، fixtures)
> و READMEهای فرعی (ترجمه‌های `README.<lang>.md` و README هر پکیج). فقط همین `README.md` باقی مانده.
> هیچ فایل سورس، پرامپت، اسکریپت یا تنظیمی حذف نشده است.
>
> ### نصب و اجرا از سورس
>
> ```bash
> git clone https://github.com/m-cyber12/noxijent.git
> cd noxijent
>
> bun --version        # باید bun 1.3.14 یا بالاتر باشد (نسخه‌ی پین‌شده در package.json)
> bun install          # نصب کل dependencyها (همان lockfile اصلی، --frozen-lockfile هم کار می‌کند)
>
> bun dev              # اجرای ایجنت (TUI) از سورس
> bun dev:web          # اجرای وب‌اپ
> bun dev:desktop      # اجرای اپ دسکتاپ
> bun run typecheck    # بررسی تایپ‌ها
> bun run lint         # لینت
> ```
>
> اگر bun ندارید: `curl -fsSL https://bun.sh/install | bash` (ویندوز: `powershell -c "irm bun.sh/install.ps1 | iex"`).
> برای نصب نسخه‌ی منتشرشده (بدون سورس) هم می‌توانید از `curl -fsSL https://opencode.ai/install | bash`
> یا `npm i -g opencode-ai@latest` استفاده کنید.
>
> نکته: چون پوشه‌های تست حذف شده‌اند، دستورهای `bun test` / `test:*` طبعاً چیزی برای اجرا ندارند؛
> بقیه‌ی دستورها (build، dev، typecheck، lint) بدون تغییر کار می‌کنند.
>
> **تنها استثنا:** فایل‌های `.github/workflows/` (۲۶ فایل CI) در `tools/upstream-workflows/` نگه داشته شده‌اند،
> چون توکن GitHubی که این اسنپ‌شات با آن push شده اجازه‌ی نوشتن در مسیر workflows را ندارد.
> برای برگرداندن‌شان کافی است: `mkdir -p .github/workflows && cp tools/upstream-workflows/*.yml .github/workflows/`
> هیچ فایل دیگری جابه‌جا یا حذف نشده است.
>
> برای همگام‌سازی مجدد با upstream: `tools/sync-upstream.sh` (کامیت فعلی در `tools/opencode-upstream.txt`).

---

<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
