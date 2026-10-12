# Contributing

How changes get made in this repository. Every change, however small, goes through an issue, a branch and a pull request.

## The workflow

1. **Start from an issue.** Each piece of work has a GitHub issue with acceptance criteria (checkboxes). If there isn't one, create it from the template first. Move it to **In progress** on the [project board](https://github.com/users/GloryMabunda/projects/1).
2. **Create a branch from an up-to-date `main`**, named after the issue (see [Branch names](#branch-names)):

   ```bash
   git checkout main
   git pull
   git checkout -b feature/12-short-name
   ```

3. **Make the change, with tests.** Follow the [specification](docs/specification.md) and the other docs in `docs/`. Update those docs in the same branch if behaviour changes.
4. **Run the checks locally** before pushing (see [Before you push](#before-you-push)).
5. **Commit and push**, then **open a pull request into `main`** whose description says `Closes #12` (see [Pull requests](#pull-requests)). Move the issue to **In Review**.
6. **Tick the checkboxes.** Every box on the pull request and on the issue it closes must be ticked; the `checklist` check fails until they are.
7. **Merge** once both required checks pass, using **Squash and merge**, and delete the branch. The issue closes itself and moves to **Done**.

## Branch names

`<type>/<issue number>-<short-name>`, lowercase, words joined with hyphens:

| Type | For | Example |
| --- | --- | --- |
| `feature/` | New behaviour or setup | `feature/12-wireframes`, `feature/19-migrations` |
| `fix/` | Fixing a bug | `fix/57-deposit-rounding` |
| `docs/` | Documentation only | `docs/18-database-library` |
| `test/` | Tests only | `test/53-overlap-concurrency` |
| `chore/` | Tooling, dependencies, CI | `chore/22-ci` |

The issue number links the branch to its issue at a glance. A change with no issue (rare, such as a CI fix) leaves the number out: `fix/checklist-rerun-all-runs`.

## Commits

- **Subject:** one line, at most about 72 characters, in the imperative, as if completing "This commit will…": `Add the booking reference generator`, not `Added…` or `Adds…`. No full stop.
- **Body** (after a blank line): what changed and **why**, wrapped at about 72 characters. Mention the issue or business rule where it helps (`BR-2`, `#19`).
- Keep commits focused. Several commits on a branch are fine: they are squashed into one when merged.
- Never commit secrets, a `.env` file, real client data, or files from `uploads/`.

```text
Prevent double-booking with an exclusion constraint

Two overlapping active bookings must never both be saved, even when
requests arrive at the same moment (BR-2). The constraint makes
PostgreSQL reject the second insert with 23P01.
```

## Pull requests

- **Title:** like a commit subject. It becomes the squashed commit on `main`, with the PR number added: `Set up database migrations with Kysely (#121)`.
- **Description:** fill in the [template](.github/pull_request_template.md): what changed, how it was tested, and **`Closes #12`** on its own line. That line links the pull request to the issue, closes the issue when the pull request merges, and tells the `checklist` check which issue's boxes to verify.
- One issue per pull request. If you find other work along the way, open a new issue for it.

### Required checks

`main` is protected: changes only arrive through pull requests, and two checks must pass first.

| Check | Passes when |
| --- | --- |
| **Lint, build and test** ([CI](.github/workflows/ci.yml)) | Lint, the formatting check, the build, unit tests, integration tests and the database types check all pass on a clean machine with its own PostgreSQL |
| **checklist** ([script](.github/scripts/checklist.cjs)) | Every checkbox on the pull request and on each issue it closes is ticked. Ticking a box on the issue re-runs the check automatically. The "Merged through a pull request" box is exempt, since it can only be true after merging. |

An issue closed as completed with unticked boxes is reopened automatically; close it as "not planned" instead if the work was dropped.

The repository owner can bypass these rules in an emergency. Don't rely on it: a bypass skips CI.

## Before you push

Docker Desktop must be running for the integration tests (`npm run db:up`).

```bash
npm run lint
npm run format:check
npm run build
npm run test:all
```

`npm run format` and `npm run lint:fix` fix most formatting and lint problems automatically.

## Project conventions

- **Database:** never edit a migration that has already run. Add a new one with `npm run db:migrate:make -- <name>`, update the tables in `docs/database.md`, then run `npm run db:migrate` and `npm run db:types` and commit the regenerated `src/database/database.types.ts` (CI checks it matches). Queries go through Kysely with values as parameters; raw SQL only through Kysely's `sql` tag, never string concatenation.
- **Configuration:** every new environment variable is added to `src/config/env.ts` (with its rules) and to `.env.example` (with an explanation and no real secret) in the same change.
- **Tests:** unit tests sit next to the code (`src/**/*.spec.ts`) and need no database. Tests that use the database or the whole app go in `tests/integration/` or `tests/api/`, using the helpers in `tests/helpers/`.
- **Website:** pages in `public/` use `<site-header>` and `<site-footer>`, Bootstrap, and the style guide's `--mbg-*` variables, never raw colour codes. See the [style guide](docs/style-guide.md).
- **API:** follow [`docs/api.md`](docs/api.md) for routes, request and response shapes, and error codes.

## Labels and the board

Issues carry a **type** label (`type: feature`, `type: task`, `type: docs`, `type: test`, `type: decision`) and an **area** label (`area: bookings`, `area: payments`, and so on), and belong to a milestone (M0 to M8). The project board columns are **Backlog → Todo → In progress → In Review → Testing → Done**.
