# Security & Privacy

Pare is a **local-first** personal finance tool. All financial data stays on your machine — there are no network calls, telemetry, or cloud sync.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** Email the maintainer
directly at **bauer.s22@gmail.com** with a description and steps to reproduce.
You'll get an acknowledgement, and fixes are coordinated before public
disclosure.

## What is sensitive (never committed)

| Path / pattern | Contents |
|---|---|
| `data/pare.db` | Parsed transactions, personal category rules (e.g. e-transfer handles), manual overrides |
| `data/user-rules.json` | Persisted user-defined category rules (survives DB wipes) |
| `*.pdf` | Bank / credit-card statement PDFs |
| `transactions.csv` | Exported or legacy CSV transaction data |
| `*.xlsx` / `*.xls` | Spreadsheet exports |
| `report.html` | Generated spending reports |
| `data/` (entire directory) | All runtime data — DB, backups, exports |

All of the above are listed in `.gitignore` and must never be tracked.

## Design rules that keep PII out of source

1. **No personal identifiers in `lib/` or `app/`.** No real names, account numbers, transit numbers, e-transfer handles, or other PII hardcoded in any tracked file.
2. **Personal rules live only in the gitignored DB.** Category rules that reference private info (e.g. a rent e-transfer handle) are added via the `/categories` UI and stored in `data/pare.db` + `data/user-rules.json` — both gitignored.
3. **Real PDFs live outside the repo.** Statement PDFs belong in the parent directory (`../`), which is *not* a git repository. Never `git init` the parent folder.
4. **No telemetry or network calls.** The app makes zero outbound requests. All parsing and categorisation happens locally.
5. **Tests use synthetic fixtures only.** Test data must be fabricated — never copy real transaction descriptions or amounts into test files.

## Pre-publish checklist

Run these three commands from the repo root. **Each should print nothing.** If any produces output, fix it before pushing.

```bash
# 1. No sensitive files tracked
git ls-files | grep -iE '\.(db|pdf|csv|xlsx)$|^data/'

# 2. No personal identifiers in source (replace placeholders with your real values)
git grep -niE '<your-etransfer-handle>|<your-account-number>|<your-transit-number>|<your-surname>'

# 3. No sensitive files in any past commit
git log --all --oneline -- 'data/*' '*.db' '*.pdf' '*.csv'
```

## Scrubbing already-committed sensitive data

If a sensitive file was committed but not yet pushed:

```bash
git rm --cached <file>        # unstage
echo '<file>' >> .gitignore   # prevent re-add
git commit -m "remove tracked sensitive file"
```

If the file exists in **pushed history**, the data is considered exposed:

1. Rewrite history with [git filter-repo](https://github.com/newren/git-filter-repo) or [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) to strip the file from all commits.
2. Force-push the cleaned history.
3. **Treat any exposed account numbers, transit numbers, or e-transfer handles as compromised** — contact your bank to rotate or monitor them.
4. Ask all collaborators to re-clone (their local copies still contain the old history).
