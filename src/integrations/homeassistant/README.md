# Home Assistant Integration

Exposes ScanIt as a set of MQTT-discovered entities in Home Assistant. Scan buttons, a mode selector, and job status sensors all appear automatically once MQTT Discovery is enabled in HA.

## Requirements

- An MQTT broker (e.g. Mosquitto add-on)
- HA MQTT integration connected to the same broker
- ScanIt `integrations.homeassistant.enabled: true`

See [example config](./scanit.homeassistant.yaml) for a minimal working configuration.

---

## MQTT Topics

All topics are prefixed with `topicPrefix` (default: `scanit`).

### Published by ScanIt (retained)

| Topic | Values | Description |
|---|---|---|
| `{prefix}/status` | `online` / `offline` | Availability (Last Will) |
| `{prefix}/job/state` | `idle` / `scanning` / `hold` / `succeeded` / `failed` | Current job state |
| `{prefix}/job/id` | UUID or `none` | Active/last job ID |
| `{prefix}/job/attributes` | JSON | `{ mode, jobId?, buttonId?, message? }` |
| `{prefix}/job/message` | string | Latest warning/error message, or empty string |
| `{prefix}/mode/state` | `default` / `double_sided` / `endless` | Active scan mode |

`job/state` resets to `idle` (or back to `hold` if a job is still held) after 10 seconds following a `succeeded` or `failed` result.

### Subscribed by ScanIt (commands)

| Topic | Payload | Description |
|---|---|---|
| `{prefix}/button/{buttonId}/command` | `PRESS` | Trigger a configured scan button |
| `{prefix}/mode/command` | `PRESS` | Cycle mode **or** finalize held job |
| `{prefix}/continue/command` | `PRESS` | Append another scan pass to a held job |
| `{prefix}/finalize/command` | `PRESS` | Finalize a held job (dispatch to consumers) |
| `{prefix}/discard/command` | `PRESS` | Discard a held job and delete its pages |

---

## Scan Modes

Modes cycle: **default → double\_sided → endless → default**

| Mode | Behaviour |
|---|---|
| `default` | Scan immediately dispatches to consumers on completion |
| `double_sided` | First press scans front sides; second press (Continue) scans back sides; finalize interleaves pages and dispatches |
| `endless` | Each press appends another scan batch to the same held job; finalize dispatches everything |

### Finalizing a held job

Three equivalent ways to finalize:

1. **Cycle Scan Mode button** — when a job is in hold, pressing this finalizes instead of cycling mode
2. **Finalize Held Scan button** — dedicated button that always finalizes (does nothing if no job is held)
3. Delete the held job instead with the **Discard Held Scan button**

---

## Entities Created via MQTT Discovery

### Sensors

| Entity | Unique ID suffix | Topic |
|---|---|---|
| ScanIt Job Status | `_job_status` | `job/state` + `job/attributes` |
| ScanIt Job Id | `_job_id` | `job/id` |
| ScanIt Message | `_job_message` | `job/message` |
| ScanIt Mode | `_mode` | `mode/state` |

### Buttons

| Entity | Unique ID suffix | Command topic |
|---|---|---|
| *(one per configured button)* | `_{buttonId}` | `button/{buttonId}/command` |
| Cycle Scan Mode | `_mode_cycle` | `mode/command` |
| Continue Held Job | `_continue_job` | `continue/command` |
| Finalize Held Scan | `_finalize_job` | `finalize/command` |
| Discard Held Scan | `_discard_job` | `discard/command` |

---

## Runtime State Persistence

The active mode and any held job context survive server restarts. On startup ScanIt restores the previous mode and re-publishes the held job status if the job is still in `HOLD` state in the database. If the job is no longer held (e.g. deleted while ScanIt was offline) the stale held-job state is cleared automatically.
