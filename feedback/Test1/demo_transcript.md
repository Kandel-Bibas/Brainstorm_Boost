MEETING TRANSCRIPT
Meridian Technologies — Cross-Functional Product Sync
Date: Wednesday, February 25, 2026
Time: 10:02 AM – 10:33 AM EST
Platform: Zoom (recorded)
Transcribed by: Otter.ai (auto-generated, unedited)

ATTENDEES:
  Sarah Chen       — Head of Product (Meeting Lead)
  Marcus Webb      — Engineering Lead
  Priya Nair       — Senior UX Designer
  Tom Kowalski     — Sales Director
  Aisha Johnson    — Data & Analytics
  Derek Osei       — Backend Engineer
  Rachel Bloom     — Marketing Manager
  James Tran       — Frontend Engineer
  Natalie Russo    — QA Lead
  Kevin Park       — DevOps / Infrastructure
  Linda Morales    — Customer Success Lead

─────────────────────────────────────────────────────────────────────────────

[00:00:08]
SARAH CHEN: Okay, I think— I think most people are on. Let me just do a quick count. Marcus, Tom, Priya, I can see you. Aisha, are you— your video's off, is that intentional?

AISHA JOHNSON: Yeah, sorry, I'm, uh, I'm on the train actually. Bad signal. I can hear everything though.

SARAH CHEN: Totally fine, totally fine. Okay. So, um, let's get moving because I know a few people have hard stops. So we've got a lot to cover today. Uh, the main things are— and I sent the agenda but I know not everyone looks at those— [light laughter] —it's the Helix dashboard timeline, the, uh, the analytics feature decision, and then we need to touch on the Thornfield account situation that Tom flagged on Friday. Cool. Should we just dive in?

MARCUS WEBB: Yeah, let's do it.

TOM KOWALSKI: Works for me.

[00:00:57]
SARAH CHEN: Okay great. So, Marcus, you want to kick off on the dashboard? Because you sent that update last night and I think— I only half read it, I'll be honest— but it sounded like something shifted?

MARCUS WEBB: Yeah, yeah so— [clears throat] —so the short version is we found an issue with the, um, with the way the data layer is talking to the rendering pipeline. And Derek can go into more detail, but basically the— what we thought was going to be a two-day fix turned into something more significant. Derek, do you want to—

DEREK OSEI: Yeah sure. So, um, the problem is essentially that when you have more than— I think it's around four hundred concurrent sessions, the— the cache invalidation logic starts behaving weirdly. Like, it's not a crash, it's more like a— like a silent data staleness issue where users might be looking at numbers that are like, thirty, forty-five seconds behind. Which for most use cases is fine but for the trading desk clients it's— it's a non-starter.

JAMES TRAN: [overlapping] And it's— yeah and it's not— it's not just the cache, right? Like when I was looking at it yesterday the—

DEREK OSEI: [overlapping] Right, yeah—

JAMES TRAN: —the component re-render is also, like, it's basically doing a full re-render on every socket event which is—

DEREK OSEI: Exactly, yeah, so it compounds—

MARCUS WEBB: So together those two things are— it's like a one-two punch, right. Each one alone is probably manageable but together it— it kind of blows up under load.

[00:02:24]
SARAH CHEN: Okay. So what does that mean for the timeline? Because we told Thornfield— I mean, Tom, you told Thornfield—

TOM KOWALSKI: I told them the fifteenth.

SARAH CHEN: Of February.

TOM KOWALSKI: Of February, yeah. So we're, uh— [exhales] —we're already past that.

SARAH CHEN: Right. [pause] Okay. So what are we— what's the new realistic date?

MARCUS WEBB: So, and I want to be careful here because I don't want to give a number that we then miss again, but— Kevin, can you talk about the infra piece because I think that's actually the critical path now?

KEVIN PARK: Yeah so— sorry, I was muted— yeah so the, um, the cloud migration. So we were planning to do that in April but given what Derek just described, it might actually make sense to pull that forward because a chunk of the performance problems we're seeing are, uh, they're infrastructure-shaped. Like, we're still on the old database cluster for that service and moving it to the new setup would probably— I mean I don't want to promise anything—

DEREK OSEI: It'd help, yeah.

KEVIN PARK: It'd help. And I think I can— if I start on it Monday, I can probably have the migration done by the ninth? Eighth or ninth.

MARCUS WEBB: And then James, if Kev's done by the ninth, realistically how long do you need to sort the re-render issue?

JAMES TRAN: I mean I've already got like a— I have a branch with a potential fix. I just need to test it under load. So honestly if the new infra is up, like, two days? Maybe three to be safe.

MARCUS WEBB: And Derek, the cache piece?

DEREK OSEI: Same, two days. We could probably do it in parallel actually.

[00:04:01]
MARCUS WEBB: So that puts us at— roughly the twelfth, thirteenth?

SARAH CHEN: And Natalie, you'd need QA time on top of that.

NATALIE RUSSO: Yeah so— I mean this is the thing, right, we keep compressing QA and then we find things. Like I'm not— I'm not being difficult but I really do need at least three days. And specifically I need to run the full regression on the auth module because we touched that in the last sprint and I haven't had a chance to— like, that's just sitting there.

SARAH CHEN: No, you're right, you're right. Okay so— so if everything goes to plan, which [laughs] —

NATALIE RUSSO: It never does—

SARAH CHEN: —right, but if it does, we're looking at, what— the fifteenth? Of March?

MARCUS WEBB: Yeah, March fifteenth is— I think that's actually defensible. If Kevin starts Monday, James and Derek work in parallel after the ninth, Natalie gets her three days— yeah. March fifteenth.

SARAH CHEN: Okay. Tom, can you work with that? I know it's—

TOM KOWALSKI: [sighs] I mean, I have to, right. I'll talk to— there's a guy at Thornfield, Rob, who I think gets it. It's more his manager who's been— [trails off] —I'll handle it. But I do want something in writing. Like a, a committed date that I can actually show them.

SARAH CHEN: Yeah, of course. I'll— um, I'll send a note to you and CC Marcus after this with the March fifteenth commitment. Yeah.

TOM KOWALSKI: That'd be great.

[00:05:19]
PRIYA NAIR: Can I— sorry, can I jump in on the dashboard stuff before we move on?

SARAH CHEN: Yeah, Priya, go ahead.

PRIYA NAIR: So I've been, um, I've been revising the mockups based on the feedback from the last round of user testing? And there's one thing that I think could actually reduce the performance issue from a product perspective. Like, the current design has all six panels loading simultaneously on mount, but based on what I'm hearing from Derek and James, maybe we should be doing progressive loading? Like, load the two most-used panels first and then lazy-load the rest?

JAMES TRAN: [immediately] Yeah, yeah that's— that's actually a really clean solution for the re-render problem too because—

DEREK OSEI: [overlapping] That would help a lot on the—

PRIYA NAIR: —because users— from the testing, users mostly look at the revenue panel and the activity feed first anyway. The other four panels get like, significantly less eyeball time in the first thirty seconds.

MARCUS WEBB: That's— actually that's a good call. Can you, Priya, can you— can you share the revised mockups so James has the updated spec before he dives into the fix?

PRIYA NAIR: Yeah, I'll— I can have those in Figma by end of today. I just need to finish the edge cases for the empty states.

MARCUS WEBB: Perfect.

[00:06:41]
SARAH CHEN: Okay great. So— okay that's the dashboard. Um— let's go to the analytics feature because I know Rachel and Aisha have been waiting on this one. Aisha, are you still on?

AISHA JOHNSON: Yeah, yeah I'm here. Still on the train but yeah.

SARAH CHEN: Okay so— so the question is basically, do we build the cohort analysis tool in-house or do we integrate with an existing vendor. And we've been going back and forth on this for— it feels like forever.

RACHEL BLOOM: It's been six weeks. [laughs]

SARAH CHEN: Six weeks, yeah. Um— Aisha, do you want to give your take because you're the one who's going to live with this decision the most?

AISHA JOHNSON: Yeah. So I've been— I've kind of gone back and forth on this myself. Like initially I thought build, because we have very specific needs around how we define cohorts, like we use a non-standard attribution window, and I didn't think any vendor could accommodate that. But I actually spent some time last week looking at— um, there's a company called Lattice Data, which is different from the HR Lattice— this is a small company— and they actually have a configurable attribution model and I think we could make it work. And the cost would be— I mean it's not cheap but it's cheaper than— what was Marcus's estimate? Like twelve weeks of engineering?

MARCUS WEBB: Ten to twelve, yeah. And that's being optimistic.

AISHA JOHNSON: Right so— and that's like, that's significant opportunity cost. So I'm, uh, I've kind of shifted to— I think the vendor route might actually make more sense now? But I haven't done a full evaluation.

[00:08:12]
RACHEL BLOOM: Can I say something? Because from marketing's perspective this is— this matters to us too. The roadmap we put out in Q4 said we'd have advanced analytics by mid-year. And our two biggest competitors, Vertex and, uh, and DataPulse, both have cohort analysis now. So the sooner the better, from my side.

TOM KOWALSKI: Same from sales. I've lost— I mean I don't have the exact number but I've lost deals over this. Like, directly. People ask in demos and I have to say, "coming soon," and—

SARAH CHEN: [overlapping] Yeah, no, I know—

TOM KOWALSKI: —and "coming soon" has been the answer for nine months.

SARAH CHEN: I know. I know. Okay so— so I think the read in the room is we want to move faster, and vendor might be the path to do that. Aisha, what would it take for you to feel confident in a vendor recommendation? Like, what do you need to evaluate?

AISHA JOHNSON: I mean ideally I'd want to pull our Q4 cohort data and actually run it through their system. Like a real proof of concept. They said they'd give us a thirty-day trial.

TOM KOWALSKI: Can you do that quickly? Because if you can get me some numbers, even rough, that's— I can use that in conversations.

AISHA JOHNSON: I mean, I can probably pull the data— yeah. I'll need to scope what subset to use but yeah, I can do that. Give me— gimme until early next week?

SARAH CHEN: Okay. So let's say Aisha runs the POC with Lattice Data, we aim to have a read on that by— what are we saying, like March 3rd? 4th?

AISHA JOHNSON: Yeah, fourth is fine.

[00:09:55]
SARAH CHEN: Okay, and budget-wise— Marcus, if we go vendor, what's the budget ballpark we're working with?

MARCUS WEBB: Well we have the forty thousand that was allocated for the in-house build. So technically that's what's available. Whether it's enough for a vendor, I don't know, depends on their pricing.

SARAH CHEN: Aisha, did you get a sense of their pricing?

AISHA JOHNSON: It's seat-based. It was— I think for our usage it came out to around twenty-eight to thirty-two per year. So yeah, well within the forty.

SARAH CHEN: Okay. So the forty thousand is basically pre-approved, we'd just be redirecting it. Um— I think we can move on that. Let's— Aisha does the POC, we review on the fourth, and assuming it checks out, we— we proceed with Lattice Data. Does anyone have a strong objection to that direction?

[brief pause]

RACHEL BLOOM: No, I think that's right.

MARCUS WEBB: Makes sense to me.

DEREK OSEI: Yeah.

SARAH CHEN: Alright. Okay. Um—

[00:10:44]
LINDA MORALES: Sarah, sorry— can I quickly flag something before Thornfield? Because I think it might actually be related.

SARAH CHEN: Yeah, Linda, of course.

LINDA MORALES: So, um, I've been getting— I've gotten three tickets this week from clients asking about data export. Like, they want to pull their data out of Helix in bulk and right now the only way to do it is through individual report downloads which is— it's painful. And two of those clients are, um— one is actually Thornfield, and one is Bancroft Group, which Tom I think you're— they're in renewal?

TOM KOWALSKI: Yeah. Bancroft is up in April. Yeah.

LINDA MORALES: So this is— this is not a nice-to-have. Like, if they can't get their data out the way they need to, that's a churn risk.

SARAH CHEN: Yeah. Marcus, is there a— is this on the radar?

MARCUS WEBB: Um— [hesitant] —not, like, not formally. Derek, didn't you build something like this? Like a one-off export script for someone?

DEREK OSEI: Yeah, I did that for the Novus account like six months ago. It's not— it's not polished but the logic is there. It wouldn't be a huge lift to turn it into like a proper export endpoint.

MARCUS WEBB: How long?

DEREK OSEI: To do it right? Maybe a week. And I'd want to document the API properly so— [laughs] —so I'm not the only person who knows how it works.

MARCUS WEBB: [laughs] Yeah, that would be ideal.

[00:12:01]
LINDA MORALES: Can we— could we prioritize that? Because April is genuinely a real deadline for Bancroft.

SARAH CHEN: Okay, I think— I think yes, but Marcus, help me understand how this fits. We just committed to the dashboard being the priority.

MARCUS WEBB: I mean, Derek's on the dashboard fix too. So it's— it's a resourcing question.

DEREK OSEI: Honestly, I can probably do both if James is doing the frontend piece independently. Like, the dashboard fix on my end is more like— it's concentrated in the first few days and then I'm kind of waiting. So I could slot the export work in the back half.

SARAH CHEN: Would that push anything?

DEREK OSEI: I don't think so? I'd flag it if it does.

SARAH CHEN: Okay. Let's go with that. But Derek— can you just document what you build as you go, not after? Because we've had the thing where it's done but nobody knows how it works.

DEREK OSEI: [laughing] Yeah, fair enough. Yeah, I'll document as I go.

[00:12:58]
SARAH CHEN: Okay— Tom, Thornfield. What's the situation?

TOM KOWALSKI: So— [sighs] —okay. So Rob, who's my main contact there, he sent me a message Friday and basically the gist is that there's a new CTO who started in January. And this CTO is doing a full vendor audit. Like, they're evaluating every piece of software they use and making sure everything's— I think the phrase he used was "strategically aligned." Which is corporate for, um— which could mean anything.

RACHEL BLOOM: That's never a good phrase.

TOM KOWALSKI: No. [laughs] Exactly. So, um— Rob was careful not to say they're thinking of leaving but he basically strongly implied that if we can't show meaningful progress— and I think what he means by that is the dashboard, the data exports— um— by end of Q1, they might go to market to evaluate alternatives.

SARAH CHEN: Okay. So end of Q1 is—

TOM KOWALSKI: March thirty-first.

SARAH CHEN: Which means March fifteenth for the dashboard is— that's actually good timing. If we can hit that—

TOM KOWALSKI: Exactly. I was thinking the same thing. Like if we can demo a working version on the fifteenth, that gives me two weeks to set up a meeting with Rob and the new CTO before the quarter ends.

[00:14:22]
MARCUS WEBB: That works. I'd just say— and I don't want to be a downer— but can we make sure the demo environment is actually stable this time? Because the last time we demoed to a client on the Helix dashboard, Kevin, the— do you remember what happened?

KEVIN PARK: [laughs] Yeah. The database failover happened in the middle of the demo. Thirty-second outage.

MARCUS WEBB: Thirty-second outage in the middle of a sales demo.

TOM KOWALSKI: I was there. It was— [laughter from several people]

KEVIN PARK: I mean, in my defense, it was a scheduled maintenance window—

TOM KOWALSKI: On a Thursday at two PM!

KEVIN PARK: [laughing] Yeah, okay, the scheduling was bad. That's fair. So— yeah I'll— I'll make sure the demo environment is locked down before any client-facing stuff. I'll actually, um— when you set up the Thornfield meeting, Tom, can you give me a heads-up like forty-eight hours before? So I can do a stability check.

TOM KOWALSKI: Yeah, absolutely.

[00:15:37]
SARAH CHEN: Okay. So we're— okay, this is good. Um— Rachel, while we're here, is there anything marketing needs from us for the Q1 push? Because I feel like we've been bad at keeping you looped in.

RACHEL BLOOM: Yeah, I mean— so we're actually planning a kind of soft launch announcement. Not a huge thing but like a product update email to our client list, maybe a LinkedIn post. And for that I need— I basically need two things. One is like a firm set of features I can talk about, and the other is a quote from someone. Like a customer testimonial ideally, or a quote from the team.

SARAH CHEN: On the features— um— Marcus, can you pull together like a two-paragraph summary of what will be in the March release? Just bullet points even.

MARCUS WEBB: Yeah I can— I mean, I can do that. It doesn't need to be polished?

RACHEL BLOOM: No, draft is fine. I'll polish it.

SARAH CHEN: And on the testimonial— Linda, do you have any clients who might be willing to—?

LINDA MORALES: I have a couple of names. Um— there's a contact at Orion Biotech who's been very vocal about loving the product in our Slack community. I can reach out to her. And then there's also— actually let me just check— yeah, I think the Pemberton account, they filled out a really nice NPS response. I can follow up with them.

RACHEL BLOOM: That would be great. And like, it doesn't need to be long, just two sentences.

LINDA MORALES: Yeah, I'll reach out this week.

[00:17:11]
PRIYA NAIR: Can I— I want to flag something on the announcement because I've been working on, um— so we've been testing a new onboarding flow and I'm worried that if we do a big push for new signups and the onboarding isn't ready, we'll have a drop-off problem. Like, increased top of funnel and then people hit a confusing onboarding and leave.

RACHEL BLOOM: What's the timeline on the onboarding?

PRIYA NAIR: I mean— it's hard to say because it's tied to engineering capacity. James, what does the onboarding work look like from your side?

JAMES TRAN: Uh— [pause] —I mean there's like four screens. I think it's probably a week of work? Maybe a week and a half?

PRIYA NAIR: And do you have— like is that scoped?

JAMES TRAN: Not really. Like I've seen the mocks but we haven't had a ticket review yet.

MARCUS WEBB: [sighs] Let's not— let's not put that in the critical path for March. Like, if it gets done, great. If not, we're not— we're not blocking the announcement on it.

PRIYA NAIR: But we could just delay the email campaign until the onboarding is more—

RACHEL BLOOM: I mean— I can try to scope the email to existing clients rather than a broad acquisition push. So it's more of a "new features" message for people who are already in the product. That way onboarding is less of a concern.

PRIYA NAIR: Okay, yeah, that could work.

SARAH CHEN: I think that's the right call. Let's keep it existing-client focused for now. Rachel, does that work?

RACHEL BLOOM: Yeah, I'll adjust the brief.

[00:18:48]
SARAH CHEN: Okay— um— I also want to flag, uh, briefly— Marcus, I don't know if you've had a chance to look at the contractor situation.

MARCUS WEBB: Which one, the—

SARAH CHEN: The— the two people from Axiom. That we were supposed to onboard.

MARCUS WEBB: Oh— yeah. So one of them has started, um— she's been great actually, she's been ramp— ramping up fast. The other one got pulled by Axiom into another engagement, which was— I found out on Friday, which was not ideal.

SARAH CHEN: Is that— is that resolved?

MARCUS WEBB: They're sending a replacement. I haven't met the replacement yet. I need to— I need to set up time with them this week actually. That's on me.

SARAH CHEN: Okay. And they're slotted for what? The— the search feature?

MARCUS WEBB: Yeah, search and also some of the API refactor stuff. I'd like to get them up to speed before we lose more time.

SARAH CHEN: Yeah, no, get that scheduled.

[00:19:55]
AISHA JOHNSON: Hey, sorry— I just want to make sure I understand the analytics decision. So the budget, the forty thousand— that's already approved? Like I don't need to go get that reapproved even if I'm now spending it on Lattice instead of engineering?

SARAH CHEN: Um— technically it's in Marcus's engineering budget. Marcus, is there a process issue there?

MARCUS WEBB: I mean— it's a gray area. Like it was allocated for headcount and tools for that initiative. I think redirecting it to a vendor that achieves the same goal is fine. If finance asks, I'll handle it.

AISHA JOHNSON: Okay, good. I just wanted to make sure I wasn't going to go negotiate a contract and then get told we don't have budget.

MARCUS WEBB: No, you're good. Just, um— keep me CC'd on any conversations with them so I have visibility.

AISHA JOHNSON: Yeah, of course.

[00:20:42]
NATALIE RUSSO: Can I talk about something that's been— [slight hesitation] —okay I feel bad raising this but I feel like I have to. Um. The QA coverage on the auth module. So when we did the sprint-22 changes, there were about— I think it was like eight or nine changes to the authentication flow? And we— I flagged at the time that I wanted to do a full regression pass before we shipped the next thing and that kind of got— it got deprioritized because of the Helix timeline. Which I understand. But it's been sitting there and if something goes wrong with auth in production, especially for a client like Thornfield—

SARAH CHEN: No, Natalie, you're right. And I don't want you to feel bad for raising it. When can you do the regression?

NATALIE RUSSO: I mean I can start tomorrow if I don't have other things piled on. I just need— I would need James to be available for like an hour if I find something because some of those auth changes were his.

JAMES TRAN: Yeah, yeah, I'm available. Just ping me in Slack.

NATALIE RUSSO: Okay. I'll, um— I'll try to get through it by Thursday.

SARAH CHEN: Please do. And I'll— I'll shield you from anything else landing on your plate this week so you can actually get that done.

NATALIE RUSSO: Thank you. Really.

[00:21:57]
TOM KOWALSKI: Quick thing on Bancroft— so Linda mentioned the data export and that's genuinely helpful to hear is coming. The other thing with Bancroft is they've been asking about SSO. Like, SAML SSO. Is that— is that anywhere on the roadmap?

MARCUS WEBB: It's on the list but it's— it's below a few other things.

TOM KOWALSKI: Can it move up? Because I think that's actually— that might be even more important to them than the export. Enterprise clients all want SSO.

SARAH CHEN: What's the lift, Marcus?

MARCUS WEBB: [exhales] It's not trivial. Like, we'd want to implement it properly so we're not creating a security mess. Probably—

DEREK OSEI: [overlapping] Two to three weeks of focused work.

MARCUS WEBB: Yeah. Two to three weeks. And it's— it's not the kind of thing you want to rush.

SARAH CHEN: Okay. I think SSO is a Q2 thing then. Tom, can you— can you buy some time with Bancroft on that?

TOM KOWALSKI: I'll try. I think if I can show them the export is coming and the dashboard improvements, that might be enough for renewal. SSO would just be— it'd be icing.

SARAH CHEN: Yeah. Okay. Let's not overcommit on Q1. SSO in Q2.

[00:23:14]
KEVIN PARK: Hey— I want to bring up something real quick that I don't think we have on the agenda but I think it affects everyone. Um— so the on-call rotation. We've got four people in it right now and it's— the alert volume has gone way up since the last deploy. Like, we're seeing a lot of noise and it's making it hard to distinguish real issues from stuff that's just—

MARCUS WEBB: [interrupts] Yeah, the— I saw some of those at like two AM last week.

KEVIN PARK: Yeah. So I want to— I want to go through the alert thresholds and kind of tune them. And I also think we need to add at least one more person to the rotation because it's— it's burning people out.

MARCUS WEBB: Yeah, we can— can you send me a quick writeup of what you're thinking? Like which thresholds and who you'd add?

KEVIN PARK: Yeah, I'll put something together.

MARCUS WEBB: Yeah, great.

KEVIN PARK: I just wanted it on someone's radar.

MARCUS WEBB: No, it's on the radar. Good flag.

[00:24:05]
SARAH CHEN: Okay, we're at— we're at twenty-four minutes. Um— let me just sort of do a quick—  does anyone have anything that we haven't touched that they need to surface?

LINDA MORALES: I think I'm good.

RACHEL BLOOM: Nothing urgent from me.

PRIYA NAIR: No— oh, wait, actually— I just want to, uh— the design system refresh. The tokens work. I know we said we'd kick that off in February and it's the end of February. I just want to flag I have a proposal ready. I don't need to get into it now but I'd love to get thirty minutes with Marcus and James to walk through it.

MARCUS WEBB: Yeah, put something on my calendar. I'm— just look for a gap, there should be something Thursday or Friday.

PRIYA NAIR: Okay, I'll grab it.

JAMES TRAN: You can add me too.

PRIYA NAIR: Will do.

[00:24:48]
SARAH CHEN: Okay. So— okay, let me just make sure I have this right in my head because I'm going to write up a summary. Um— dashboard, we're targeting March fifteenth. Kevin, you're starting the cloud migration Monday. James and Derek, you're working in parallel on the re-render and cache issues starting around the ninth. Priya's getting revised mockups into Figma today. Natalie is doing the auth regression this week. Um— analytics vendor, Aisha is running a POC with Lattice Data, we're aiming for a read by March fourth. The forty thousand that was budgeted is— that's the envelope we're working in. Um— Derek's also doing the bulk export endpoint alongside the dashboard work and he's going to document as he goes. [small laugh from Derek] Tom, you need a formal note from me on March fifteenth— I'll send that today. Rachel, you're adjusting the Q1 announcement to focus on existing clients, and you need feature bullets from Marcus and a testimonial from Linda. Linda's reaching out to Orion Biotech and Pemberton this week. And Marcus, you need to get time with the replacement contractor this week. Kevin's also going to look at the on-call alert thresholds and send Marcus a proposal. And SSO is a Q2 item. Did I miss anything?

[pause]

MARCUS WEBB: I think that's it.

LINDA MORALES: That's everything I had.

TOM KOWALSKI: That's good, yeah.

AISHA JOHNSON: Yeah, I'm good.

[00:26:09]
DEREK OSEI: Oh— actually, one quick thing. The API documentation for the export endpoint— can we decide where that lives? Because we have the internal Notion and then we have the developer docs on the website and I always forget which one gets what.

SARAH CHEN: Uh— Marcus, what's the rule supposed to be?

MARCUS WEBB: So the rule is— internal implementation notes go in Notion, anything client-facing goes in the dev docs. But I know that hasn't been consistent.

DEREK OSEI: So for the export endpoint, if clients might call it directly—

MARCUS WEBB: If clients will be calling it, then it needs to go in the external docs. Yeah. Just— do both, put the full thing in dev docs and a shorter version in Notion with a link.

DEREK OSEI: Okay, yeah, that works.

[00:26:57]
SARAH CHEN: Okay. Is— are we good?

RACHEL BLOOM: Actually, wait— sorry, I wanted to go back to the press release question for a second. I said email and LinkedIn but I'm also thinking, is there a blog post? Like, our last engineering blog post was in November and I think there's an opportunity to— especially with the dashboard improvements— to do something technical that also signals product momentum. Marcus, is there someone on the team who'd be up for writing something like that?

MARCUS WEBB: Hmm. I mean— I could write something but I'm not sure I have the bandwidth right now. Derek, you kind of wrote that Redis post a while back, right?

DEREK OSEI: [laughs] That was like three years ago.

MARCUS WEBB: But you could do it.

DEREK OSEI: I mean— maybe? It'd have to wait until after the dashboard work is done though. Like, late March maybe?

RACHEL BLOOM: Late March is fine. Yeah, I'd take that.

MARCUS WEBB: Alright, Derek— pencil in a blog post for late March. No pressure but let's— let's call it a soft commitment.

DEREK OSEI: [laughing] You said no pressure and then said soft commitment.

MARCUS WEBB: [laughing] Both those things are true.

[00:28:10]
SARAH CHEN: Okay. I think— I think that's actually everything. Um— I'll send out the summary with the decisions and commitments. Tom, your note goes today. And— just to make sure everyone's clear, like the through-line here is March fifteenth for Helix dashboard and end of Q1 for the Thornfield relationship. Those are the two things everything else is in service of. Everyone aligned?

MARCUS WEBB: Yep.

TOM KOWALSKI: Aligned.

JAMES TRAN: Mm-hm.

NATALIE RUSSO: Yes.

PRIYA NAIR: Yep.

RACHEL BLOOM: Yeah.

KEVIN PARK: Sounds good.

LINDA MORALES: Aligned.

DEREK OSEI: Yep.

AISHA JOHNSON: Yeah— [slight crackle] —sorry, yes, I'm— the train went under— I caught enough. I'm good.

SARAH CHEN: [laughs] Okay. Thank you everyone. We'll reconvene— we do our usual check-in on Thursday, right?

MARCUS WEBB: Thursday, yeah.

SARAH CHEN: Great. Alright, good luck everyone. Go make things.

[00:28:58]
[Recording ends]

─────────────────────────────────────────────────────────────────────────────
END OF TRANSCRIPT
Auto-transcription accuracy: ~84% (Otter.ai estimate)
Note: Transcript has not been manually reviewed or corrected.
─────────────────────────────────────────────────────────────────────────────