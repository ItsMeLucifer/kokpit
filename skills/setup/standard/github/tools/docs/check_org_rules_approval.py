#!/usr/bin/env python3
# core: 0.11.0 (Kokpit repo standard, GitHub module)
"""Guard for changes to the non-negotiable rules: a PR or push touching org-rules (and the protection's own files)
without the Owner's approval fails. Run by the workflow .github/workflows/org-rules-guard.yml.

Approval is one of two things (the Owner cannot approve their own PR, so a second route is needed):
  - an APPROVED review from the Owner on the PR's current head commit,
  - the `org-rules-ok` label applied by the Owner (any later push to the PR removes it).
A push to main without a PR is always red: there is nothing to approve, so it is an alarm for manual review.

This is a signal, not a gate. Without branch protection (GitHub Pro) a red result blocks nothing, and an agent
working on the Owner's account can apply the label itself. Description of the protection layers: .claude/org-rules/README.md.

Usage (requires `gh` and GH_TOKEN):
    python3 tools/docs/check_org_rules_approval.py        # event from GITHUB_EVENT_NAME / GITHUB_EVENT_PATH
    python3 tools/docs/check_org_rules_approval.py --self-test   # table of cases on a mock API, no network
"""
import json
import os
import subprocess
import sys

OWNER = os.environ.get("ORG_RULES_OWNER", "")  # the Owner's GitHub login (workflow org-rules-guard.yml)
LABEL = "org-rules-ok"
# A directory ends with a slash (prefix match); a file is matched exactly.
PROTECTED = (
    ".claude/org-rules/",
    ".github/CODEOWNERS",
    ".github/workflows/org-rules-guard.yml",
    "tools/docs/check_org_rules_approval.py",
    "tools/docs/check_docs.py",
    "tools/docs/lock_org_rules.sh",
)
ZERO_SHA = "0" * 40


def gh_api(path, method="GET"):
    """List of objects from `gh api` (one per line thanks to --jq, so it works with pagination)."""
    cmd = ["gh", "api", "--paginate", "--jq", ".[]" if "compare/" not in path else ".files[]", path]
    if method != "GET":
        cmd = ["gh", "api", "-X", method, path]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        if method != "GET" or "404" in res.stderr:
            return []
        raise RuntimeError(f"gh api {path}: {res.stderr.strip()}")
    return [json.loads(line) for line in res.stdout.splitlines() if line.strip()]


def protected_hits(files):
    return sorted({f for f in files if any(f == p or (p.endswith("/") and f.startswith(p)) for p in PROTECTED)})


def file_names(entries):
    names = set()
    for e in entries:
        names.add(e["filename"])
        if e.get("previous_filename"):
            names.add(e["previous_filename"])
    return names


def owner_approval(repo, number, head_sha, allow_label=True):
    """(approved, reason) for a PR: an APPROVED review on head_sha or a label from the Owner."""
    reviews = [r for r in gh_api(f"repos/{repo}/pulls/{number}/reviews")
               if r["user"]["login"] == OWNER and r["state"] in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED")]
    if reviews:
        last = max(reviews, key=lambda r: r["submitted_at"])
        if last["state"] == "APPROVED" and last["commit_id"] == head_sha:
            return True, f"APPROVED review from {OWNER} on {head_sha[:8]}"
    if not allow_label:
        return False, f"new push: label {LABEL} is removed, a new APPROVED review from {OWNER} or re-applying the label is needed"
    events = [e for e in gh_api(f"repos/{repo}/issues/{number}/events")
              if e["event"] in ("labeled", "unlabeled") and (e.get("label") or {}).get("name") == LABEL]
    if events and events[-1]["event"] == "labeled":
        if events[-1]["actor"]["login"] == OWNER:
            return True, f"label {LABEL} applied by {OWNER}"
        return False, f"label {LABEL} was applied by {events[-1]['actor']['login']}, not {OWNER}"
    return False, f"no APPROVED review from {OWNER} on {head_sha[:8]} and no {LABEL} label"


def evaluate(event_name, event, repo):
    """(ok, messages). Reads only the GitHub API; needs no checkout or git history."""
    if event_name in ("pull_request", "pull_request_review"):
        pr = event["pull_request"]
        number, head = pr["number"], pr["head"]["sha"]
        pushed = event_name == "pull_request" and event.get("action") == "synchronize"
        if pushed:  # the label applied to the previous commit; the event list may not reflect its removal yet
            gh_api(f"repos/{repo}/issues/{number}/labels/{LABEL}", method="DELETE")
        hits = protected_hits(file_names(gh_api(f"repos/{repo}/pulls/{number}/files")))
        if not hits:
            return True, ["PR does not touch protected paths."]
        ok, why = owner_approval(repo, number, head, allow_label=not pushed)
        msg = [f"PR #{number} touches protected paths: {', '.join(hits)}", why]
        return ok, msg
    if event_name == "push":
        after, before = event["after"], event["before"]
        if before == ZERO_SHA:  # branch creation: nothing to compare against
            return True, ["Push creates a branch; nothing to compare."]
        hits = protected_hits(file_names(gh_api(f"repos/{repo}/compare/{before}...{after}")))
        if not hits:
            return True, ["Push does not touch protected paths."]
        prs = [p for p in gh_api(f"repos/{repo}/commits/{after}/pulls") if p.get("merged_at")]
        for p in prs:
            ok, why = owner_approval(repo, p["number"], p["head"]["sha"])
            if ok:
                return True, [f"Push from PR #{p['number']} touches {', '.join(hits)}", why]
        return False, [f"Push to main touches protected paths ({', '.join(hits)}) without an approved PR."]
    return True, [f"Event {event_name}: nothing to check."]


def main():
    if "--self-test" in sys.argv:
        return self_test()
    if not OWNER:
        print("::error::ORG_RULES_OWNER (the Owner's GitHub login) is missing in the org-rules-guard.yml workflow.")
        return 1
    name = os.environ["GITHUB_EVENT_NAME"]
    event = json.load(open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8"))
    ok, msgs = evaluate(name, event, os.environ["GITHUB_REPOSITORY"])
    for m in msgs:
        print(f"{'OK' if ok else '::error::'} {m}")
    if not ok:
        print(f"::error::Only the Owner ({OWNER}) approves changes to org-rules: approve in the PR or apply the {LABEL} label.")
        print("Rules and procedure: .claude/org-rules/README.md")
    return 0 if ok else 1


def self_test():
    """Mock gh_api with path-dependent responses; checks the approval rules."""
    global gh_api
    real = gh_api
    deleted = []

    def fake(world):
        def api(path, method="GET"):
            if method == "DELETE":
                deleted.append(path)
                return []
            for key, val in world.items():
                if (key in path) if key == "compare/" else path.endswith(key):
                    return val
            return []
        return api

    def rev(user, state, t, sha):
        return {"user": {"login": user}, "state": state, "submitted_at": t, "commit_id": sha}

    def ev(kind, actor, t=None):
        return {"event": kind, "label": {"name": LABEL}, "actor": {"login": actor}}

    H = "a" * 40
    pr_ev = {"action": "opened", "pull_request": {"number": 7, "head": {"sha": H}}}
    org = [{"filename": ".claude/org-rules/00-core-security.md"}]
    cases = [
        ("PR without protected files", "pull_request", pr_ev, {"/files": [{"filename": "src/x.ts"}]}, True),
        ("PR touches org-rules, no approval", "pull_request", pr_ev, {"/files": org}, False),
        ("Owner approval on head", "pull_request_review", pr_ev,
         {"/files": org, "/reviews": [rev(OWNER, "APPROVED", "1", H)]}, True),
        ("approval on an older commit", "pull_request_review", pr_ev,
         {"/files": org, "/reviews": [rev(OWNER, "APPROVED", "1", "b" * 40)]}, False),
        ("approval from someone else", "pull_request_review", pr_ev,
         {"/files": org, "/reviews": [rev("someone", "APPROVED", "1", H)]}, False),
        ("approval, then CHANGES_REQUESTED", "pull_request_review", pr_ev,
         {"/files": org, "/reviews": [rev(OWNER, "APPROVED", "1", H), rev(OWNER, "CHANGES_REQUESTED", "2", H)]}, False),
        ("label from the Owner", "pull_request", pr_ev,
         {"/files": org, "/events": [ev("labeled", OWNER)]}, True),
        ("label from someone else", "pull_request", pr_ev,
         {"/files": org, "/events": [ev("labeled", "someone")]}, False),
        ("push to PR after the Owner's label", "pull_request", dict(pr_ev, action="synchronize"),
         {"/files": org, "/events": [ev("labeled", OWNER)]}, False),
        ("push to PR with approval on the new head", "pull_request", dict(pr_ev, action="synchronize"),
         {"/files": org, "/reviews": [rev(OWNER, "APPROVED", "1", H)]}, True),
        ("label removed", "pull_request", pr_ev,
         {"/files": org, "/events": [ev("labeled", OWNER), ev("unlabeled", OWNER)]}, False),
        ("rename from an old org-rules path", "pull_request", pr_ev,
         {"/files": [{"filename": "docs/x.md", "previous_filename": ".claude/org-rules/README.md"}]}, False),
        ("the guard workflow itself is protected", "pull_request", pr_ev,
         {"/files": [{"filename": ".github/workflows/org-rules-guard.yml"}]}, False),
        ("push without protected files", "push", {"before": "1" * 40, "after": H},
         {"compare/": [{"filename": "src/x.ts"}]}, True),
        ("direct push to org-rules", "push", {"before": "1" * 40, "after": H},
         {"compare/": org}, False),
        ("push from an approved PR", "push", {"before": "1" * 40, "after": H},
         {"compare/": org, "/pulls": [{"number": 7, "merged_at": "t", "head": {"sha": H}}], "/events": [ev("labeled", OWNER)]}, True),
    ]
    bad = 0
    try:
        for label, name, event, world, expect in cases:
            gh_api = fake(world)
            got, _ = evaluate(name, event, "o/r")
            flag = "ok " if got == expect else "FAIL"
            bad += got != expect
            print(f"  {flag} {label}: {'green' if got else 'red'}")
        gh_api = fake({"/files": [{"filename": "src/x.ts"}]})
        evaluate("pull_request", {"action": "synchronize", "pull_request": {"number": 7, "head": {"sha": H}}}, "o/r")
        reset = any(p.endswith(f"/labels/{LABEL}") for p in deleted)
        print(f"  {'ok ' if reset else 'FAIL'} synchronize removes the label")
        bad += not reset
    finally:
        gh_api = real
    print("Self-test:", "passed" if not bad else f"{bad} failures")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
