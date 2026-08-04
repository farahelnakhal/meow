##repo struct


```
/
├── apps/
│   └── mobile/ # React Native + TS app
│       ├── app.json
│       ├── eas.json
│       ├── App.tsx
│       └── src/
│           ├── navigation/
│           │   └── RootNavigator.tsx #role routing (parent vs child acc)
│           │
│           ├── screens/
│           │   ├── onboarding/
│           │   │   ├── CreateFamilyAccount.tsx   #basic info, limits (budge, games owned)
│           │   │   ├── AddFamilyMembers.tsx
│           │   │   ├── ParentSurvey.tsx #family profile + skill missions ai
│           │   │   └── MemberInterestQuiz.tsx #per person category quiz
│           │   │
│           │   ├── missions/
│           │   │   ├── MissionFeed.tsx #displays assigned missions
│           │   │   ├── MissionDetail.tsx #mission in detail
│           │   │   ├── MissionHintChat.tsx #UI for hint chatbot
│           │   │   ├── MissionPhotoCapture.tsx #camera + upload flow
│           │   │   ├── MissionRating.tsx #enjoyment rating
│           │   │   └── NearbyLocations.tsx #displays filtered location results
│           │   │
│           │   ├── egg/
│           │   │   ├── EggOpening.tsx
│           │   │   └── AnimalCollection.tsx # <name> species collection + feed screen
│           │   │
│           │   ├── settlement/
│           │   │   └── SettlementBuilder.tsx #design only
│           │   │
│           │   ├── polls/
│           │   │   ├── CreatePoll.tsx #pick from AI suggested options + edit
│           │   │   └── VotePoll.tsx
│           │   │
│           │   └── parentDashboard/
│           │       ├── FamilyOverview.tsx
│           │       ├── EngagementFlags.tsx #private flags
│           │       └── LimitsSettings.tsx # edit budget/geofence/etc
│           │
│           ├── components/ #shared UI
│           ├── hooks/ #useMissions etc
│           ├── services/
│           │   ├── supabaseClient.ts
│           │   └── api/ #typed wrappers around edge function calls
│           │       ├── missions.ts
│           │       ├── verification.ts
│           │       ├── locations.ts
│           │       ├── polls.ts
│           │       └── chatbot.ts
│           ├── store/ #state management (family, member, mission state)
│           └── types/ #shared TS types (Mission etc)
│
├── supabase/
│   ├── migrations/ #Postgres schema
│   │   ├── 0001_families_members.sql #profiles
│   │   ├── 0002_surveys.sql #quizzes
│   │   ├── 0003_family_profile.sql #weigfhed input
│   │   ├── 0004_missions.sql #mission templates + cost tiers
│   │   ├── 0005_mission_assignments.sql #member missions + status
│   │   ├── 0006_mission_submissions.sql #pic refs verification result hash
│   │   ├── 0007_ratings_points_coins.sql #star ratings, points, coins ledger
│   │   ├── 0008_egg_progress_animals.sql #egg unlock state, animal collection
│   │   ├── 0009_settlement.sql #settlement layout/build state
│   │   ├── 0010_polls_votes.sql #voting qs and results
│   │   ├── 0011_pair_interaction_log.sql #which pairs/groups did missions tgt
│   │   ├── 0012_skill_mission_schedule.sql #per parent psychoanalysis mission
│   │   └── 0013_engagement_flags.sql #parent family data
│   │
│   └── functions/ #Supabase Edge Functions
│       ├── _shared/
│       │   ├── geminiClient.ts #Gemini API wrapper
│       │   ├── moderation.ts #content filter for chatbot + character guide
│       │   ├── imageHash.ts  #perceptual hash util for duplicate check
│       │   └── types.ts
│       │
│       ├── generate-family-profile/
│       │   └── index.ts #survey responses -> structured family profile
│       │
│       ├── generate-followup-questions/
│       │   └── index.ts #new survey questions from mission history + ratings
│       │
│       ├── assign-missions/
│       │   └── index.ts  #mission generation engine + pair bias + psycho analyis + budget filtering
│       │
│       ├── verify-mission-photo/
│       │   └── index.ts #gemini CV verification +duplicate photo hash check
│       │
│       ├── mission-hint-chatbot/
│       │   └── index.ts #hint chatbot
│       │
│       ├── locations-near-me/
│       │   └── index.ts #location ranking: raw places API -> geofence filter -> interest filter -> top 2-3
│       │
│       ├── suggest-poll-activities/
│       │   └── index.ts #proposes activity options (profile + season/weather/local) for parent to edit into a poll
│       │
│       ├── tune-economy/
│       │   └── index.ts #scheduled job, adjusts points->egg pace and coins->settlement costs from completion rates
│       │
│       └── engagement-monitor/
│           └── index.ts #scheduled job, scans ratings/activity
│
├── packages/
│   └── shared-types/ #TS types shared between mobile app and edge functions (if using a shared package)
│
└── docs/
    └── decide later lowk
```