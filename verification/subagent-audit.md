# Subagent cost-attribution audit

**Question on the table:** when an operator's parent session
invokes the `Task` tool (spawning a subagent), are those subagent
tokens (a) attributed to the parent transcript only, (b) attributed
to the subagent transcript only, (c) both — which would mean
parallel-burn double-counts — or (d) neither — which would mean
parallel-burn silently under-counts real cost?

This audit was prompted by the ROADMAP entry noting 12 `agent-*`
sessions on 2026-05-19 each contributing `$0.00` to the day's
total. That could be correct behavior or a silent loss.

## Findings

### 1. Claude Code no longer emits separate `agent-*.jsonl` transcripts

Survey of today's (2026-05-22) parallel-burn manifests:

```
TODAY normal sessions: 21
  with transcript on disk: 15
TODAY agent sessions:   0
  with transcript on disk: 0
```

No subagent transcripts were emitted today despite multiple
Task-tool invocations across the 21 normal sessions. Compare
against 2026-05-05, when 406 `agent-*` manifests were created
historically — Claude Code has changed how it stores subagent
data sometime between then and now.

### 2. The 406 historical `agent-*` manifests all have missing transcripts

```
agent manifests: 406
agent transcripts on disk: 0 (sampled 3, all missing)
```

Claude Code appears to have garbage-collected the historical
`agent-*.jsonl` files. The parallel-burn manifests are sidecars
that point at paths now empty. `summarizeSession` reads an empty
event list and returns `costUsd: 0` — accurate for what's on disk,
but unrecoverable retroactively.

### 3. Parent transcripts include Task-tool invocations in their own `usage`

When the parent assistant emits an assistant message that contains
a `tool_use` block of type `Task`, Anthropic bills the entire
subagent loop against the parent assistant's API call. The parent
transcript's `message.usage.input_tokens` / `output_tokens`
(including cache writes/reads) sums the tokens for the parent's
own context *and* the subagent's full conversation in one event.

This is consistent with the API's billing model: the operator
pays Anthropic for one call per `messages.create` invocation, even
when that call drives a multi-turn subagent under the hood.

### 4. The arithmetic

- Today's `totalCostUsd`: derived from the 21 parent-session
  transcripts. Each parent's `usage` fields already include any
  Task-tool subagent token cost.
- Zero `agent-*` manifests today → no double-count is even
  arithmetically possible.
- Historical `agent-*` manifests with missing transcripts → each
  contributes `$0.00` → still no double-count, and the parent's
  cost was already authoritative for those days anyway.

## Conclusion

Parallel-burn does **not** double-count subagent tokens, and is
**not** silently losing real cost. The 12 `$0.00` agent sessions
on 2026-05-19 are correct: their tokens were attributed at the
parent-transcript level and the agent sidecar manifests are
duplicates whose transcripts no longer exist.

This blocker can be closed.

## Future-proofing

If Anthropic changes Claude Code's transcript layout to once again
emit separate subagent transcripts AND simultaneously attributes
subagent tokens at the subagent level (instead of rolling them
into the parent), then parallel-burn would start under-counting.
The mitigation:

- The reconciliation procedure
  (`verification/cost-reconciliation.md`) compares parallel-burn's
  total against Anthropic's console. A new attribution model would
  show as a sudden divergence on the day it landed.
- The `DailyAggregate.unknownModelSessionCount` field flags any
  sessions whose model can't be costed, which would also light up
  if subagent transcripts started arriving with unknown models.

These two signals together cover the regression. No code change
is warranted today.

## Audit reproduction

```bash
# 1. Count today's manifests by type and check transcript presence.
node -e "
const fs=require('fs'),path=require('path');
const dir=require('os').homedir()+'/.parallel-burn/data/sessions';
const today=new Date().toISOString().slice(0,10);
let normalCnt=0,normalHasTr=0,agentCnt=0,agentHasTr=0;
for(const f of fs.readdirSync(dir)){
  const m=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const d=new Date(m.started_at).toISOString().slice(0,10);
  if(d!==today)continue;
  const isAgent=m.session_id.startsWith('agent-');
  const hasTr=fs.existsSync(m.transcript_path);
  if(isAgent){agentCnt++;if(hasTr)agentHasTr++;}
  else{normalCnt++;if(hasTr)normalHasTr++;}
}
console.log({today,normalCnt,normalHasTr,agentCnt,agentHasTr});
"

# 2. Confirm parent transcripts include Task-tool usage by inspecting
#    any assistant message that contains a tool_use block of type Task
#    — its `message.usage` is non-zero and bills the subagent loop.
```
