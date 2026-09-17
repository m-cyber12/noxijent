# noxijent — بخش ایجنت و هارنس پروژه opencode

این ریپو یک **اسنپ‌شات فیلترشده** از پروژه‌ی [opencode](https://github.com/anomalyco/opencode) است.
فقط فایل‌هایی کپی شده‌اند که به **ایجنت (agent)** و **هارنس (harness)** مربوط‌اند؛
رابط‌های کاربری، وب‌سایت، کنسول ابری، SDK، تست‌ها و READMEهای بی‌ربط منتقل نشده‌اند.

## منبع (upstream)

| مورد | مقدار |
| --- | --- |
| مخزن | https://github.com/anomalyco/opencode |
| شاخه | `dev` |
| کامیت | `5a8335857b0ebec44ef6aa1d52b339cf25c329ca` |
| تاریخ کامیت | 2026-09-17 |
| لایسنس | MIT — فایل [`LICENSE`](LICENSE) عیناً از upstream کپی شده است |

## چه چیزی داخل این ریپو هست

| مسیر | فایل | توضیح |
| --- | --- | --- |
| `packages/core` | ۳۲۶ | **هسته‌ی هارنس**: اجرای سشن (`session/runner`, `session/compaction`, `session/context-epoch`)، ابزارها (`tool/`)، پرامپت و context سیستمی (`system-context/`)، permission، skill، provider، plugin، پایگاه‌داده و migrationها، filesystem و git |
| `packages/opencode` | ۴۰۷ | **خود ایجنت کدنویس**: `src/agent` (تعریف ایجنت‌ها + پرامپت‌های agent)، `src/session` (حلقه‌ی مکالمه، LLM، پرامپت‌ها، compaction، reminder)، `src/tool` (read/write/edit/bash/glob/grep/task/webfetch/…)، `src/permission`، `src/provider`، `src/plugin`، `src/mcp`، `src/acp`، `src/lsp`، `src/skill`، `src/config`، سرور هارنس (`src/server`) و لایه‌ی CLI (`src/cli` — بدون TUI) |
| `packages/llm` | ۵۸ | کلاینت LLM مستقل از provider (پروتکل‌های Anthropic/OpenAI/…، route، tool-runtime) که هارنس از آن استفاده می‌کند |
| `packages/schema` | ۶۶ | قراردادهای پیام، ابزار، ایجنت، permission و رخدادها |
| `packages/plugin` | ۳۹ | API افزونه/هوک ایجنت (`src/v2/effect`, `src/v2/promise`) |
| `packages/protocol` | ۲۴ | قراردادهای HTTP API هارنس |
| `packages/server` | ۳۰ | هندلرهای سرور هارنس (session، agent، message، permission، question، skill، …) |
| `packages/effect-drizzle-sqlite` | ۲۱ | آداپتر sqlite/drizzle که لایه‌ی ذخیره‌سازی هارنس روی آن سوار است |
| `.opencode` | ۳۹ | تنظیمات ایجنت خود پروژه: `agent/` (triage، duplicate-pr)، `command/`، `skills/` (effect، rtl-aware-development)، `tool/`، `plugins/`، `glossary/`، `opencode.jsonc` |
| `AGENTS.md` | — | دستورهای ایجنت/مشارکت‌کننده‌ی پروژه (شامل قواعد کد ایجنت) |
| `CONTEXT.md` | — | سند طراحی هارنس: واژگان و معماری session runtime / system context |
| `packages/opencode/specs` | — | اسناد طراحی داخلی ایجنت و ران‌تایم (`effect/`, `v2/`) |
| `tools/` | ۲ | اسکریپت همگام‌سازی و ثبت کامیت upstream |

ساختار پوشه‌ها **عیناً مثل upstream** است تا مقایسه‌ی کد با مخزن اصلی ساده بمانَد.

### نقطه‌های شروع پیشنهادی برای خواندن کد

1. `packages/core/src/session/runner/llm.ts` — حلقه‌ی اصلی ایجنت در هسته
2. `packages/core/src/session/prompt.ts` و `packages/core/src/system-context/` — ساخت context و پرامپت
3. `packages/opencode/src/session/llm.ts`, `session/prompt.ts`, `session/processor.ts` — ران‌تایم نسل فعلی
4. `packages/opencode/src/tool/registry.ts` و فایل‌های کنار آن (`*.txt` = توضیح ابزار برای مدل)
5. `packages/opencode/src/agent/agent.ts` + `agent/prompt/*.txt` — ساخت ایجنت‌ها و پرامپت‌های سیستمی
6. `packages/opencode/src/permission/` — مدل اجازه‌دهی ابزارها

## چه چیزی منتقل **نشده** است

- رابط‌های کاربری: `packages/app` (وب), `packages/desktop`, `packages/tui`, `packages/session-ui`, `packages/ui`, `packages/web`, `packages/storybook`, `packages/docs`
- بخش‌های ابری/تجاری: `packages/console` (کنسول، billing، zen gateway)، `packages/enterprise`, `packages/identity`, `packages/stats`, `packages/slack`
- جنبه‌های غیرمرتبط با ایجنت در `packages/opencode/src`: `control-plane`, `account`, `share`, `installation`, `ide` و دستورهای CLI مربوط به آن‌ها (`account`, `stats`, `web`, `uninstall`, `upgrade`)
- پکیج‌های ابزاری/تولیدی: `sdk`, `sdk-next`, `client`, `codemode`, `http-recorder`, `httpapi-codegen`, `script`, `infra`, `nix`, `containers`, `artifacts`, `github`, `sdks`, `perf`, `patches`
- **همه‌ی تست‌ها**: هر پوشه‌ی `test/`, `tests/`, `e2e/`, `fixtures/` و فایل‌های `*.test.ts` / `*.spec.ts`
- READMEهای بی‌ربط: `README.md` ریشه‌ی upstream و تمام `README.<lang>.md`ها، `CONTRIBUTING.md`, `SECURITY.md`, `STATS.md`, `screenshot-uk.png` و همچنین READMEهای هر پکیج

## نکته‌های مهم

- این کد **یک چک‌اوت کامل و build-able نیست**؛ چون UIها/SDK/تست‌ها حذف شده‌اند، بعضی ایمپورت‌ها به پکیج‌های حذف‌شده (`@opencode-ai/tui`, `@opencode-ai/sdk`, `@opencode-ai/console*`, `@opencode-ai/codemode`) در این اسنپ‌شات resolve نمی‌شوند. برای build واقعی باید با upstream کامل کار کرد.
- لایسنس پروژه MIT است؛ در استفاده‌ی مجدد، فایل `LICENSE` و اشاره به upstream را نگه دارید.

## همگام‌سازی مجدد با upstream

```bash
# از کامیت پین‌شده‌ی داخل script کلون می‌کند
tools/sync-opencode.sh

# یا از یک چک‌اوت محلی موجود
tools/sync-opencode.sh --source /path/to/opencode
```

کامیت و تاریخ آخرین همگام‌سازی در `tools/opencode-upstream.txt` ثبت می‌شود.
فهرست فایل‌های ورودی/خروجی همان‌جا در `tools/sync-opencode.sh` تعریف شده است؛
اگر می‌خواهید بخشی کم یا زیاد شود، فقط همان لیست‌ها را ویرایش و اسکریپت را دوباره اجرا کنید.
