> **Status: proposed, not yet constituted.** No group members have been appointed and no partner organisations have signed up. This document describes how the project intends to be governed once a pilot starts.

# Kładka governance sketch

Kładka is for Ukrainian-speaking refugees in Poland, so the people who use it should decide what it flags, which letters it helps with and what it does with data. This sketch puts those decisions with an advisory group where refugee users hold the majority. The maintainer builds what the group decides and can't quietly change the rules on data.

## Who sits on the group

Seven seats. Four go to Ukrainian-speaking people living in Poland who have used Kładka. Two go to staff from partner organisations that run it at a desk. One goes to the maintainer, Michal Lip.

Refugee members are found through partner staff and through the tester channels, never through the feedback form, which stays anonymous. Each term lasts 6 months and can be renewed once, so new users keep coming in. Anyone can leave at any time without giving a reason.

Members can stay anonymous in public. Minutes name a member only if that member agrees. No photos of members are published.

## What the group decides

Rule sets. Which mistakes Kładka flags, how strict it is, and how it explains things in Ukrainian. A common example is when to warn that a Polish letter to an office needs the formal "Pan" or "Pani".

Templates. Which kinds of text get guided help next (a tenancy complaint, a school absence note, a reply to a job offer) and what the example phrasing says.

Data policy. What, if anything, the app stores or exports, and any change to it.

Priorities. What gets built in the next quarter, from a list the maintainer prepares with rough effort estimates.

The group doesn't decide code structure or security fixes. The maintainer ships security fixes straight away and reports them at the next meeting.

## How decisions get made

The group meets once a month for an hour, online or at a partner office, in the evening. Meetings run in Ukrainian, with notes in Ukrainian, Polish and English.

Anyone can propose a change. A GitHub issue works, and so does a message in Ukrainian to the maintainer or a word with partner staff, because most users won't have a GitHub account. The maintainer brings every proposal to the next meeting with a short note on effort and risk.

The group tries for agreement first. If that fails, a simple majority of members present decides, as long as at least 4 members are there and at least 2 of them are refugee members.

Data policy has a higher bar. A change needs 3 of the 4 refugee members to agree, then a 30-day public notice in the repo in all three languages before it ships. Any new data feature has to be opt-in, off by default and stored on the device first.

The maintainer can block a decision only for a legal or security reason, and has to explain it in writing in the public decision log.

## Commitments a vote can't change

No text leaves the device unless the user presses a button for that one action, every time.

No accounts. No ads. No selling or sharing data with anyone, including employers, landlords or authorities.

The code and the rule sets stay open source.

These come from why the project exists. Changing any of them would make it a different project, and that needs a new name and a fresh start, not a vote.

## Rule sets and templates in practice

Every change to a rule or template is reviewed by at least one native speaker of the target language (Polish or English) and at least one refugee member. Changes are tested on fictional sample texts only. Real letters from users are never collected for testing. They stay on the user's laptop.

## Keeping BeLikeNative separate

Michal also runs BeLikeNative, a paid writing extension. Kładka has no link to it inside the app, no upsell and no shared data. Rule sets and templates made for Kładka stay under its open-source licence. BeLikeNative can use them only under that same licence, like anyone else, and the group is told when it does.

## Transparency

Each decision goes into `governance/decisions/` in the repo, dated, in Ukrainian, Polish and English, with the vote count and no names unless members agree. The data policy lives in one short file that the app's "What this app stores" screen links to.

## Pay and costs

Before any funding arrives, taking part is voluntary and nobody is promised payment. Once funded, members are paid for meeting and review time at a rate the group sets at its first funded meeting, and travel and childcare costs for in-person meetings are covered.

## During the pilot

Until funding starts, an interim group of at least 3 volunteers meets with the same commitments and the same data-policy bar. The first call happens on 14 November if 3 people have agreed in writing by then. The full seven-seat group forms when the project is funded.

## Why this fits Mozilla's Intentional principle

Kładka is built for one group of people with one kind of problem, and this structure keeps it that way. The people it serves decide what it flags and what it keeps. The things that make it safe to use, like offline processing and no accounts, are fixed in writing rather than left to whoever maintains the code. And every decision is public, in the language of the people it affects.
