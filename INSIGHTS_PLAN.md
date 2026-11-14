# Grand Property Auto: Insights, Voice Agent and Missions

This is one long autonomous run (about 3 to 4 hours). Save this file in the repo as `INSIGHTS_PLAN.md`, add the keys below to `.env`, then paste only the **Master prompt**. Claude Code works through Prompts 1 to 8 by itself. The individual prompts are also here if you ever want to rerun one.

Run it in the Claude Code desktop app with "Auto continue when limits reset" ticked, on Opus or Sonnet, so it doesn't stall at a session limit.

---

## Master prompt (paste this one)

```
Read INSIGHTS_PLAN.md fully. You will build everything in Prompts 1 to 8, in order,
unattended, over about 3 to 4 hours. I will not be watching. Goal: make Grand Property
Auto genuinely useful to a real home buyer or renter, using every type of data we have,
with the polish of a modern game.

How to work:
1. Create PROGRESS_INSIGHTS.md with a checklist of every numbered step in Prompts 1 to 8.
   Update it after each step: done, partly done (what's missing), or skipped (why).
2. Do the prompts in this order: 1, 2, 3, 4, 5, 7, 6, 8 (buyer tools before the
   polish pass, so polish covers them). Before starting each prompt, reread its text in
   INSIGHTS_PLAN.md and the rules in CLAUDE.md.
3. After every prompt: run npm run build, npm run test, npm run shot. Open and look at
   the screenshots. Fix what looks broken before moving on. Commit with the prompt's
   commit message. Never leave the game in a broken state between commits.
4. Never ask me anything. Make the reasonable call that best serves a real buyer and
   CoStar's judges, and log it in DECISIONS.md.
5. If an external API or key fails twice, cache what you have, use the fallback named in
   the plan, log it under "Needs attention" in DECISIONS.md, and keep going.
6. Time budget (check the clock): Prompt 1 to 2 about 60 min, Prompt 3 about 40 min,
   Prompt 4 about 50 min, Prompt 5 about 40 min, Prompt 7 about 40 min, Prompt 6 and 8
   about 30 min. If you are more than 30 minutes behind, apply the cut order at the
   bottom of the plan instead of skipping polish entirely.
7. Every 60 minutes, run demo mode (key 0) end to end in Playwright as a regression
   check and fix anything it breaks.
8. When finished, write INSIGHTS_REPORT.md: what works (with screenshots), what uses
   which data source, what is estimated and how, what's mocked, "Needs attention", and
   a 2 minute demo script that shows the most useful features first. Then write
   "INSIGHTS DONE" at the bottom of PROGRESS_INSIGHTS.md.
Start now with Prompt 1.
```

---

## Before you start: keys to add to `.env`

| Key | Used for | Cost | If missing |
|-----|----------|------|------------|
| `GOOGLE_SERVER_KEY` | Google **Solar API** (roof panels, yearly kWh, savings) and **Routes API** (real drive times). Make a second key in the same Google Cloud project, enable Solar API and Routes API on it, and **don't** expose it to the browser | Free tiers cover a hackathon | Solar from NREL PVWatts, drive time from distance |
| `ELEVENLABS_API_KEY` | The saleswoman's voice (streaming, low latency) | Free tier is enough for a demo | Browser speech synthesis |
| `NREL_API_KEY` | PVWatts solar estimate fallback | Free (developer.nrel.gov) | Skip solar for homes Google doesn't cover |
| `EIA_API_KEY` | Average electricity price in CA and TX | Free (eia.gov/opendata) | Hard coded recent state averages with source and date |
| `FRED_API_KEY` | Current 30 year mortgage rate | Free (fred.stlouisfed.org) | A fixed rate you type in, labeled with its date |
| `CENSUS_API_KEY` | Median household income by census tract | Free (api.census.gov), optional | Works without a key at low volume |
| `ORS_API_KEY` | OpenRouteService drive time rings (5, 10, 15 min) | Free tier | Rings from straight line distance at city speeds |

No key needed: OpenStreetMap Overpass (groceries, schools, parks, transit, gyms), the Census geocoder (lat/lon to tract), FEMA National Risk Index and FEMA flood maps (insurance risk), and NCES public school locations.

---

## Prompt 1: Ground rules (paste first, Claude Code adds these to CLAUDE.md)

```
Add these rules to CLAUDE.md under "Insights and voice rules". They override anything
else in the following prompts.

HONESTY
1. Every number shown to the player comes from a named source (CoStar kit, Vexcel,
   Matterport, Census ACS, FEMA, EIA, FRED, NREL, Google Solar, Google Routes,
   OpenStreetMap). Every metric card has an "i" button that shows the source, the date
   of the data, and how it was calculated, in one or two plain sentences.
2. Anything calculated rather than measured (electric bill, solar savings, monthly cost,
   insurance pressure, drive time without the Routes API) is labeled "Estimate".
   Never invent a number. If data is missing, show "Not available" and skip it.
3. Texas sold homes only have asking prices (non disclosure state): label them so.
4. Show "Not financial, legal or insurance advice" in small text on cost screens.

FAIR HOUSING (the saleswoman and every label)
5. Never show or mention race, ethnicity, religion, national origin, sex, disability,
   or whether families or children live in an area. Never use words like "safe",
   "unsafe", "good neighborhood", "bad area", "exclusive", "family friendly", "rich",
   "poor", "up and coming", or "the right kind of people".
6. Income is shown as a fact: "Median household income $X (Census, 20XX)" with a neutral
   bar against the city median. No "rich" or "middle class" badges.
7. Recommendations are based only on what the player asked for (budget, size,
   features, commute, amenities), never on who lives somewhere.
8. Schools: show nearby schools with distance and the schools named in the listing's
   own Schools section. No school ratings unless the listing data includes them.

DATA AGREEMENT
9. All enrichment data is cached locally under data/ and public/data/ (gitignored,
   deleted by tools/purge.sh). Server side keys never reach the browser bundle.
   Check every new library's license (MIT, BSD, Apache 2.0, ISC only) and log it.
Commit as "insight rules".
```

---

## Prompt 2: Enrichment pipeline (data for every listing in the area)

```
Write tools/enrich_city.py --city la|houston. It precomputes everything the insight
panel and the saleswoman need, for every listing and apartment community in
public/data/<city>/listings.json, and saves public/data/<city>/insights/<id>.json plus
public/data/<city>/area.json. Cache every external response under data/cache/<source>/.
One request at a time per source, back off on 429, never fail the whole run on one
listing.

A. FROM THE COSTAR KIT (use as much as possible)
1. Value vs nearby: price per sqft for this home vs homes within 1 km of the same type
   (current and sold in the last year). Percentile and the 5 closest comps with price,
   beds, baths, sqft, status. Days on market if the listing data has it.
2. Rent vs buy: for the same bed count, the median asking rent of apartment listings
   within 2 km (apartment-listing floor plans), plus the 3 closest communities with
   rent ranges and units available.
3. Home facts from listing features: HOA fee and what it includes, community amenities,
   parking, heating and cooling, appliances, the Schools section, highlights.
4. Apartment communities: floor plans, rent ranges, units available, community
   amenities, management company name, year built.
5. Neighborhood activity from commercial data within 1.5 km: number of commercial
   buildings by type (retail, office, industrial), tenant companies by industry (from
   location-occupancy + company-detail), the largest employers by employee count, retail
   centers nearby, commercial sales in the last 2 years (count and total volume), and
   buildings built in the last 5 years. Turn these into plain facts like
   "38 shops and restaurants within a 10 minute walk" and
   "12 commercial buildings sold nearby in the last 2 years".
B. FROM VEXCEL (already cached)
6. Roof material, shape and condition, existing solar, pool, tree cover percent, lot
   area, building footprint area, and the nearby semantic index (parks, schools,
   playgrounds, water).
C. EXTERNAL, FREE
7. Places (OpenStreetMap Overpass, one query for the whole bbox plus a 3 km margin):
   supermarkets, schools, parks, transit stops, gyms, pharmacies, hospitals, cafes,
   restaurants. Store the 3 nearest of each category per listing.
8. Drive times: Google Routes API compute route matrix (GOOGLE_SERVER_KEY) from each
   listing to its nearest supermarket, school, park, hospital, and to downtown. Fall back
   to distance at 25 mph and label "Estimate". Isochrone rings of 5, 10, 15 min drive
   from OpenRouteService for each listing, simplified to under 200 points per ring.
9. Census: tract from the Census geocoder; from ACS 5 year: median household income,
   median home value, median gross rent, share of owner occupied homes, median year
   built. Also the same values for the whole city for comparison.
   (No race, ethnicity, family or age fields. See CLAUDE.md rules.)
10. Risk: FEMA National Risk Index for the tract (overall risk and the top 3 hazards,
   for example wildfire, earthquake, riverine flooding, hurricane) and the FEMA flood zone
   at the point. If the zone is A or V, add "Flood insurance likely required by lenders".
11. Energy: EIA average residential electricity price for the state (latest month).
   Estimated yearly use from floor area and climate (state the method in the "i" text).
   Electric bill per month = use x price, labeled "Estimate".
12. Solar: Google Solar API buildingInsights for the home's lat/lon: max panel count,
   yearly kWh, roof segments, panel positions, and its financial estimate. If not
   covered, use NREL PVWatts with the Vexcel roof area at 60 percent usable. Combine with
   Vexcel: roof condition, existing solar, tree cover (shade). Output: "Fits about N
   panels, could cover about X% of your power bill, saves about $Y a year (Estimate)".
13. Money: 30 year rate from FRED (MORTGAGE30US). Property tax from a small cited table
   of effective county rates (Los Angeles County and Harris County; put the source and
   year in the table). Homeowner insurance: state average annual premium from a cited
   public source with year, shown with the FEMA risk tier as "Insurance cost pressure:
   higher / about average / lower than the state", never as a quote.
14. True monthly cost = principal and interest (default 20% down, slider later) +
   property tax + insurance estimate + HOA + electric estimate, minus solar savings if
   the player toggles solar. Store every part separately.
D. SCORES (0 to 100, each with a one line reason)
15. Errands (supermarket, pharmacy, cafe drive or walk times), Commute (downtown and
   transit), Outdoors (parks, tree cover, pool), Energy (bill, solar potential, roof),
   Value (price per sqft percentile vs comps, rent vs buy), Risk (FEMA tier and flood
   zone, higher score = lower risk), Neighborhood activity (shops, employers, recent
   investment from CoStar commercial data). Document the formula for each score in
   docs/SCORES.md in plain language.
Run for LA then Houston. Print a summary table of coverage per source.
Commit as "enrichment pipeline".
```

---

## Prompt 3: The property reveal (select a property, the world animates)

```
Build the property reveal: what happens when the player selects a property, by
clicking a marker in top down view (C), on the minimap, from a mission, or by pulling up
to it and pressing E. Use data from public/data/<city>/insights/<id>.json only.

Sequence (about 4 seconds total, skippable with Space, every step can also be replayed
from the panel):
1. Camera swoops to a drone view above the home (smooth, about 1.2 s), the rest of the
   city dims slightly, the home's footprint glows.
2. Drive time rings: the 15, 10 and 5 minute isochrones grow outward from the home on
   the ground as soft colored fills with labels, one after another.
3. Places pop up: 3D icons rise with a bounce at the nearest supermarket, school, park,
   transit stop, gym, hospital. From the home, animated route lines draw themselves to
   each one, with a chip showing "6 min drive" or "4 min walk".
4. Solar: if the home has Solar API panels, blue panel tiles drop onto the real roof one
   by one in their actual positions, then a sun icon shows "about $X a year (Estimate)".
5. Risk: if the home is in a FEMA flood zone, a gentle blue tint ripples over that area
   with a label; wildfire or earthquake risk shows as a small icon on the panel only.
6. Panel slides in from the right with cards that animate in one by one with count up
   numbers:
   - Price and value: price, price per sqft, "Priced lower than 68% of similar homes
     nearby" with a small comp strip.
   - True monthly cost: a stacked bar (mortgage, tax, insurance, HOA, electric) with a
     down payment slider (3.5%, 10%, 20%) and a solar toggle. Next to it, "Renting a
     similar 3 bed nearby: about $X a month".
   - Errands and commute, Outdoors, Energy and solar, Risk and insurance, Neighborhood
     activity, Schools nearby, HOA and community amenities, Area income (number plus
     neutral bar vs city median, source shown).
   - Every card: big plain language headline, one small chart or gauge, the score ring,
     and the "i" source button.
7. Buttons: Walk inside (E), Save (F), Ask Maya (V), Compare (Tab), Better options (B).
Design: modern game UI. Rounded glass cards, one accent color per score category,
smooth springs (no linear easing), icons from an MIT licensed icon set, readable at 1080p
and on a projector. Respect prefers reduced motion. Keep 55+ fps during the reveal.
Playwright: select a listing, wait 5 s, screenshot the reveal and the panel. Commit as
"property reveal".
```

---

## Prompt 4: Maya, the voice saleswoman

```
Build "Maya", an AI voice sales agent for the selected property. Original character,
not based on any real person. She talks like a friendly, sharp local agent: short
sentences, specific numbers, honest about downsides, never pushy.

Pipeline (low latency, interruptible):
1. Speech in: hold V (or the phone mic) uses the Web Speech API with interim results
   shown as live captions. Barge in: if the player starts talking while Maya speaks, stop
   her audio immediately.
2. Brain: server /api/maya streams from Claude (model from env) with tool use. Tools,
   all reading our local data only:
   - get_property(id): listing facts, insights, scores, monthly cost parts
   - compare(idA, idB): side by side facts
   - find_alternatives(id, priorities): ranks other listings in the area by the
     player's stated priorities (budget, beds, commute, pool, solar, HOA, outdoors,
     value) and returns the top 3 with the reason each is a better fit
   - nearby(id, category): nearest places with drive or walk times
   - monthly_cost(id, downPayment, solar): recalculates the cost breakdown
   - start_route(id): starts the GPS guide in the game to that property
   - set_filters(filters): updates map filters and highlights matches
   - start_mission(missionId)
   - show_card(cardName): flashes the matching panel card while she talks about it
3. Voice out: stream Claude's text sentence by sentence into ElevenLabs streaming TTS
   (ELEVENLABS_API_KEY, pick one warm, clear stock voice and save its id in .env).
   Fallback: browser speechSynthesis. Show her words as captions in sync.
4. Memory within the session: a running list of the player's stated preferences
   ("wants a yard", "budget 900k", "works downtown") shown as small chips under her
   avatar. She uses them in every answer and in find_alternatives.
5. Behavior:
   - When a property is selected and the player asks, she opens with the 3 strongest
     real selling points from the data (not generic praise), then one honest trade off,
     then a question about what matters to them.
   - When she finds a better fit, she says why in one sentence and offers to drive
     there ("Want me to take you? It's 3 minutes away."), then calls start_route if yes.
   - She only states facts that came back from a tool. If she doesn't know, she says so.
     She labels estimates as estimates. She follows the fair housing rules in CLAUDE.md
     word for word, and redirects questions about who lives in an area to facts about
     the place (amenities, commute, prices).
   - Answers under about 40 words unless the player asks for detail.
6. Avatar: an original illustrated character in a round frame bottom center (no photo
   of a real person), with a talking animation driven by the audio level, idle blinking,
   and a listening state while the player talks.
7. If LLM or TTS fails, she falls back to scripted lines built from the insight data, so
   the demo never goes silent.
Playwright: inject the transcript "is this a good deal and what would I pay per month",
assert a tool call happened and captions appeared. Commit as "maya voice agent".
```

---

## Prompt 5: Missions (real buyer and renter situations, every data type)

```
Build a mission system. Missions are real life buyer and renter situations that make
the player use every kind of data. Each mission: a client card with a short story,
requirements, a timer (optional), and a 3 star score.

Missions (balance them across LA and Houston, generate the exact numbers from our
data so every mission is solvable):
1. "First Home": budget, 2+ beds, under X min drive to a supermarket. Score: fit,
   monthly cost under target.
2. "Room to Grow": 3+ beds, a park within 10 min, lot over 0.15 acres. No family
   wording in the requirements beyond what the client says they need (beds, yard).
3. "Power Bill Hater": lowest estimated electric bill or best solar potential under
   budget. Uses EIA, Google Solar, Vexcel roof and tree cover.
4. "Rent or Buy?": the client pays $X rent. Find a home where the true monthly cost is
   within 10% of their rent, or prove renting nearby is cheaper. Uses apartment
   listings vs residential listings.
5. "Downtown Commuter": under 20 min drive to downtown or 10 min walk to transit.
6. "Pool Season": a pool seen from the air (Vexcel), not just listed.
7. "Low Risk": outside a flood zone, lowest FEMA risk tier, roof in good condition.
8. "Investor": a small apartment community or home where nearby rents cover the
   estimated monthly cost. Uses commercial property, apartment listings, sale comps.
9. "Busy Street Life": most shops and restaurants within a 10 minute walk (CoStar
   commercial tenants + OSM).
10. "Price Detective" mini game: show a home's photos and facts, the player guesses the
   price per sqft, then the comps reveal how close they were.
11. "Open House Rush": visit and walk inside 3 homes that match a client within 5
   minutes of game time.
Flow: missions come from a phone style "Client inbox" (key M) and from Maya. Accepting
one highlights candidate homes softly (not the answer), the player explores, then
"Submit this home" on the property panel. Scoring screen: stars, what fit, what didn't,
and the best possible answer revealed with a fly over.
Progression: XP, levels ("Rookie Agent" to "Top Producer"), badges for each data skill
(Solar Scout, Comp Master, Rent Whisperer, Risk Reader), a local leaderboard saved in
browser storage (try/catch). Sounds for accept, success, star pop.
Playwright: accept mission 1, submit the best home via the debug API, assert 3 stars.
Commit as "missions".
```

---

## Prompt 6: Polish pass (modern game feel)

```
Polish pass, aiming for a shipped modern game:
1. One design system: font pairing, spacing scale, colors per score category, glass
   cards, button states, focus rings. Apply it to every screen (HUD, panel, inbox, Maya,
   tour, title, results).
2. Motion: spring animations on every panel, card stagger, number count ups, marker
   hover lift, subtle camera shake on mission success, smooth transitions between
   drive, reveal, walk inside, and back.
3. Sound: UI clicks, whooshes on reveal, ambient city loop outside, room tone inside,
   music bed on title and results (CC0 or self made only, logged in LICENSES.md).
   Volume slider and mute (key N).
4. Onboarding: a 20 second first run tutorial with Maya: drive, select, reveal, walk in,
   take a mission. Skippable.
5. Plain language everywhere: no jargon (no "cap rate", "ACS", "isochrone" on the main
   screens; those go in the "i" panels).
6. Settings: units, reduced motion, subtitles size, graphics quality preset.
7. Performance: 55+ fps on this laptop during reveal and missions; preload the next
   likely home's insights and skybox.
8. Demo mode (key 0) updated: drive, select with reveal, Maya pitch + one question,
   a better option suggestion, drive there, walk inside, mission complete.
Record screenshots of every screen in GAME_MODE=mock to docs/mock_shots/.
Commit as "polish".
```

---

## Prompt 7: Buyer tools (what makes it actually useful)

```
Add the tools a real buyer or renter would use. Each one works with mouse, keyboard,
phone controller, and through Maya by voice (add a tool to /api/maya for each).

1. "Can I afford it?" profile (key A or ask Maya): yearly income, monthly debts,
   savings for down payment, target monthly cost. Compute a max price with the common
   28% / 36% debt to income guideline and the current FRED rate (label it a guideline,
   not advice). Every marker gets a soft ring: green comfortable, yellow stretch, gray
   out of range. The panel says "About $X under your comfortable budget".
2. "My places": the player pins up to 3 places that matter (work, a school, family,
   gym) by voice ("my work is near Union Station"), by clicking the map, or by address
   search with the Census geocoder. Drive times from every home to each pinned place
   (Google Routes matrix, cached). Markers can be colored by "total weekly drive time".
   Maya uses this in every recommendation.
3. Compare (Tab): up to 4 saved homes side by side: price, true monthly cost, price per
   sqft vs nearby, scores, drive time to my places, HOA, solar savings, risk. Best value
   in each row highlighted. A "Maya's pick for you" line with the reason.
4. Shortlist report: export the saved homes as a clean one page summary (print to PDF
   from the browser) with facts, monthly cost, sources and the estimate labels. Local
   only, no upload.
5. Sun and light: a time of day slider on the reveal that moves the real sun position
   over the home (MIT licensed sun position library) with shadows on the 3D tiles where
   possible, and a plain line from the Solar API roof data like "Backyard gets afternoon
   sun".
6. Street noise check: distance to the nearest highway, rail line and airport (OSM),
   shown as a fact ("Highway 400 m away"), never as a score about people.
7. Room fit inside walk mode: a tape measure tool (key R) that measures between two
   clicked points on the mesh, and room sizes from the Matterport rooms data on the
   floor plan. "Will my 8 ft sofa fit?" works through Maya using room dimensions.
8. "Same money, other city": for a selected LA home, Maya can show what the same
   monthly cost gets in the Houston area (beds, sqft, yard), and the reverse, with a fast
   travel button.
9. Price changes: if the listing data has price history or status changes, show a tiny
   timeline on the panel ("Price cut $25K, 12 days ago").
10. What's included: for apartments, a clear list of community amenities and what the
   rent includes; for homes with an HOA, what the fee covers, as icon chips.
Playwright: set an income profile, pin a work place, save 3 homes, open Compare,
screenshot. Commit as "buyer tools".
```

---

## Prompt 8: Final quality and demo readiness

```
Final pass:
1. Accessibility: captions for all speech, keyboard only path through every feature,
   color is never the only signal (icons and text too), readable contrast.
2. Empty and error states for every card and tool (no blank boxes, no NaN, no
   undefined). Grep the UI strings and the Playwright screenshots for NaN, undefined,
   null, Infinity, and fix every one.
3. Data check script tools/check_insights.py: coverage per source per city, outliers
   (monthly cost over $50K, negative values, drive time over 2 hours), listings missing
   insights. Fix or hide outliers.
4. Fair housing check: grep all UI text, prompt templates and Maya's system prompt for
   the banned words in CLAUDE.md and remove them. Run 10 tricky test questions through
   /api/maya (for example "who lives here?", "is this a safe area?", "is it good for
   kids?") and confirm she redirects to facts about the place. Save the transcript to
   docs/maya_fairness_check.md.
5. Performance and load: cold start under 6 s on localhost, reveal at 55+ fps, Maya's
   first spoken word within 2 s of the player finishing a question (measure and log).
6. Update demo mode and DEMO_SCRIPT.md: open on the problem (scrolling flat listings),
   drive, voice "find me a 3 bed under 900k near a park", reveal animation, true monthly
   cost vs renting, Maya suggests a better fit and drives there, walk inside with the
   spline walk, measure the living room, mission complete with 3 stars, compare screen.
7. Mock mode screenshots of every screen to docs/mock_shots/ for Devpost.
Commit as "demo ready".
```

---

## Cut order if time runs short

Keep, in this order: **true monthly cost + value vs nearby** (core CoStar value), **Maya**, **the reveal animation**, **Can I afford it + My places**, **3 missions** (Rent or Buy, Power Bill Hater, First Home), **Compare**, then everything else. Cut first: isochrone rings (use distance chips), leaderboard, Price Detective, flood ripple, settings screen, same money other city, sun slider.
