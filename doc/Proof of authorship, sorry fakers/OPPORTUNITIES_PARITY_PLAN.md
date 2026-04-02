<!--
Proof-of-authorship note: Primary authorship and project direction for this planning document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

# Opportunities Parity Plan

Parity With CCP We Can Honestly Reach Using Current Repo + Local Assets, Without Inventing CCP Data: 35%

Current Repo Parity Today: ~10%

## TODO

- Replace the `achievementTrackerMgr` and `milestoneMgr` stubs with persistent tracked state.
- Reconstruct or load opportunity and achievement definitions only from verified CCP data.
- Implement the legacy Opportunities tree, group progression, and reward handling where the client-visible data is complete enough.
- Implement the newer public achievement, category, milestone, reward, and showcase payload families.
- Implement tracked, pinned, completed, and reward-claim notice behavior.
- Add a definition-version and CDN sync path if real achievement-definition payloads become available.
- Add replay tests for legacy tracker contracts, public API payloads, and reward-claim state.

## DONE

- Mapped the legacy Opportunities task-group graph and visible ISK rewards from the CCP client.
- Mapped the legacy tracker payload shape used by the client and seen in local logs.
- Verified the current repo only returns empty completion and event dictionaries for achievement tracking.
- Mapped the newer public achievement, category, milestone, reward, and showcase payload families from the client proto definitions.
- Verified the newer public achievement-definition system is versioned and CDN-backed.
- Mapped the separate `eve_public.opportunity` identifier and event family visible in the client.

## What "Opportunities" Means In The Client

This term is overloaded in CCP client assets.

There are at least three distinct surfaces we have to keep separate:

- legacy Opportunities and achievement-task progression
- newer public achievement APIs
- a separate public `opportunity` identifier and event family

We cannot honestly compress those into one made-up system if we want parity.

## Current Repo State

Current server behavior:

- `server/src/services/character/achievementTrackerMgrService.js`
  - `GetCompletedAchievementsAndClientEventCount -> { completedDict: {}, eventDict: {} }`
  - `UpdateClientAchievmentsAndCounters -> null`
- `server/src/services/character/milestoneMgrService.js`
  - `ProcessCharacterLogon -> null`

Practical meaning:

- the client does not crash on these service calls
- no real task completion, event counts, milestone state, or reward state exists

Local logs confirm the old tracker contract shape:

- `UpdateClientAchievmentsAndCounters({taskID: timestamp}, {eventName: count})`
- `GetCompletedAchievementsAndClientEventCount -> completedDict, eventDict`

## Payload Map

Primary client sources:

- `_local/codeccpFULL/code/achievements/common/opportunityTaskMap.py`
- `_local/codeccpFULL/code/achievements/common/achievementGroups.py`
- `_local/codeccpFULL/code/achievementLoader.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/api/requests_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/api/notices_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/api/events_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/category/api/requests_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/category/api/notices_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/reward/api/requests_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/milestone/api/notices_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/showcase/api/requests_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/definition/api/cdn/requests_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/achievement/definition/version/api/notices_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/opportunity/opportunity_pb2.py`
- `_local/codeccpFULL/code/eveProto/generated/eve_public/opportunity/api/event_pb2.py`

### Legacy Opportunities Groups And Rewards

Visible legacy group IDs include the range `100` through `121`.

Visible reward ladder in the client task map:

- `25,000 ISK`
- `50,000 ISK`
- `75,000 ISK`
- `100,000 ISK`
- `150,000 ISK`
- `200,000 ISK`

Example mining group:

- group `106`
  - `UNDOCK_FROM_STATION`
  - `ORBIT_ASTEROID`
  - `LOCK_ASTEROID`
  - `ACTIVATE_MINER`
  - `MINE_ORE`
  - `REFINE_ORE`

The legacy group graph also contains positions, connections, and activation behavior in `achievementGroups.py`.

### Legacy Tracker Service Payloads

Client-facing contract visible in logs and service names:

- `UpdateClientAchievmentsAndCounters(completedTaskDict, eventCounterDict)`
- `GetCompletedAchievementsAndClientEventCount() -> { completedDict, eventDict }`
- `ProcessCharacterLogon()`

These are old-style task and event-counter surfaces, not the newer public proto APIs.

### Newer Public Achievement APIs

`eve_public.achievement.api.GetRequest`

- `achievement`

`eve_public.achievement.api.GetResponse`

- oneof completion:
  - `completed_date`
  - `not_completed`
- oneof progress:
  - `progress_value`
  - `checklist`
- `reached_milestones[]`
  - `milestone`
  - `reached_date`
  - `category_points_awarded`

Category payloads:

- `eve_public.achievement.category.api.GetRequest`
  - `category`
- `eve_public.achievement.category.api.GetResponse`
  - `score`
  - `reached_milestones[]`

Reward payloads:

- `eve_public.achievement.reward.api.GetUnclaimedRequest`
  - `page`
- `eve_public.achievement.reward.api.GetUnclaimedResponse`
  - `rewards[]`
  - `next_page`
- `eve_public.achievement.reward.api.ClaimRequest`
  - oneof source:
    - `achievement_source`
      - `achievement`
      - `milestone`
    - `category_source`
      - `category`
      - `milestone`
- `eve_public.achievement.reward.api.ClaimResponse`

Showcase payload:

- `eve_public.achievement.showcase.api.GetCharacterScoreRequest`
  - `character`
- `eve_public.achievement.showcase.api.GetCharacterScoreResponse`
  - `score`

### Notice And Event Families

Achievement notices:

- `ProgressedNotice`
- `CompletedNotice`

Achievement events:

- `Pinned`
- `Unpinned`
- `Tracked`
- `Untracked`

Milestone notices:

- `ReachedNotice(achievement, milestone)`

Category notices:

- `ProgressedNotice(category, delta_progress)`

### Definition Versioning And CDN Dependency

The newer achievement-definition system is not purely static in the client.

It includes:

- `eve_public.achievement.definition.api.cdn.GetLatestRequest`
  - oneof:
    - `current_version`
    - `no_local_version_available`
- `eve_public.achievement.definition.api.cdn.GetLatestResponse`
  - `checkpoint`
- `eve_public.cdn.Checkpoint`
  - `url`
  - `version`
  - `crc`
- `eve_public.achievement.definition.version.api.notices.CheckVersionNotice`
  - `version`

This is a major parity blocker because the client expects definition updates to be versioned and externally retrievable.

### Separate Public Opportunity Identifier Family

The client also exposes a separate public opportunity identifier with oneof branches:

- `dungeon`
- `goal`
- `mission`
- `enlistment`
- `storyline`
- `epicarc`
- `daily_goal`
- `freelance_project`

And separate public opportunity events:

- `Viewed`
- `Tracked`
- `Untracked`
- `Completed`
- `Discovered`

## Required Data For Real Parity

To reach real parity, we need:

- the legacy achievement or opportunity definition dataset loaded by `achievementLoader.py`
- the newer public achievement definition payloads and versions
- the exact reward-definition catalog for achievements and milestones
- the exact mapping, if any, between legacy opportunities and newer public achievement identifiers
- the exact gameplay event sources that increment old counters and new progress values

## Missing CCP Data / Hard Blockers

Known hard blockers:

- Missing `res:/staticdata/achievements.static`.
- Missing the actual public achievement-definition CDN payloads.
- Missing the production reward-definition catalog backing public achievement reward claims.
- Missing an authoritative CCP-published mapping between legacy Opportunities and newer public achievement identifiers.

Because of those gaps, 100% Opportunities parity is not honestly reachable from the current repo and local assets.

## Implementation Plan

### Phase 1: Restore Legacy Tracker Integrity

- Replace the empty `achievementTrackerMgr` state with persistent completion and event counters.
- Match the existing service payload contracts exactly.
- Use log-derived request shapes as regression fixtures.

### Phase 2: Restore Legacy Opportunities Where Data Exists

- Rebuild group progression, reward grants, and activation state from verified legacy definitions only.
- Use the client-visible graph layout and reward ladder.
- Do not invent groups, tasks, or transitions that are not present in verified CCP data.

### Phase 3: Add New Public Achievement APIs

- Implement `Get`, category reads, milestone state, unclaimed-reward listing, and claim flows.
- Add tracked and pinned state only after the base definition layer exists.

### Phase 4: Add Definition-Version Handling

- If real definition checkpoints become available, implement the version notice and fetch flow.
- If they do not, keep the newer public achievement surface explicitly partial.

### Phase 5: Keep Legacy And Modern Surfaces Separate

- Do not create a fake one-to-one mapping between legacy Opportunities IDs and public achievement IDs.
- Expose each surface only where the source data proves the relationship.

## Bottom Line

We can restore the legacy tracker contracts and implement substantial scaffolding for newer achievement APIs.

But Opportunities parity is blocked by missing CCP definition files, missing CDN-backed achievement content, and missing authoritative mapping between old and new systems. We can build truthful infrastructure and partial features, not honest 1:1 CCP parity, until those assets exist.
