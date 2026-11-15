# Demo script (2 minutes, live)

Setup before the judges arrive: `npm run demo`, open http://localhost:8787 in Chrome, full screen (F11), Houston selected, sound on. Title screen showing. Check the bottom right says ULTRA and the fps is near 60.

What happens on Enter: the film bars open, the camera drops to the car and "Welcome to Houston" shows at the left for about five seconds with the counts of what is on the market. Talk over it or wait for it. While you drive, the nearest homes carry their price above the marker; after a search only the lit homes do.

If anything goes wrong: press `0`. Demo mode drives this whole script by itself while you talk. If the wifi drops, everything below still works: Maya switches to her scripted lines and the browser voice, and voice input falls back to typing (`T`).

The order puts the most useful things first: what it costs, what it's worth, what living there is like.

## 0:00 The problem (press 0 once, or just say it over the title screen)

Demo mode opens on a page of flat listings scrolling by.

"Every home search looks like this. A price, a bed count, 'charming, must see'. A listing tells you the price. It doesn't tell you what it costs to live there, or what it's like. So we built the opposite. This is Grand Property Auto."

## 0:12 Say what you want (hold V)

Say: **"Find me a three bedroom under 900K near a park."**

"No form. The matches light up, a gold line takes me there. That's a real Houston neighborhood from Vexcel's aerial data, and every marker is a real CoStar listing."

Drive the gold line (or let demo mode drive).

## 0:30 The reveal (press E at the home, or click any marker)

The camera lifts, walk time rings spread out, the nearest grocery, school, park and transit stop pop up with routes and minutes, solar panels drop onto the roof.

"This is the part a listing can't show. Five, ten, fifteen minute walk rings. The real nearest supermarket, four minutes on foot. Panels on the actual roof, and what they'd save a year."

## 0:45 What it really costs (the panel on the right)

Point at **Price and value**, then **True monthly cost**.

"CoStar comps: here is how this home is priced against similar homes nearby, per square foot. And here's the number nobody shows you: the true monthly cost. Loan at this week's Freddie Mac rate, the listing's own property tax, insurance, HOA, the electric bill. Next to it: what a similar apartment rents for two blocks away, from CoStar's apartment data."

Click **3.5%** down, then the **i** button.

"Every card has an i. Source, date, how we got it. Anything we calculated says Estimate."

## 1:05 Maya (hold V)

Say: **"Is this a good deal, and is there a better fit for the money?"**

Maya answers out loud with numbers, the matching card flashes, and three alternatives appear.

"That's Maya. She's Claude with tools that only read our local data, so she can't make a number up. She's honest about the downside, and she follows fair housing rules: ask her who lives here and she'll tell you about the place instead."

Say: **"Yes, take me there."** The route starts.

## 1:25 Walk inside and measure (E, then R)

At the second home press `E` twice. "From the curb to the living room: the real Matterport scan." Press `R`, click two points on a wall. "There's the wall, in feet and inches. My sofa fits."

Press `Esc`.

## 1:40 A client mission (press I)

Open the inbox, pick **Rent or Buy?**, accept. Select the home whose tracker shows all green checks, press **Submit this home**.

"Missions are real buyer problems. Marcus is tired of paying rent: is there a home he could own for about the same each month? The answer is in the data." Three stars pop.

## 1:52 Compare (Tab)

"My saved homes side by side: monthly cost, value, commute to my own pinned places, risk. Maya's pick, with her reason. And it prints as a one page shortlist."

## 2:00 Close

"Listings tell you the price. Grand Property Auto tells you what it's like to live there, and what it really costs. Thank you."

## If there is time for questions

- **Can I afford it?** Press `P`, type an income. Every marker gets a ring: comfortable, a stretch, out of range.
- **My places.** Press `O`, pin work. The rings switch to weekly drive time.
- **Risk.** Open the Risk card on any Houston home near the bayou: FEMA risk rating, flood zone, insurance pressure.
- **Sun.** Drag the time of day slider on the Energy card.
- **Same money, other city.** Ask Maya: "what does the same money get in Los Angeles?"
- **Where do the numbers come from?** `INSIGHTS_REPORT.md` lists every source; `docs/SCORES.md` has every formula.

## Keys

`W A S D` drive · `E` select, then walk inside · `,` `.` step through homes · `V` talk to Maya · `B` better options · `F` save · `Tab` compare · `I` clients · `P` budget · `O` my places · `U` settings · `H` sources · `[` `]` down payment · `Y` solar · `R` tape measure (inside) · `M` map · `C` camera · `N` mute · `0` demo mode
