// Checkbox gate used by .github/workflows/checklist.yml.
// A pull request can't merge, and an issue can't be closed as completed,
// while any "- [ ]" item is unticked.

// Ticked by the merge itself, so it can't be ticked beforehand.
const EXEMPT = [/Merged through a pull request/i];
const LINKED_ISSUE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

function uncheckedItems(body) {
  const text = (body || '').replace(/<!--[\s\S]*?-->/g, '');
  return [...text.matchAll(/^\s*[-*+]\s+\[ \]\s+(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((item) => !EXEMPT.some((re) => re.test(item)));
}

function formatList(items) {
  return items.map((item) => `- [ ] ${item}`).join('\n');
}

// pull_request: fail the check if the PR or an issue it closes has unticked boxes.
async function checkPullRequest({ github, context, core }) {
  const { owner, repo } = context.repo;
  const number = context.payload.pull_request.number;
  // Read the PR fresh so re-runs see the latest description.
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });

  const problems = [];
  const prItems = uncheckedItems(pr.body);
  if (prItems.length) problems.push(`**This pull request** (#${number})\n${formatList(prItems)}`);

  const linked = [...new Set([...(pr.body || '').matchAll(LINKED_ISSUE)].map((m) => Number(m[1])))];
  for (const issueNumber of linked) {
    const { data: issue } = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
    if (issue.pull_request) continue;
    const items = uncheckedItems(issue.body);
    if (items.length) problems.push(`**Issue #${issueNumber}: ${issue.title}**\n${formatList(items)}`);
  }

  if (!problems.length) {
    await core.summary.addRaw('All checkboxes are ticked.').write();
    return;
  }
  const message = `Tick these checkboxes before merging:\n\n${problems.join('\n\n')}`;
  await core.summary.addRaw(message).write();
  core.setFailed(message.replace(/\*\*/g, ''));
}

// issues edited: re-run the check on open PRs that close this issue,
// so ticking boxes on the issue updates the PR status.
async function rerunLinkedPullRequests({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issueNumber = context.payload.issue.number;
  const prs = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 });

  for (const pr of prs) {
    const closes = [...(pr.body || '').matchAll(LINKED_ISSUE)].some((m) => Number(m[1]) === issueNumber);
    if (!closes) continue;
    const { data } = await github.rest.actions.listWorkflowRunsForRepo({
      owner, repo, event: 'pull_request', head_sha: pr.head.sha, per_page: 100,
    });
    const run = data.workflow_runs.find((r) => r.path === '.github/workflows/checklist.yml');
    if (!run) continue;
    if (run.status !== 'completed') {
      core.info(`Run ${run.id} for PR #${pr.number} is still in progress`);
      continue;
    }
    await github.rest.actions.reRunWorkflow({ owner, repo, run_id: run.id });
    core.info(`Re-ran checklist for PR #${pr.number}`);
  }
}

// issues closed: reopen an issue closed as completed with unticked boxes.
// Closing as "not planned" or "duplicate" is allowed.
async function guardIssueClose({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue = context.payload.issue;
  if (issue.state_reason && issue.state_reason !== 'completed') return;

  const items = uncheckedItems(issue.body);
  if (!items.length) return;

  await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: 'open' });
  await github.rest.issues.createComment({
    owner, repo, issue_number: issue.number,
    body: `Reopened: tick these checkboxes before closing this issue as completed.\n\n${formatList(items)}\n\n` +
      'If this issue won\'t be done, close it as **not planned** instead.',
  });
  core.notice(`Reopened #${issue.number}: ${items.length} unticked checkbox(es)`);
}

module.exports = { uncheckedItems, checkPullRequest, rerunLinkedPullRequests, guardIssueClose };
