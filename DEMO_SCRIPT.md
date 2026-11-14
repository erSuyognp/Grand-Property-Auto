# Demo script (2 minutes, live)

Setup before the judges arrive: `npm run demo`, open http://localhost:8787 in Chrome, full screen (F11), Houston selected, sound on. Phone on the same wifi (or the laptop's hotspot) with the camera app ready. Have the title screen showing.

If the wifi is bad: everything below still works. Voice falls back to typing (press T), missions use the local parser, tours fall back to the built in viewer. If something goes badly wrong, press 0 and let demo mode drive while you talk.

## 0:00 The problem (title screen on the big screen)

"Every home search starts the same way. A form. Beds, baths, price, a list of results. The keynote called it the funnel: you narrow, you scroll, you click, and you never get a feel for the place. Nobody shops for a neighborhood from a spreadsheet. So we built the opposite. This is Grand Property Auto."

## 0:15 Scan to play (phone)

Scan the QR code. The phone becomes the controller and the game starts on its own.

"That is a real neighborhood in Houston. The ground, the buildings and their heights, the trees and the pools all come from Vexcel's aerial data. Every marker is a real home from CoStar's listings. Green is for sale, blue is for rent, purple is an apartment community."

Tilt to drive a few seconds.

## 0:30 Voice mission (hold the mic on the phone)

Say: **"Three bedrooms under 900K with a pool."**

"I did not fill in a form. The matches light up, the rest dim, and a gold line takes me to the best one. And 'with a pool' does not mean the listing said pool. It means a pool the aircraft actually saw."

Drive the gold line. When the narration plays, let it finish.

## 0:55 The card

"The top half of this card is what the agent wrote. The bottom half is what we can see from above: tree cover, solar, a park three hundred meters away. And these are real aerial photos of this exact house."

## 1:05 Walk inside (tap Walk inside, or say "take me inside")

"From the curb to the living room. This is the real Matterport scan of this home." Walk two or three spots. Tap **See it empty**. "Same room, furniture removed, so you can picture your own."

Exit. Thumbs up.

## 1:30 A conversation, not a funnel

Say: **"Something cheaper."** Then, without waiting long: **"Closer to a park."**

"That is the part a form cannot do. I react to a home I just walked through, and the search follows me. Cheaper than that one. Closer to a park, which the aerial search found, not a tag somebody typed."

If there is time, say **"More like this one"** at the next home: "That is a visual search over the aerial imagery. It finds homes that look like this one from the sky."

## 1:50 Saved homes (press Tab)

"Everything I liked, side by side, cheapest first. That is the shortlist a buyer takes to an agent. No form, no chat window. You drive, you talk, you walk in."

## Who cares about which part

| Judge | Show them |
|---|---|
| **Vexcel** | The city is built from their data with no map provider. Roofs match the aerial photo. Pool, solar and tree badges on the card. Angled aerial photos of each home. "Closer to a park" and "more like this one" run on their visual search. Top down view (C) to show alignment. |
| **Matterport** | The walk inside moment, room names in the overlay, See it empty, the phone walking you between rooms, and the T key that switches between their viewer and ours. |
| **CoStar data platform** | Homes, rentals, apartment communities with floor plans and rent ranges, recently sold homes, commercial buildings as scenery cards. Listing text and aerial facts joined on one card, and the game pointing out where they disagree. The saved homes compare. |
| **Everyone** | No search box and no chat window. Voice first, phone as the controller, and follow ups that depend on the last home you saw. |

## Every line the demo uses (the local parser handles all of these offline)

- three bedrooms under 900K with a pool
- something cheaper
- something with a bigger yard
- closer to a park
- find me more like this one
- show me apartments under 2500 near a park
- take me inside
- see it empty
- save this one
- show me everything
