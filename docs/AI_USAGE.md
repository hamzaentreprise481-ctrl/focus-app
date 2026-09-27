# AI usage, cost guard and budget design

## What is recorded (implemented)

Every analysis request writes one row to `public.ai_usage_events` through
`focus_record_ai_usage` (migration `20260927100000`) and one JSON log line
`{"event":"focus.ai_usage", …}`:

| Field | Meaning |
| --- | --- |
| `model`, `reasoning_effort` | model used; effort sent (`FOCUS_AI_REASONING_EFFORT`, default `low`) |
| `outcome` | `errors_found`, `no_error_observed`, `insufficient_evidence`, `reused`, `model_error`, `timeout`, `invalid_output`, `persistence_error` |
| `model_called` | false for a reuse of the current result or a copy with no answer |
| `latency_ms` | model call duration (also for failed calls) |
| `input_tokens`, `output_tokens`, `reasoning_tokens`, `total_tokens` | provider usage, null when not reported |
| `rejected_candidates` | findings refused by the FOCUS checks |
| `school_id`, `teacher_id`, `assessment_id`, `analysis_run_id` | attribution |

Never recorded: student identifiers, answers, prompts, model output text,
provider error bodies, keys. Teachers read their own rows, school admins
their school's; nobody can write them directly.

## Emergency guard (implemented)

`FOCUS_AI_HOURLY_LIMIT` (default 150): model calls per teacher in the last
hour, counted from `ai_usage_events` where `model_called` — failed calls
count, reuses do not.

## Cost per school and day

```sql
select school_id, date_trunc('day', created_at at time zone 'Europe/Paris') as day,
       count(*) filter (where model_called) as model_calls,
       count(*) filter (where outcome = 'reused') as reuses,
       sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       percentile_cont(0.5) within group (order by latency_ms) filter (where model_called) as median_latency_ms
from public.ai_usage_events
group by 1, 2 order by 2 desc, 1;
```

Multiply by the provider's current per-token prices for the model in use
(not stored here: prices change).

## Per-school daily budget (design, not implemented)

Needed before more than one school uses FOCUS:

1. `ai_school_budgets(school_id primary key, daily_token_limit integer,
   daily_call_limit integer, updated_by, updated_at)`, written by service
   role only.
2. `focus_ai_budget_reserve(p_assessment_id, p_estimated_tokens)` —
   SECURITY DEFINER: takes a per-school advisory lock, sums today's
   `total_tokens` (Europe/Paris day) plus open reservations, refuses with a
   clear error when the budget would be exceeded, otherwise inserts a
   reservation row. The estimate is the input size plus the maximum output.
3. The server action reserves before calling the model and
   `focus_record_ai_usage` settles the reservation with the real tokens
   (a failed call releases it).
4. The dashboard shows the teacher that the school's daily analysis budget
   is reached, instead of a generic failure.

The advisory lock makes concurrent requests of one school serialise at the
reservation step only; the model call itself is not serialised.
