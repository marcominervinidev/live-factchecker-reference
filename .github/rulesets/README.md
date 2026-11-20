# Rulesets

`main.json` is the ruleset for the default branch (PR format spec, section 4): pull requests only, no required approval (the owner authors every PR), squash as the only merge method, linear history, required checks `ci passed` and `pr passed` (the summary jobs of `ci.yml` and `pr.yml`), no deletion or force push.

Apply after the account is on GitHub Pro, either by importing the file in Settings → Rules → Rulesets → New ruleset → Import a ruleset, or with

    gh api -X POST repos/marcominervinidev/live-factchecker-v2/rulesets --input .github/rulesets/main.json

To update an existing ruleset, use `-X PUT repos/.../rulesets/<id>` with the same file.
