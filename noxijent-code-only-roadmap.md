# Noxijent: Code-Only Feature Roadmap

This document contains feature ideas that can be implemented primarily through software engineering work, without requiring paid external services, proprietary infrastructure, or a large operational budget.

The goal is to make Noxijent substantially more capable than a traditional single-agent coding CLI by improving orchestration, reliability, context management, verification, developer experience, and local automation.

---

## 1. Agent Manager / Dynamic Agent Teams

### What it is

Add a first-class manager agent that decomposes a task and dynamically assigns work to specialized agents.

Example:

```text
User
  ↓
Manager
  ├── Explorer
  ├── Architect
  ├── Backend Coder
  ├── Frontend Coder
  ├── Tester
  ├── Security Reviewer
  └── Final Reviewer
          ↓
      Integrator
```

### Why it matters

A static `build` agent is useful, but complex engineering tasks naturally require different roles. The manager should decide which roles are actually needed instead of always spawning the same agents.

### Implementation idea

Create an orchestration layer that supports:

- Task decomposition
- Agent creation
- Agent dependencies
- Parallel execution
- Agent cancellation
- Result aggregation
- Failure recovery
- Final integration

A task should become a dependency graph rather than a simple linear conversation.

---

## 2. Execution Graph / Agent Compiler

### What it is

Convert a natural-language task into an executable task graph before implementation starts.

Example:

```text
"Add OAuth authentication"

Requirement
    ↓
Architecture
    ↓
Database schema
    ├── Google OAuth
    ├── GitHub OAuth
    ├── Session handling
    └── Middleware
            ↓
          Tests
            ↓
       Security review
            ↓
         Integration
```

### Why it matters

LLMs repeatedly deciding "what should I do next?" can cause unnecessary exploration, duplicated work, and poor parallelism.

An explicit graph lets Noxijent:

- Detect dependencies
- Parallelize independent tasks
- Track progress
- Retry failed nodes
- Resume interrupted work
- Visualize execution
- Re-run individual nodes

### Implementation idea

Introduce an internal task graph format:

```ts
type TaskNode = {
  id: string
  description: string
  dependencies: string[]
  agent: string
  status: "pending" | "running" | "failed" | "done"
}
```

---

## 3. Git Worktree Per Agent

### What it is

Give independent agents isolated Git worktrees.

```text
main
├── worktree/architect
├── worktree/backend
├── worktree/frontend
├── worktree/tests
└── worktree/security
```

### Why it matters

Parallel agents modifying the same working directory can interfere with each other.

Worktrees provide:

- File isolation
- Independent branches
- Easier rollback
- Cleaner diffs
- Safer parallel execution

### Implementation idea

Noxijent should automatically:

1. Create a worktree.
2. Assign an agent to it.
3. Let the agent commit changes.
4. Run validation.
5. Review the diff.
6. Merge or discard the worktree.

---

## 4. Checkpoints / Time Machine

### What it is

Automatically create lightweight checkpoints during a task.

```text
Checkpoint 1
Checkpoint 2
Checkpoint 3
Checkpoint 4
```

### Useful commands

```text
Restore checkpoint 2
Diff checkpoint 2 → current
Re-run from checkpoint 3
Discard everything after checkpoint 4
```

### Why it matters

Autonomous coding agents can make large changes quickly. Developers need a reliable way to recover from bad decisions.

### Implementation idea

Use Git commits, temporary branches, worktrees, or local snapshots.

The checkpoint system should expose a simple abstraction regardless of the underlying mechanism.

---

## 5. Project Memory

### What it is

Create persistent, project-specific engineering knowledge.

Example:

```text
Project Memory

Architecture:
- API uses service/repository layers.

Conventions:
- Use pnpm.
- All database access goes through repositories.

Important decisions:
- Redis is intentionally not used for sessions.

Known issues:
- Payment tests require the local mock server.

Deployment:
- Staging uses Docker Compose.
```

### Why it matters

Agents repeatedly rediscover the same facts.

Persistent project memory reduces:

- Repeated repository exploration
- Contradictory implementations
- Forgotten architectural decisions
- Context usage

### Implementation idea

Store memory locally in a structured format and attach evidence to important facts.

---

## 6. Evidence-Based Memory

### What it is

Every important memory entry should include its source and confidence.

Example:

```yaml
fact: "The project uses PostgreSQL"
confidence: 0.99
sources:
  - package.json
  - docker-compose.yml
  - prisma/schema.prisma
```

### Why it matters

Memory should not become an unquestioned source of truth.

New evidence should be able to:

- Increase confidence
- Decrease confidence
- Replace outdated information
- Mark a fact as contradictory

---

## 7. Contradiction Detector

### What it is

Detect conflicts between project instructions, documentation, code, CI configuration, and historical decisions.

Example:

```text
AGENTS.md:
Use pnpm

package.json:
npm scripts

CI:
npm ci

⚠ Possible project configuration conflict detected.
```

Another example:

```text
README:
REST API

Codebase:
GraphQL API

⚠ Documentation may be outdated.
```

### Why it matters

Agents often blindly follow instructions even when the repository itself contradicts them.

### Implementation idea

Before major changes, run a lightweight consistency analysis over:

- AGENTS.md / project instructions
- README
- package configuration
- CI configuration
- source code
- tests
- Git history

---

## 8. Automatic Test / Fix / Verify Loop

### What it is

Make verification a first-class part of every coding task.

```text
Understand
   ↓
Plan
   ↓
Implement
   ↓
Run tests
   ↓
Inspect failure
   ↓
Fix
   ↓
Run tests again
   ↓
Typecheck
   ↓
Lint
   ↓
Review
   ↓
Done
```

### Why it matters

"Code was generated successfully" is not the same as "the task was completed successfully."

### Implementation idea

Add configurable Definition-of-Done rules:

```yaml
done:
  tests: required
  typecheck: required
  lint: required
  build: required
  review: required
```

The agent cannot declare completion while required checks are failing.

---

## 9. Task Replay

### What it is

Record enough structured task state to replay an engineering task.

Example:

```text
Task #1842

Original model: Model A
Replay with: Model B
Replay from: Checkpoint 3
```

### Why it matters

This enables:

- Debugging
- Regression testing
- Model comparison
- Prompt experimentation
- Agent evaluation

### Implementation idea

Store:

- Task specification
- Repository state
- Relevant configuration
- Tool actions
- Checkpoints
- Test results
- Final diff

Do not store private chain-of-thought. Store reproducible execution metadata and concise decision summaries.

---

## 10. Repository Understanding Mode

### What it is

Add a command such as:

```bash
noxijent understand
```

It analyzes an unfamiliar repository without modifying it.

Output:

```text
Architecture
├── API
├── Domain
├── Database
└── Workers

Critical paths
├── Authentication
├── Payments
└── Deployment

Technical debt
├── ...
└── ...

Important modules
├── ...
└── ...
```

### Why it matters

Understanding a large existing codebase is often harder than writing new code.

### Implementation idea

Build a repository map using:

- File structure
- Symbols
- Imports
- Call relationships
- Tests
- Configuration
- Git history
- Documentation

---

## 11. Codebase Knowledge Graph

### What it is

Represent the repository as a graph.

```text
Repository
  ↓
Files
  ↓
Symbols
  ↓
Dependencies
  ↓
Callers
  ↓
Tests
  ↓
Git history
  ↓
Issues / tasks
```

### Why it matters

Instead of repeatedly searching raw text, agents can reason about relationships.

Example:

> If I change this function, what could be affected?

The system can identify:

```text
function
 ├── callers
 ├── tests
 ├── related types
 ├── API endpoints
 └── recent commits
```

### Implementation idea

Start with local static analysis and language-server information. Add semantic indexing as an optional layer.

---

## 12. Context Engine

### What it is

Build a dedicated context-selection layer rather than letting every agent independently search the repository.

Pipeline:

```text
Task
 ↓
Relevant files
 ↓
Relevant symbols
 ↓
Relevant history
 ↓
Relevant tests
 ↓
Context ranking
 ↓
Model
```

### Why it matters

Better context selection can improve quality while reducing unnecessary context.

### Implementation idea

Rank context by:

- Direct dependency
- Symbol relevance
- Recent changes
- Test relevance
- Git history
- User instructions
- Previous task failures

---

## 13. Context Garbage Collector

### What it is

Automatically remove or compress irrelevant context.

Keep:

```text
- Current task
- Current architecture
- Relevant files
- Active failures
- Important decisions
```

Drop or summarize:

```text
- Failed exploration paths
- Irrelevant logs
- Duplicate file contents
- Old tool output
```

### Why it matters

Long-running agents eventually accumulate noise.

A dedicated context lifecycle prevents the agent from becoming less effective as the session grows.

---

## 14. Automatic Issue Reproduction

### What it is

Turn a bug report into a reproducible test case.

Example:

```text
Issue:
"Users are sometimes logged out."

       ↓

Search code
       ↓
Inspect logs
       ↓
Find suspicious path
       ↓
Create reproduction
       ↓
Write failing test
       ↓
Implement fix
       ↓
Run regression test
```

### Expected result

```text
Reproduced: yes
Root cause: race condition
Regression test: added
Fix: implemented
Validation: passed
```

### Why it matters

This turns issue handling into an end-to-end engineering workflow.

---

## 15. Automatic Code Archaeology

### What it is

Use Git history to explain why strange or fragile code exists.

Example:

> Why does this function have this unusual workaround?

Noxijent should inspect:

- `git blame`
- Related commits
- Commit messages
- Changed tests
- Historical documentation

Then provide a concise evidence-based explanation.

### Why it matters

Many production codebases contain intentional-looking "weird" code that exists because of an old bug, compatibility requirement, or production incident.

---

## 16. Red-Team Reviewer

### What it is

After implementation, run an independent agent whose only goal is to find problems.

```text
Coder
  ↓
Implementation
  ↓
Red Team
  ├── Bugs
  ├── Security issues
  ├── Edge cases
  ├── Missing tests
  └── Regressions
```

### Why it matters

The same agent that wrote code is biased toward accepting its own solution.

An independent reviewer provides adversarial validation.

---

## 17. Chaos Testing Agent

### What it is

For suitable projects, create controlled failure scenarios.

Examples:

```text
Kill process
Break network
Slow database
Return malformed API response
Delete cache
Restart service
```

Then verify recovery behavior.

### Why it matters

A system that passes normal tests may still fail under realistic failure conditions.

### Safety requirement

Chaos actions must run only inside an explicitly approved environment such as a local development or dedicated test environment.

---

## 18. Human Attention Optimizer

### What it is

Reduce unnecessary approval prompts and focus human attention on high-risk actions.

Instead of asking about every command:

```text
LOW RISK
- read file
- run local tests

MEDIUM RISK
- install dependency
- modify configuration

HIGH RISK
- delete data
- access secret
- deploy
- modify production resources
```

### Why it matters

Too many approval requests train developers to blindly approve everything.

The goal is fewer but more meaningful interruptions.

---

## 19. Risk-Based Action Policies

### What it is

Give every tool action a risk level.

Example:

```text
read_file       → low
run_tests       → low
git_commit      → low/medium
install_package → medium
network_write   → high
delete_files    → high
deploy          → critical
```

### Why it matters

This provides a foundation for intelligent automation and safer autonomous execution.

### Implementation idea

Make risk policies configurable per repository.

---

## 20. Local Model Routing

### What it is

Route different tasks to different available models.

Example:

```yaml
agents:
  architect:
    model: reasoning-model

  coder:
    model: coding-model

  fast_edit:
    model: local-fast-model

  reviewer:
    model: reasoning-model
```

### Why it matters

Not every task needs the most expensive or capable model.

A router can select based on:

- Task complexity
- Context size
- Latency
- Available local models
- User configuration

### Cost

The routing engine itself does not require a paid service. It can operate entirely on locally configured providers/models.

---

## 21. Model Tournament

### What it is

For difficult tasks, run multiple independent implementations and compare them through tests and review.

```text
Task
 ├── Agent A → Solution A
 ├── Agent B → Solution B
 └── Agent C → Solution C
              ↓
        Independent Review
              ↓
          Integration
```

### Why it matters

Different models and agents can produce different approaches.

The important part is that selection should be based on objective engineering signals such as:

- Tests
- Type checking
- Benchmarks
- Security checks
- Review findings
- Maintainability checks

### Cost consideration

This is most useful as an optional mode because it increases compute usage.

---

## 22. Production-Independent Engineering Feedback Loop

### What it is

For environments where telemetry is already available locally, connect engineering validation to measurable behavior.

Example:

```text
Code change
 ↓
Tests
 ↓
Benchmark
 ↓
Local integration test
 ↓
Compare metrics
```

Possible metrics:

- Runtime
- Memory usage
- Query count
- Test duration
- Build size

### Why it matters

Agents should not optimize only for "tests pass."

They should also be able to detect measurable regressions.

---

## 23. Benchmark Mode

### What it is

Let a repository define repeatable engineering tasks.

Example:

```text
.noxijent/evals/

auth/
api/
database/
security/
frontend/
```

Then run:

```text
noxijent eval
```

Output:

```text
Tasks: 100
Passed: 91
Partial: 6
Failed: 3

Average duration: ...
Average tool calls: ...
```

### Why it matters

This gives Noxijent a project-specific way to evaluate changes to:

- Agents
- Prompts
- Tools
- Context strategies
- Model routing
- Orchestration logic

---

## 24. Definition of Done as Code

### What it is

Make project completion criteria executable.

Example:

```yaml
project:
  checks:
    - test
    - typecheck
    - lint
    - build

security:
  required: true

review:
  required: true

coverage:
  minimum: 80
```

### Why it matters

The agent should not decide by itself what "done" means.

The repository should define the contract.

---

## 25. Background Local Agent

### What it is

Run an Noxijent process locally that can monitor approved tasks.

Example:

```bash
noxijent daemon
```

It can watch:

- Local tests
- Git state
- CI status when configured
- Build failures
- Developer-defined tasks

### Why it matters

This enables automation without requiring a cloud agent service.

### Example

```text
CI failed
 ↓
Analyze logs
 ↓
Create local branch
 ↓
Reproduce
 ↓
Fix
 ↓
Run tests
 ↓
Notify developer
```

---

## 26. Workflow Files

### What it is

Allow reusable engineering workflows.

Example:

```yaml
name: bugfix

steps:
  - understand_issue
  - reproduce
  - write_regression_test
  - implement_fix
  - run_tests
  - security_review
  - summarize
```

### Why it matters

Users should not need to write the same prompt repeatedly.

Workflows turn successful agent behavior into reusable engineering automation.

---

## 27. Agent Profiles

### What it is

Create reusable local agent definitions.

Example:

```yaml
name: security-reviewer

permissions:
  read:
    - "**/*"

permissions:
  write: false

checks:
  - dependency-audit
  - secret-detection
  - auth-review
```

### Why it matters

Specialized agents become reproducible and shareable across projects.

---

## 28. Agent Hooks

### What it is

Allow lifecycle hooks:

```text
before_task
after_task
before_tool
after_tool
on_failure
on_checkpoint
on_complete
```

### Example

```text
on_failure:
  - capture logs
  - create checkpoint
  - notify reviewer
```

### Why it matters

Hooks let developers customize behavior without modifying Noxijent core.

---

## 29. Structured Agent Events

### What it is

Expose machine-readable events for everything important.

Example:

```json
{
  "event": "task.completed",
  "task": "AUTH-42",
  "agent": "backend",
  "duration_ms": 42000,
  "tests_passed": 142
}
```

### Why it matters

This enables:

- Plugins
- Dashboards
- Debugging
- Analytics
- External automation
- Replays
- Evaluation

---

## 30. Agent Flight Recorder

### What it is

Record the structured execution timeline of a task.

```text
TASK #821
────────────────────────────

18:02 Requirement parsed
18:03 Repository indexed
18:04 Architecture created

18:05 Backend agent started
18:05 Test agent started
18:06 Security agent started

18:08 Backend completed
18:09 Tests failed
18:10 Backend retry

18:13 Tests passed
18:14 Security review passed
18:15 Final review passed
18:16 Task completed
```

### Why it matters

When something goes wrong, developers need to know:

- What happened?
- Which agent did it?
- Which files changed?
- Which tools were used?
- Which checks failed?
- How did the system recover?

This is observability for autonomous software engineering.

---

# Suggested Implementation Order

If development resources are limited, implement these in phases.

## Phase 1 — Foundation

1. Git worktrees per agent
2. Checkpoints
3. Structured agent events
4. Definition of Done
5. Automatic test/fix/verify loop
6. Risk-based action policies

## Phase 2 — Intelligence

7. Agent Manager
8. Execution Graph
9. Repository Understanding Mode
10. Context Engine
11. Project Memory
12. Contradiction Detector

## Phase 3 — Reliability

13. Red-Team Reviewer
14. Automatic Issue Reproduction
15. Code Archaeology
16. Task Replay
17. Agent Flight Recorder
18. Benchmark Mode

## Phase 4 — Advanced Orchestration

19. Dynamic Agent Teams
20. Model Routing
21. Model Tournament
22. Workflow Engine
23. Agent Profiles
24. Agent Hooks

---

# Core Product Direction

The central design principle should be:

> **Noxijent should not merely generate code. It should execute, verify, explain, and recover from software-engineering tasks.**

The biggest opportunity is to turn Noxijent into an **open, model-agnostic runtime for software-engineering agents**.

Instead of competing only at:

```text
User → Model → Code
```

Noxijent should own:

```text
Task
 ↓
Planning
 ↓
Execution Graph
 ↓
Parallel Agents
 ↓
Isolated Worktrees
 ↓
Implementation
 ↓
Testing
 ↓
Adversarial Review
 ↓
Integration
 ↓
Checkpoint
 ↓
Verification
 ↓
Completion
```

This direction can be implemented incrementally and largely with code, while preserving Noxijent's existing model/provider flexibility.
